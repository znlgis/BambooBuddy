import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 打包配置体检：不依赖 Rust / JDK / Android SDK，只检查"CI 真跑起来时会不会因为
 * 少文件、写错 appId、图标缺一张而失败"。
 *
 * 接进 pnpm verify（scripts/verify.mjs），这样改坏了打包配置在本地就会红，
 * 不用等一个 tag 推上去才发现。
 */
const ROOT = process.cwd();
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
function readText(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) {
    fail('缺少文件：' + relativePath);
    return '';
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
}
if (cargo.includes('tauri-build') && cargo.includes('tauri =')) {
  ok('Cargo.toml 引用了 tauri 2 与 tauri-build');
} else if (cargo) {
  fail('Cargo.toml 缺少 tauri / tauri-build 依赖');
}

console.log('\n[安卓壳 Capacitor]');
const cap = readText('apps/mobile/capacitor.config.ts');
const appIdMatch = /appId:\s*'([^']+)'/.exec(cap);
const appId = appIdMatch?.[1] ?? null;
if (appId) ok('capacitor appId = ' + appId);
else fail('capacitor.config.ts 缺 appId');
if (cap.includes("webDir: '../site/dist'")) ok('webDir 指向站点产物 apps/site/dist');
else fail("capacitor.config.ts 的 webDir 应为 '../site/dist'");

const manifest = readText('apps/mobile/android/app/src/main/AndroidManifest.xml');
if (manifest) {
  if (/android:screenOrientation="portrait"/.test(manifest)) ok('竖屏锁定');
  else fail('AndroidManifest.xml 缺少 android:screenOrientation="portrait"');
  if (manifest.includes('android:allowBackup="false"')) ok('本地存档不参与云备份');
  else fail('AndroidManifest.xml 建议设置 android:allowBackup="false"');
}

const gradle = readText('apps/mobile/android/app/build.gradle');
if (gradle) {
  const namespace = /namespace\s*=\s*"([^"]+)"/.exec(gradle)?.[1] ?? null;
  if (appId && namespace === appId) ok('namespace 与 appId 一致（' + namespace + '）');
  else fail('app/build.gradle 的 namespace 应为 ' + appId + '，实际：' + (namespace ?? '(缺失)'));
  if (gradle.includes('BAMBOO_VERSION_NAME')) ok('versionName 支持 CI 注入（BAMBOO_VERSION_NAME）');
  else fail('app/build.gradle 缺少 BAMBOO_VERSION_NAME 注入');
  if (gradle.includes('BAMBOO_VERSION_CODE')) ok('versionCode 支持 CI 注入（BAMBOO_VERSION_CODE）');
  else fail('app/build.gradle 缺少 BAMBOO_VERSION_CODE 注入');
  if (gradle.includes('keystore.properties')) ok('签名可读 keystore.properties（缺省回落 debug）');
  else fail('app/build.gradle 未引用 keystore.properties');
}
const strings = readText('apps/mobile/android/app/src/main/res/values/strings.xml');
if (strings.includes('app_name') && /[\u4e00-\u9fff]/.test(strings)) ok('默认应用名为中文');
else fail('values/strings.xml 应有中文 app_name');
const stringsEn = readText('apps/mobile/android/app/src/main/res/values-en/strings.xml');
if (stringsEn.includes('Bamboo Buddy')) ok('英文系统显示 Bamboo Buddy');
else fail('values-en/strings.xml 缺少英文应用名 Bamboo Buddy');

console.log('\n[自动打包工作流]');
const release = readText('.github/workflows/release.yml');
if (release) {
  for (const needle of ['windows-latest', 'assembleRelease', 'tauri build', 'softprops/action-gh-release', 'upload-artifact']) {
    if (release.includes(needle)) ok('release.yml 含 ' + needle);
    else fail('release.yml 缺少 ' + needle);
  }
} else {
  fail('缺少 .github/workflows/release.yml');
}

console.log('\n[本地脚本]');
const pkg = readJson('package.json');
const scripts = pkg?.scripts ?? {};
for (const name of ['icons', 'keystore', 'dist:win', 'dist:apk']) {
  if (scripts[name]) ok('pnpm ' + name + ' = ' + scripts[name]);
  else fail('package.json 缺少脚本 ' + name);
}

if (errors > 0) {
  console.error('\n打包配置体检失败：' + errors + ' 个问题');
  process.exit(1);
}
console.log('\n打包配置体检通过 ✅');