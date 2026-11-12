import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 提交前门禁：typecheck / lint / test / content:check / pack:check / build 并行跑，
 * 最后串行跑 size（它读 dist，必须等 build 结束）。
 *
 * 为什么并行：这六步之间没有任何依赖，串起来只是白等（CHAGS 实测 65.8s → 35s）。
 * 但"提交前必须全绿"这条纪律一点没松：任一步失败，整体非 0。
 *
 * 为什么最后串行 size / toy:check：两者的断言对象都是构建产物，和 build 并行只会读到上一轮的 dist，
 * 那是最坏的一种假绿（旧产物不超标，新产物已经超了）。
 *
 * 输出保留各自前缀：挂在哪一步、是哪份日志，一眼能看出来。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'test', command: 'pnpm test' },
  { name: 'content:check', command: 'pnpm content:check' },
  { name: 'pack:check', command: 'pnpm pack:check' },
  { name: 'build', command: 'pnpm build' },
];

const COLORS = ['\u001b[36m', '\u001b[35m', '\u001b[33m', '\u001b[32m', '\u001b[34m'];
const RESET = '\u001b[0m';

const started = Date.now();

/**
 * 跑一步。
 *
 * 两个细节：
 * - 耗时记**本步**自己的（以前记的是"进程启动到本步结束"，五步全显示成同一个累计值）；
 * - spawn 本身可能同步抛错（Windows 受限环境常见 EPERM，POSIX 上是 EACCES/ENOENT），
 *   必须 catch 成"这一步失败"，否则整个 Promise.all 直接 reject、全部日志丢光。
 */
function run(name, command, color) {
  return new Promise((resolvePromise) => {
    const stepStart = Date.now();
    const prefix = color + '[' + name + ']' + RESET + ' ';
    let settled = false;
    const finish = (code, message) => {
      if (settled) return;
      settled = true;
      if (message !== undefined) console.error(prefix + message);
      resolvePromise({ name, code, ms: Date.now() - stepStart });
    };

    let child;
    try {
      child = spawn(command, {
        cwd: ROOT,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      finish(1, '无法启动：' + error.message);
      return;
    }

    const pipe = (stream, out) => {
      if (!stream) return;
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) out.write(prefix + line + '\n');
      });
      stream.on('end', () => {
        if (buffer.length > 0) out.write(prefix + buffer + '\n');
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('error', (error) => finish(1, '无法启动：' + error.message));
    child.on('close', (code) => finish(code ?? 1));
  });
}

console.log('▶ 并行门禁：' + STEPS.map((step) => step.name).join(' / '));
const results = await Promise.all(
  STEPS.map((step, index) => run(step.name, step.command, COLORS[index % COLORS.length])),
);

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  console.error(
    '\n✗ 门禁失败：' + failed.map((result) => result.name + ' (exit ' + result.code + ')').join('、'),
  );
  console.error('  以上步骤互不依赖，可以只重跑失败的那一项定位问题。');
  process.exit(1);
}

// size / toy:check 都读 dist，必须在 build 之后单独跑
const size = await run('size', 'pnpm size', COLORS[0]);
if (size.code !== 0) {
  console.error('\n✗ 体积门禁失败');
  process.exit(1);
}

// Toy 上线自检：入口 1MB / 整包 50MB / 相对路径 / 无自由输入 / 无站外链接
const toy = await run('toy:check', 'pnpm toy:check', COLORS[1]);
if (toy.code !== 0) {
  console.error('\n✗ Toy 上线自检失败');
  process.exit(1);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n✅ 全部门禁通过（' + seconds + 's）');
console.log(
  '   ' +
    [...results, size, toy]
      .map((result) => result.name + ' ' + (result.ms / 1000).toFixed(1) + 's')
      .join(' · '),
);
