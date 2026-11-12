import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Toy 上线自检（硬指标，接进 pnpm verify）。
 *
 * 规则来源：《Toy 开发者 FAQ》（bilibili.com/toy/publish/guide/faq）
 * 与 bilibili/toy 仓库的 content-checklist.md。两者判的不是"写得好不好"，
 * 而是"传上去能不能开、会不会被驳回"：
 * 1. 入口 index.html 解压后 ≤ 1MB —— 平台硬上限，超了 create/update 直接被拒；
 * 2. 整包 ≤ 50MB —— 超过要在创作者设置里单独申请；
 * 3. 资源与跳转一律相对路径 —— 页面跑在 /toy/<slug>/ 子路径下，/assets 会解析到站根，白屏；
 * 4. 不出现自由文本输入 / 文件上传 —— UGC 是内容安全红线，自由输入需自行接入审核；
 * 5. 不出现站外链接与第三方登录 —— Toy 自动登录 B 站账号，站外跳转属禁止事项。
 *
 * 只扫构建产物与站点源码：docs/、README 里的说明文字不算产品内容。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/site/dist');
const SITE_SRC = join(ROOT, 'apps/site/src');

const LIMITS = {
  /** 入口 HTML 硬上限。平台按解压后体积算，ZIP 压得再狠也没用 */
  entryKb: 1024,
  /** 整包硬上限（未申请大包时） */
  packageMb: 50,
};

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
let errors = 0;

function ok(message) {
  console.log('  ✓ ' + message);
}
function fail(message) {
  console.error('  ✗ ' + message);
  errors += 1;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

console.log('Toy 上线自检…');

/* ---------------- 1. 入口与包体积 ---------------- */

if (!existsSync(DIST)) {
  console.error('✗ 找不到 ' + DIST + ' —— 先 pnpm build（pnpm toy:check 不会替你构建）');
  process.exit(1);
}

const entry = join(DIST, 'index.html');
if (!existsSync(entry)) {
  fail('::error::产物根目录没有 index.html（Toy 要求包根或唯一一级子目录下有它）');
} else {
  const sizeKb = kb(statSync(entry).size);
  if (sizeKb <= LIMITS.entryKb) {
    ok('入口 index.html ' + sizeKb + ' KB / 上限 ' + LIMITS.entryKb + ' KB');
  } else {
    fail('::error::入口 index.html ' + sizeKb + ' KB 超过平台 ' + LIMITS.entryKb + ' KB 硬上限，提交会被拒');
  }
}

const files = walk(DIST);
const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const totalMb = Math.round((totalBytes / 1024 / 1024) * 100) / 100;
if (totalMb <= LIMITS.packageMb) {
  ok('整包 ' + totalMb + ' MB（' + files.length + ' 个文件）/ 上限 ' + LIMITS.packageMb + ' MB');
} else {
  fail('::error::整包 ' + totalMb + ' MB 超过 ' + LIMITS.packageMb + ' MB，需要在大包申请里报备');
}

/* ---------------- 2. 相对路径 ---------------- */

/** 只看 HTML/CSS 里的资源引用：JS 里的字符串可能是逻辑判断，不是真实请求 */
const htmlFiles = files.filter((file) => /\.(?:html|css)$/.test(file));
const absoluteRef = /(?:src|href)\s*=\s*["']\/(?!\/)[^"']*/g;
const absoluteCss = /url\(\s*["']?\/(?!\/)[^"')]+/g;
let absoluteHits = 0;
for (const file of htmlFiles) {
  const text = readFileSync(file, 'utf8');
  const hits = [...(text.match(absoluteRef) ?? []), ...(text.match(absoluteCss) ?? [])];
  if (hits.length === 0) continue;
  absoluteHits += hits.length;
  fail('::error::' + relative(DIST, file) + ' 里有 ' + hits.length + ' 处站根绝对路径（会白屏）：' + hits.slice(0, 3).join('、'));
}
if (absoluteHits === 0) ok('产物里的资源引用全是相对路径');

/* ---------------- 3. 外链 ---------------- */

/** b23 短链、第三方登录、站外跳转都是明确禁止项；schema/命名空间不算链接 */
const allowedHosts = /^https?:\/\/(?:www\.)?(?:w3\.org|bilibili\.com|b23\.tv)\//i;
const remote = /https?:\/\/[^"'\s)]+/g;
const remoteHits = new Set();
for (const file of htmlFiles) {
  const text = readFileSync(file, 'utf8');
  for (const url of text.match(remote) ?? []) {
    if (!allowedHosts.test(url)) remoteHits.add(url.slice(0, 120));
  }
}
if (remoteHits.size === 0) ok('产物里没有站外链接');
else fail('::error::产物里出现 ' + remoteHits.size + ' 个站外链接：' + [...remoteHits].slice(0, 5).join('、'));

/* ---------------- 4. 自由输入 / 上传 ---------------- */

const srcFiles = existsSync(SITE_SRC) ? walk(SITE_SRC).filter((file) => /\.(?:vue|ts)$/.test(file)) : [];
const freeInput = /<input(?![^>]*(?:type\s*=\s*["'](?:checkbox|radio|button|submit)["']|disabled))|<textarea|contenteditable|type\s*=\s*["']file["']|getUserMedia/g;
let inputHits = 0;
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const hits = text.match(freeInput) ?? [];
  if (hits.length === 0) continue;
  inputHits += hits.length;
  fail('::error::' + relative(ROOT, file) + ' 里有 ' + hits.length + ' 处自由输入/UGC 能力（Toy 内容安全红线）：' + hits.slice(0, 3).join('、'));
}
if (inputHits === 0) ok('站点源码里没有自由文本输入 / 文件上传 / 摄像头采集');

/* ---------------- 汇总 ---------------- */

if (errors === 0) {
  console.log('\n✓ Toy 自检通过：可以打包上传（分类、封面、图标、隐私说明见 docs/Toy发布自检.md）');
} else {
  console.error('\n✗ Toy 自检失败：' + errors + ' 项，先修再上传');
  process.exit(1);
}
