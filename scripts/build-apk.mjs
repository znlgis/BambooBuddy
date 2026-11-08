import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 构建安卓 APK。
 *
 * 存在的理由：系统上装的可能是 JDK 25，而 **Gradle 8.14 只支持到 JDK 24**
 * （实测报 "Unsupported class file major version 69"）。
 * 这里自动挑一个 17–24 的 JDK，避免每个人都要手动切 JAVA_HOME。
 *
 * 两个平台坑：
 * 1. 不能用 cwd 推仓库根：pnpm 跑包脚本时 cwd 是 apps/mobile，不是仓库根。
 * 2. Windows 下**不能直接 spawn gradlew.bat**：Node ≥18.20（CVE-2024-27980）对 .bat/.cmd
 *    直接 spawn 会抛 EINVAL，必须经 cmd.exe /c 或 shell:true。
 */

/** 仓库根：脚本可能被 pnpm --filter 从包目录调起，不能依赖 cwd */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(ROOT, 'apps', 'mobile', 'android');
const isWindows = process.platform === 'win32';

function findJdk() {
  const candidates = [];
  if (process.env.BAMBOO_JDK) candidates.push(process.env.BAMBOO_JDK);
  candidates.push(isWindows ? 'C:\\Java\\jdk21' : '/usr/lib/jvm/temurin-21-jdk');

  const roots = isWindows
    ? ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']
    : ['/usr/lib/jvm'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      // 与下方 17–24 的接受范围一致：只认 17/18/19/20/21/22/23/24
      if (/(?:jdk|temurin)-?(?:1[7-9]|2[0-4])(?:[.\-_]|$)/i.test(name)) {
        candidates.push(join(root, name));
      }
    }
  }

  for (const dir of candidates) {
    const java = join(dir, 'bin', isWindows ? 'java.exe' : 'java');
    if (!existsSync(java)) continue;
    const probe = spawnSync(java, ['-version'], { encoding: 'utf8' });
    const text = (probe.stderr ?? '') + (probe.stdout ?? '');
    const major = Number(/version "(\d+)/.exec(text)?.[1] ?? '0');
    if (major >= 17 && major <= 24) return { dir, major };
  }
  return null;
}

const jdk = findJdk();
if (!jdk) {
  console.error(
    [
      '找不到可用的 JDK（需要 17–24）。',
      'Gradle 8.14 不支持 JDK 25，会报 "Unsupported class file major version 69"。',
      '安装 Temurin 21 后重试，或用 BAMBOO_JDK 指定 JDK 目录。',
      '（CI 里由 actions/setup-java 提供 JDK 21，不需要这一层兜底。）',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('使用 JDK ' + jdk.major + '：' + jdk.dir);

const args = ['assembleRelease', '--no-daemon'];
const spawnOptions = {
  cwd: androidDir,
  stdio: 'inherit',
  env: { ...process.env, JAVA_HOME: jdk.dir },
};

// Windows：.bat 必须经 cmd.exe 启动（Node ≥18.20 直接 spawn .bat 会 EINVAL）
const result = isWindows
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...args], spawnOptions)
  : spawnSync('./gradlew', args, spawnOptions);

if (result.error) {
  // 以前这里直接 process.exit(result.status ?? 1)：spawn 失败时 status 为 null，
  // 只会得到一个莫名其妙的 exit 1。把真实原因打出来。
  console.error('✗ 无法启动 gradlew：' + result.error.message);
  process.exit(result.status ?? 1);
}
process.exit(result.status ?? 1);
