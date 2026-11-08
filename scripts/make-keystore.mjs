import { spawnSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * 生成安卓签名密钥，并打印要贴进 GitHub Secrets 的四样东西。
 *
 * 为什么需要它：没有密钥时，CI 会用 debug 密钥兜底 —— APK 照样能装到自己手机上，
 * 但 debug 密钥可能每次构建都不一样：手机上装新版会报"签名不一致"，
 * 只能先卸载旧版（卸载会清掉本地存档）。
 *
 * 用法：pnpm keystore [--force] [--out <目录>]
 *
 * 安全纪律：**任何时候都不主动删除已有的密钥**。
 * 旧实现 --force 会先 rm 旧 keystore 再找 JDK；JDK 缺失或 keytool 失败时，
 * 密钥已经没了且不可恢复（旧版用户再也无法覆盖安装）。现在改成：
 *   生成到临时文件 → 用 keytool 校验能读出别名 → 旧文件备份成 .bak → 原子 rename 覆盖。
 * 任何一步失败都只清理临时文件，旧密钥原样保留。
 */

const args = process.argv.slice(2);
/** --out <目录>：把密钥写到别处（默认 apps/mobile/android，供本地与 CI 使用） */
const outIndex = args.indexOf('--out');
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ANDROID_DIR =
  outIndex >= 0 && args[outIndex + 1]
    ? resolve(args[outIndex + 1])
    : join(ROOT, 'apps', 'mobile', 'android');
const KEYSTORE = join(ANDROID_DIR, 'bamboo-release.keystore');
const PROPS = join(ANDROID_DIR, 'keystore.properties');
const ALIAS = 'bamboo';
const isWindows = process.platform === 'win32';

/** JDK 的 release 文件里有 JAVA_VERSION，用来避开 Gradle 8.14 不支持的 25+ */
function majorOf(jdkDir) {
  try {
    const text = readFileSync(join(jdkDir, 'release'), 'utf8');
    return Number(/JAVA_VERSION="(\d+)/.exec(text)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

function findKeytool() {
  const dirs = [];
  for (const env of ['BAMBOO_JDK', 'JAVA_HOME']) {
    const dir = process.env[env];
    if (dir) dirs.push(dir);
  }
  const roots = isWindows
    ? ['C:\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']
    : ['/usr/lib/jvm'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) dirs.push(join(root, name));
  }

  const bin = (dir) => join(dir, 'bin', isWindows ? 'keytool.exe' : 'keytool');
  const usable = dirs.filter((dir) => existsSync(bin(dir)));
  // 优先 17–24（与 gradle 8.14 能用的范围一致），它们生成的是最保守的 PKCS12
  const preferred = usable.find((dir) => {
    const major = majorOf(dir);
    return major >= 17 && major <= 24;
  });
  return preferred ? bin(preferred) : usable[0] ? bin(usable[0]) : null;
}

const force = args.includes('--force');
mkdirSync(ANDROID_DIR, { recursive: true });
if (existsSync(KEYSTORE) && !force) {
  console.error(
    [
      '已经存在：' + relative(process.cwd(), KEYSTORE),
      '换密钥会让手机上已装的版本再也无法覆盖安装（只能卸载重装），所以这里不覆盖。',
      '确实要换一把新的，加 --force（旧的会先备份成 .bak）。',
    ].join('\n'),
  );
  process.exit(1);
}

const keytool = findKeytool();
if (!keytool) {
  console.error(
    [
      '找不到 keytool（JDK 自带）。已有的密钥没有被动过，装好 JDK 后重试即可。',
      '装一个 JDK 17–24（Temurin 即可），或用 BAMBOO_JDK / JAVA_HOME 指定 JDK 目录。',
    ].join('\n'),
  );
  process.exit(1);
}

// base64url：只有 [A-Za-z0-9_-]，塞进 shell / YAML / Secrets 都不会被转义问题咬到
const storePassword = randomBytes(18).toString('base64url');
const keyPassword = storePassword;

/** 临时文件放在同目录，保证 rename 是同一文件系统的原子操作 */
const suffix = '.tmp-' + process.pid;
const tmpKeystore = KEYSTORE + suffix;
const tmpProps = PROPS + suffix;

function cleanupTemp() {
  rmSync(tmpKeystore, { force: true });
  rmSync(tmpProps, { force: true });
}

console.log('使用 keytool：' + keytool);
const result = spawnSync(
  keytool,
  [
    '-genkeypair', '-v',
    '-keystore', tmpKeystore,
    '-storepass', storePassword,
    '-keypass', keyPassword,
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    // 10000 天 ≈ 27 年：这是个给小朋友玩的小游戏，别让密钥在用户手里过期
    '-validity', '10000',
    '-dname', 'CN=Bamboo Buddy, O=Bamboo Buddy, C=CN',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
);
if (result.status !== 0) {
  // 失败时只清理临时文件：旧 keystore / keystore.properties 一个字节都没动
  cleanupTemp();
  console.error((result.stderr ?? '') + (result.stdout ?? ''));
  console.error('✗ keytool 生成失败；已有的密钥未被修改。');
  process.exit(result.status ?? 1);
}

// 写盘前先确认产物确实可用：能读回我们刚写的别名，才算生成成功
const verify = spawnSync(
  keytool,
  ['-list', '-keystore', tmpKeystore, '-storepass', storePassword, '-alias', ALIAS],
  { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
);
if (verify.status !== 0 || !existsSync(tmpKeystore) || statSync(tmpKeystore).size === 0) {
  cleanupTemp();
  console.error((verify.stderr ?? '') + (verify.stdout ?? ''));
  console.error('✗ 新密钥校验失败；已有的密钥未被修改。');
  process.exit(verify.status ?? 1);
}

// 本地构建（pnpm dist:apk）也走固定密钥：gradle 读的就是这个文件
const props = [
  'storeFile=bamboo-release.keystore',
  'storePassword=' + storePassword,
  'keyAlias=' + ALIAS,
  'keyPassword=' + keyPassword,
  '',
].join('\n');
writeFileSync(tmpProps, props, 'utf8');

/** 覆盖前先把旧密钥备份一份：密钥文件丢一次，就等于所有已安装用户的存档都要被卸载清掉 */
let backupPath = null;
if (existsSync(KEYSTORE)) {
  backupPath = KEYSTORE + '.bak';
  if (existsSync(backupPath)) backupPath = KEYSTORE + '.bak-' + Date.now();
  copyFileSync(KEYSTORE, backupPath);
}

try {
  renameSync(tmpKeystore, KEYSTORE);
  renameSync(tmpProps, PROPS);
} catch (cause) {
  cleanupTemp();
  console.error(
    '✗ 写入最终文件失败：' + (cause instanceof Error ? cause.message : String(cause)) +
      (backupPath ? '\n  旧密钥备份在：' + relative(process.cwd(), backupPath) + '（可手动恢复）' : ''),
  );
  process.exit(1);
}

const base64 = readFileSync(KEYSTORE).toString('base64');
console.log('');
console.log('✅ 已生成：' + relative(process.cwd(), KEYSTORE));
if (backupPath) {
  console.log('✅ 旧密钥已备份：' + relative(process.cwd(), backupPath) + '（确认新版能覆盖安装后可删）');
}
console.log(
  '✅ 已写入：' + relative(process.cwd(), PROPS) +
    (outIndex >= 0 ? '' : '（本地 pnpm dist:apk 从现在起就用这把密钥）'),
);
console.log('');
console.log('⚠️  这两个文件都不入库（.gitignore 已忽略）—— 请自己备份，丢了就再也发不出能覆盖安装的新版本。');
console.log('');
console.log('想让 CI 发的版本也能直接覆盖安装，把这四个填进');
console.log('GitHub → Settings → Secrets and variables → Actions（名称要一模一样）：');
console.log('');
console.log('ANDROID_KEYSTORE_BASE64 = ' + base64);
console.log('ANDROID_KEYSTORE_PASSWORD = ' + storePassword);
console.log('ANDROID_KEY_ALIAS = ' + ALIAS);
console.log('ANDROID_KEY_PASSWORD = ' + keyPassword);
console.log('');
console.log('（只想自己手机上装、不想配 Secrets 也行：不配时 CI 用 debug 密钥签名，');
console.log('  APK 照样能装，只是换版本时可能要卸载旧版；见 docs/打包与分发.md）');
