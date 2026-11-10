import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 打包配置体检：不依赖 Rust / JDK / Android SDK，只检查"CI 真跑起来时会不会因为
 * 少文件、写错 appId、图标缺一张而失败"。
 *
 * 接进 pnpm verify（scripts/verify.mjs），这样改坏了打包配置在本地就会红，
 * 不用等一个 tag 推上去才发现。
 *
 * 两个纪律：
 * 1. 仓库根由脚本位置推导，不依赖 cwd —— 从子目录直接 `node scripts/check-packaging.mjs` 也能跑；
 * 2. 文件读不到只记 1 次失败（以前 `readText` 记一次、调用处再对空串断言记一次，错误数虚高）。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;

function ok(message) {
  console.log('  ✓ ' + message);
}
function fail(message) {
  console.error('  ✗ ' + message);
  errors += 1;
}
function readJson(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) {
    fail('缺少文件：' + relativePath);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    fail(relativePath + ' 不是合法 JSON：' + cause.message);
    return null;
  }
}
/** 读不到时返回 null（已经记过一次失败）：调用方据此跳过后续断言，避免同一个缺失重复计数 */
function readText(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) {
    fail('缺少文件：' + relativePath);
    return null;
  }
  return readFileSync(path, 'utf8');
}

console.log('打包配置体检…\n[桌面壳 Tauri]');
const tauri = readJson('apps/desktop/src-tauri/tauri.conf.json');
const cargo = readText('apps/desktop/src-tauri/Cargo.toml');
if (tauri) {
  if (tauri.build?.frontendDist === '../../site/dist') {
    ok('frontendDist 指向站点产物 apps/site/dist');
  } else {
    fail('tauri.conf.json 的 build.frontendDist 应为 ../../site/dist，实际：' + tauri.build?.frontendDist);
  }
  if (typeof tauri.identifier === 'string' && tauri.identifier.length > 0) {
    ok('identifier = ' + tauri.identifier);
  } else {
    fail('tauri.conf.json 缺少 identifier');
  }
  const icons = tauri.bundle?.icon ?? [];
  const missing = icons.filter((icon) => !existsSync(join(ROOT, 'apps/desktop/src-tauri', icon)));
  if (icons.length > 0 && missing.length === 0) {
    ok('bundle 图标齐全（' + icons.length + ' 个）');
  } else {
    fail('bundle.icon 缺失：' + (missing.join('、') || '(未配置)') + '（先跑 pnpm icons）');
  }
  if (tauri.bundle?.active === true) ok('bundle.active = true');
  else fail('tauri.conf.json 的 bundle.active 应为 true');

  // P2-4：csp: null 等于关掉 WebView 的 CSP，等于把 XSS 风险留给"内容都是我们写的"这个假设。
  // 这里只做静态断言（本机没有 WebView2 运行时）；真正的 Phaser / WebAudio / TTS 验证需要真机跑。
  const csp = tauri.app?.security?.csp;
  if (typeof csp === 'string' && csp.trim().length > 0) {
    ok('CSP 已收紧（不再是 null）');
    if (!csp.includes('unsafe-eval')) ok('CSP 不含 unsafe-eval');
    else fail('CSP 不能包含 unsafe-eval（Phaser 4 与站点产物都不需要 eval）');
    if (csp.includes("default-src 'self'")) ok("CSP 含 default-src 'self'");
    else fail("CSP 缺少 default-src 'self'");
    if (csp.includes("script-src 'self'")) ok("CSP 含 script-src 'self'");
    else fail("CSP 缺少 script-src 'self'");
    if (csp.includes("connect-src 'none'")) ok("CSP 含 connect-src 'none'（应用不联网）");
    else fail("CSP 缺少 connect-src 'none'（本项目不联网，不应放开网络出口）");
    // default-src 'self' 已经覆盖这两条，显式写出来是为了"改 CSP 的人一眼看到底线"：
    // object/embed 与 <base> 游戏一样都不用，留着只会扩大注入面。
    if (csp.includes("object-src 'none'")) ok("CSP 含 object-src 'none'");
    else fail("CSP 缺少 object-src 'none'（默认虽有 default-src 兜底，显式写出来防误改）");
    if (csp.includes("base-uri 'none'")) ok("CSP 含 base-uri 'none'");
    else fail("CSP 缺少 base-uri 'none'（防止 <base> 改写相对路径）");
  } else {
    fail('tauri.conf.json 的 app.security.csp 不能为 null 或空（P2-4）');
  }
}
if (cargo !== null) {
  if (cargo.includes('tauri-build') && cargo.includes('tauri =')) {
    ok('Cargo.toml 引用了 tauri 2 与 tauri-build');
  } else {
    fail('Cargo.toml 缺少 tauri / tauri-build 依赖');
  }
}

console.log('\n[安卓壳 Capacitor]');
const cap = readText('apps/mobile/capacitor.config.ts');
if (cap !== null) {
  const appIdMatch = /appId:\s*'([^']+)'/.exec(cap);
  const appId = appIdMatch?.[1] ?? null;
  if (appId) ok('capacitor appId = ' + appId);
  else fail('capacitor.config.ts 缺 appId');
  if (cap.includes("webDir: '../site/dist'")) ok('webDir 指向站点产物 apps/site/dist');
  else fail("capacitor.config.ts 的 webDir 应为 '../site/dist'");

  // P2-5：Capacitor 8 / Android 15 强制 edge-to-edge，必须显式声明系统栏安全区策略；
  // 站点侧再用 env(safe-area-inset-*) 给底栏让位（这两处是一对，缺一处就会压住手势条）。
  if (/SystemBars[\s\S]*insetsHandling/.test(cap)) ok('SystemBars 安全区策略已显式配置（P2-5）');
  else fail('capacitor.config.ts 需要显式配置 plugins.SystemBars.insetsHandling（P2-5）');
  if (cap.includes("initialViewportFitValueHint: 'cover'")) ok('initialViewportFitValueHint = cover');
  else fail("capacitor.config.ts 的 SystemBars.initialViewportFitValueHint 应为 'cover'");
}

// 安全区的网页侧前提：viewport-fit=cover + #app 的 env(safe-area-inset-*) 留白。
// 这两处由站点维护，打包体检只负责"改坏时在本地就红"，避免等真机才发现底栏被手势条压住。
const indexHtml = readText('apps/site/index.html');
if (indexHtml !== null) {
  if (indexHtml.includes('viewport-fit=cover')) ok('index.html 声明 viewport-fit=cover（安全区生效前提）');
  else fail('apps/site/index.html 的 viewport 需要 viewport-fit=cover（否则 env(safe-area-inset-*) 恒为 0）');
}
const siteCss = readText('apps/site/src/style.css');
if (siteCss !== null) {
  if (/env\(safe-area-inset-bottom/.test(siteCss)) ok('底栏安全区留白（env(safe-area-inset-bottom)）');
  else fail('apps/site/src/style.css 缺少 env(safe-area-inset-bottom) 安全区留白');
}

const manifest = readText('apps/mobile/android/app/src/main/AndroidManifest.xml');
if (manifest !== null) {
  if (/android:screenOrientation="portrait"/.test(manifest)) ok('竖屏锁定');
  else fail('AndroidManifest.xml 缺少 android:screenOrientation="portrait"');
  if (manifest.includes('android:allowBackup="false"')) ok('本地存档不参与云备份');
  else fail('AndroidManifest.xml 建议设置 android:allowBackup="false"');
}

const gradle = readText('apps/mobile/android/app/build.gradle');
if (gradle !== null) {
  const namespace = /namespace\s*=\s*"([^"]+)"/.exec(gradle)?.[1] ?? null;
  // namespace 必须等于 capacitor.config.ts 的 appId；appId 读不到时只自检不比较，
  // 避免 "capacitor.config.ts 缺 appId" 之后再报一次 "namespace 应为 null"
  const appId = cap === null ? null : (/appId:\s*'([^']+)'/.exec(cap)?.[1] ?? null);
  if (appId === null) {
    if (namespace === null) fail('app/build.gradle 缺少 namespace');
    else ok('build.gradle 的 namespace = ' + namespace + '（appId 未读到，跳过一致性校验）');
  } else if (namespace === appId) {
    ok('namespace 与 appId 一致（' + namespace + '）');
  } else {
    fail('app/build.gradle 的 namespace 应为 ' + appId + '，实际：' + (namespace ?? '(缺失)'));
  }
  if (gradle.includes('BAMBOO_VERSION_NAME')) ok('versionName 支持 CI 注入（BAMBOO_VERSION_NAME）');
  else fail('app/build.gradle 缺少 BAMBOO_VERSION_NAME 注入');
  if (gradle.includes('BAMBOO_VERSION_CODE')) ok('versionCode 支持 CI 注入（BAMBOO_VERSION_CODE）');
  else fail('app/build.gradle 缺少 BAMBOO_VERSION_CODE 注入');
  if (gradle.includes('keystore.properties')) ok('签名可读 keystore.properties（缺省回落 debug）');
  else fail('app/build.gradle 未引用 keystore.properties');
}

const strings = readText('apps/mobile/android/app/src/main/res/values/strings.xml');
if (strings !== null) {
  if (strings.includes('app_name') && /[\u4e00-\u9fff]/.test(strings)) ok('默认应用名为中文');
  else fail('values/strings.xml 应有中文 app_name');
}
const stringsEn = readText('apps/mobile/android/app/src/main/res/values-en/strings.xml');
if (stringsEn !== null) {
  if (stringsEn.includes('Bamboo Buddy')) ok('英文系统显示 Bamboo Buddy');
  else fail('values-en/strings.xml 缺少英文应用名 Bamboo Buddy');
}

console.log('\n[自动打包工作流]');
const release = readText('.github/workflows/release.yml');
if (release !== null) {
  for (const needle of ['windows-latest', 'assembleRelease', 'tauri build', 'softprops/action-gh-release', 'upload-artifact']) {
    if (release.includes(needle)) ok('release.yml 含 ' + needle);
    else fail('release.yml 缺少 ' + needle);
  }
}

console.log('\n[本地脚本]');
const pkg = readJson('package.json');
// readJson 读不到时已经记过一次失败：这里跳过脚本断言，避免同一个缺失被计成 5 个错误
// （"缺 package.json" 一条 + 四个脚本各一条，错误数虚高会让真正的问题淹没在噪音里）
if (pkg !== null) {
  const scripts = pkg.scripts ?? {};
  for (const name of ['icons', 'keystore', 'dist:win', 'dist:apk']) {
    if (scripts[name]) ok('pnpm ' + name + ' = ' + scripts[name]);
    else fail('package.json 缺少脚本 ' + name);
  }
}

if (errors > 0) {
  console.error('\n打包配置体检失败：' + errors + ' 个问题');
  process.exit(1);
}
console.log('\n打包配置体检通过 ✅');
