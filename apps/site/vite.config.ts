import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Phaser 走自定义裁剪版（packages/phaser-kit/vendor/phaser-trim.esm.js）：
 * 完整包里的 physics / tilemaps / sound / animations 对十个日常玩法是纯死重。
 * 只替换裸 'phaser' 导入；TS 类型仍解析到 phaser 包，typecheck 不受影响。
 */
const phaserTrim = fileURLToPath(
  new URL('../../packages/phaser-kit/vendor/phaser-trim.esm.js', import.meta.url),
);

/**
 * pinia 的开发构建里带 devtools 的时间线桥（file-saver 的 saveAs → XHR + Blob）。
 * 生产包用不到，而 Toy 包体安全检查会把它算「动态下载」，所以指到 prod 构建。
 * 路径必须运行时解析：.pnpm 目录里带平台相关 hash，写死会在 CI 上 ENOENT。
 */
function resolvePiniaProd(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('pinia')), 'pinia.esm-browser.prod.js');
  } catch {
    return null;
  }
}
const piniaProd = resolvePiniaProd();

export default defineConfig({
  // 部署到任意子路径（家长用 U 盘拷进平板也能打开）：资源一律相对路径
  base: './',
  define: { __VUE_PROD_DEVTOOLS__: 'false' },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      ...(piniaProd === null ? [] : [{ find: /^pinia$/, replacement: piniaProd }]),
      { find: /^phaser$/, replacement: phaserTrim },
    ],
  },
  // 端口固定：端到端测试与预览脚本都按这个地址找（被占用时宁可报错，也不悄悄换端口）
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  preview: { host: '127.0.0.1', port: 5191, strictPort: true },
  build: {
    target: 'es2022',
    // Vite 的 modulepreload polyfill 自带 XHR 探测与 fetch 预载；目标浏览器都原生支持，去掉它
    modulePreload: { polyfill: false },
    // pinia devtools 桥（含 XHR）在生产包里没有意义：根级 define 让 Rollup 静态消除
    // 告警线贴着裁剪后的 Phaser：它本来就是共享大 chunk，新增的大 chunk 才该出声
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // 十个玩法共用同一份 Phaser；不单独切出来的话每换一个玩法都要重下
              name: 'vendor-phaser',
              test: /node_modules[\\/]phaser[\\/]|phaser-kit[\\/]vendor[\\/]phaser-trim/,
            },
          ],
        },
        /**
         * 产物命名按"玩法/内容/第三方"分前缀：体积报告与首屏断言都要能从文件名读出含义。
         * （默认全叫 index-<hash>.js，出了体积问题只能靠猜。）
         */
        chunkFileNames(chunk) {
          const id = chunk.facadeModuleId ?? '';
          const game = /[\\/]games[\\/][^\\/]+[\\/]src[\\/]games[\\/]([^\\/]+)\.ts$/.exec(id);
          if (game) return 'assets/game-' + game[1] + '-[hash].js';
          const detail = /[\\/]content[\\/]src[\\/]details[\\/]([^\\/]+)\.game\.json$/.exec(id);
          if (detail) return 'assets/content-' + detail[1] + '-[hash].js';
          if (chunk.name.includes('phaser')) return 'assets/vendor-phaser-[hash].js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
