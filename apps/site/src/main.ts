import { ensureSummaries } from '@bamboo/content';
import { ensureMessages } from '@bamboo/i18n';
import type { Locale } from '@bamboo/content/ids';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { applyLocaleDocument, initialLocale, persistLocale } from './logic/locale';
import { initDebugBridge } from './shell/debug';
import './style.css';

/**
 * 调试桥在挂载之前就建好：e2e 可能一打开页面就读 window.__bamboo.save，
 * 不等用户点任何东西。它不含任何个人信息，生产环境同样开着。
 */
initDebugBridge();

/**
 * 英文内容补丁是独立 chunk：?lang=en 或上次选过英文时，要在首屏之前就位，
 * 否则会先闪一屏中文标题。中文用户不下载这份 chunk。
 *
 * 关键：英文文案**加载失败时不能假装成功**。以前 ensureMessages 失败也 resolve，
 * 于是 <html lang="en"> + 中文界面 + 把 en 写进 localStorage，下次打开仍是"假英文"，
 * 没有任何入口能发现。现在失败就回落到中文，并且只持久化"真正生效"的语言。
 * 无论加载成功与否都要 mount —— 白屏是比"语言没切过去"严重得多的事故。
 */
const initial = initialLocale();
void (async () => {
  let locale: Locale = initial.locale;
  try {
    const messagesReady = await ensureMessages(initial.locale);
    await ensureSummaries(initial.locale);
    if (initial.locale === 'en' && !messagesReady) locale = 'zh-CN';
  } catch {
    // 加载异常不该挡住启动：回落到中文，界面照常可用
    locale = 'zh-CN';
  } finally {
    if (initial.fromUrl) persistLocale(locale);
    applyLocaleDocument(locale);
    createApp(App).use(createPinia()).mount('#app');
  }
})();
