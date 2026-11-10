import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 安卓壳：直接吃 apps/site 的构建产物。
 * 不配置 server.url —— 走 Capacitor 内置的本地服务（https://localhost），
 * 这样 ES module、IndexedDB、WebGL 全部按浏览器标准工作。
 */
const config: CapacitorConfig = {
  appId: 'com.bamboo.buddy',
  appName: 'Bamboo Buddy',
  webDir: '../site/dist',
  android: {
    backgroundColor: '#faf3e7',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    //
    // Capacitor 8 / Android 15（targetSdk 35+）强制 edge-to-edge：系统栏会盖在 WebView 上，
    // 底部导航不处理就会被手势条压住（孩子点底栏 = 误触 Home / 返回）。
    //
    // SystemBars 是 Capacitor 8 自带的系统栏插件（无需新增依赖）：
    // - insetsHandling: 'css'（默认值，这里显式写出来）：新 WebView（Chromium >= 140）把真实
    //   安全区透传给网页的 env(safe-area-inset-*)；老 WebView 由原生给 WebView 本身内缩，
    //   两种情况下 #app 的 padding-bottom: env(safe-area-inset-bottom) 都能让底栏离开手势条。
    // - initialViewportFitValueHint: 'cover'：站点 index.html 已是 viewport-fit=cover，
    //   提前告诉原生，避免首帧按 contain 布局再跳一下。
    //
    // 需要真机验证：本环境没有 Android SDK / 模拟器，pack:check 只能校验配置与站点侧的前提。
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;