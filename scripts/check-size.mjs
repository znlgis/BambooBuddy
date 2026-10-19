import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * 体积守卫（硬指标，不是建议）。
 *
 * 技术方案把体积写进了预算表，但只有脚本能真的拦住它。五条口径缺一不可：
 * 1. **首屏**：index.html 实际引用（含 modulepreload）的 js/css + 内联的脚本与样式文本。
 *    内联必须计入 —— 否则"把入口改成内联 bootstrap、真入口改成动态 import"
 *    就能把首屏偷换成懒加载 chunk，预算形同虚设。
 * 2. **单个懒加载 chunk**（gzip 与原始各一条）：Phaser 裁剪版是最大的那个，
 *    它决定了"第一次进玩法"要等多久。
 * 3. **整个 dist 的原始大小**：桌面/安卓壳是本地文件加载，不过 gzip，
 *    原始字节才是它们的真实成本。
 * 4. **单个非代码资源**：图片/字体/音频没有 gzip 红利（本项目目前为零）。
 * 5. **非代码资源总量**：防止"一张 900 KB 的图从 dist 总量预算的余量里溜过去"。
 *
 * 任何一项超预算 → exit 1（pnpm verify / CI 直接红），改预算必须写明原因。
 */
/** 仓库根：脚本可能从任何目录被调用（CI、编辑器任务），不能依赖 cwd */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/site/dist');

const BUDGETS = {
  /** 首屏 JS + CSS（gzip）：决定孩子多久能看到小屋 */
  initialKb: 60,
  /** 首屏 JS + CSS（原始字节）：桌面/安卓壳省不掉 */
  initialRawKb: 180,
  /** 单个懒加载 js/css（gzip）：Phaser 裁剪版约 190–250 KB */
  chunkKb: 260,
  /** 单个懒加载 js/css（原始字节） */
  chunkRawKb: 1000,
  /** 整个 dist 的原始大小 */
  distKb: 2400,
  /** 单个图片 / 字体 / 音频文件 */
  assetKb: 200,
  /** 非代码资源总量 */
  assetsKb: 600,
};

const CODE = /\.(?:js|css)$/;
const ASSET = /\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4)$/i;

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const gzipKb = (path) => kb(gzipSync(readFileSync(path)).length);

/** dist 下所有文件（递归；目录要跳过，否则 readFileSync 会 EISDIR） */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

let failure = 0;

function check(label, actualKb, budgetKb) {
  const ok = actualKb <= budgetKb;
  if (!ok) failure += 1;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + '：' + actualKb + ' KB / 预算 ' + budgetKb + ' KB');
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 找不到 ' + DIST + '/index.html —— 先 pnpm build（pnpm size 不会替你构建）');
  process.exit(1);
}

const files = walk(DIST);
const html = readFileSync(join(DIST, 'index.html'), 'utf8');

/** index.html 里 src/href 指向的 js/css（modulepreload 的 href 同样是首屏成本） */
const referenced = new Set(
  [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)].map((match) =>
    join(DIST, match[1]).replace(/\\/g, '/'),
  ),
);

/** 内联 <script>/<style> 的文本：同样要用户先下载，必须计入首屏 */
const inlineBytes = [...html.matchAll(/<(script|style)[^>]*>([\s\S]*?)<\/\1>/g)]
  .filter((match) => match[2].trim().length > 0)
  .reduce((sum, match) => sum + Buffer.byteLength(match[2], 'utf8'), 0);

if (referenced.size === 0) {
  console.error('  ✗ index.html 里没有任何 js/css 引用 —— 产物结构可能变了，先人工确认再改这个脚本');
  failure += 1;
}

console.log('\n首屏必须下载的：');
let initialGzip = 0;
let initialRaw = inlineBytes;
if (inlineBytes > 0) console.log('  · index.html 内联脚本/样式  ' + kb(inlineBytes) + ' KB');
for (const path of files) {
  if (!referenced.has(path.replace(/\\/g, '/'))) continue;
  const raw = statSync(path).size;
  const gz = gzipKb(path);
  initialGzip += gz;
  initialRaw += raw;
  console.log('  · ' + relative(DIST, path) + '  ' + gz + ' KB (gzip) / ' + kb(raw) + ' KB');
}
check('首屏 JS+CSS 合计（gzip）', Math.round(initialGzip * 10) / 10, BUDGETS.initialKb);
check('首屏 JS+CSS 合计（原始）', kb(initialRaw), BUDGETS.initialRawKb);

console.log('\n按需加载的 chunk：');
let biggestGzip = { name: '(无)', size: 0 };
let biggestRaw = { name: '(无)', bytes: 0 };
for (const path of files) {
  const posix = path.replace(/\\/g, '/');
  if (!CODE.test(path) || referenced.has(posix)) continue;
  const raw = statSync(path).size;
  const gz = gzipKb(path);
  if (gz > biggestGzip.size) biggestGzip = { name: relative(DIST, path), size: gz };
  if (raw > biggestRaw.bytes) biggestRaw = { name: relative(DIST, path), bytes: raw };
  console.log('  · ' + relative(DIST, path) + '  ' + gz + ' KB (gzip) / ' + kb(raw) + ' KB');
}
check('最大的懒加载 chunk（' + biggestGzip.name + '）', biggestGzip.size, BUDGETS.chunkKb);
check('最大的懒加载 chunk 原始大小（' + biggestRaw.name + '）', kb(biggestRaw.bytes), BUDGETS.chunkRawKb);

// ---------- 非代码资源：单文件上限 + 总量上限 ----------
const assets = files.filter((path) => ASSET.test(path));
if (assets.length > 0) {
  console.log('\n非代码资源：');
  let assetsTotal = 0;
  let biggestAsset = { name: '(无)', bytes: 0 };
  for (const path of assets) {
    const bytes = statSync(path).size;
    assetsTotal += bytes;
    if (bytes > biggestAsset.bytes) biggestAsset = { name: relative(DIST, path), bytes };
    if (bytes > BUDGETS.assetKb * 1024) {
      console.error(
        '  ✗ ' + relative(DIST, path) + '：' + kb(bytes) + ' KB 超过单文件预算 ' + BUDGETS.assetKb + ' KB',
      );
      failure += 1;
    }
  }
  console.log('  · ' + assets.length + ' 个文件，最大 ' + biggestAsset.name + ' ' + kb(biggestAsset.bytes) + ' KB');
  check('非代码资源合计', kb(assetsTotal), BUDGETS.assetsKb);
} else {
  console.log('\n非代码资源：无（全部几何绘制 + WebAudio 合成，本项目的预期状态）');
}

const distTotal = files.reduce((sum, path) => sum + statSync(path).size, 0);
console.log('\ndist 共 ' + files.length + ' 个文件');
check('dist 原始大小', kb(distTotal), BUDGETS.distKb);

if (failure > 0) {
  console.error(
    '\n体积超预算：' + failure + ' 项。要么优化，要么在 scripts/check-size.mjs 里调整预算并写明原因。',
  );
  process.exit(1);
}
console.log('\n体积在预算内 ✅');
