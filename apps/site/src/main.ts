import { ensureSummaries } from '@bamboo/content';
import { ensureMessages } from '@bamboo/i18n';
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
 */
const initial = initialLocale();
void Promise.all([ensureSummaries(initial.locale), ensureMessages(initial.locale)]).finally(() => {
  if (initial.fromUrl) persistLocale(initial.locale);
  applyLocaleDocument(initial.locale);
  createApp(App).use(createPinia()).mount('#app');
});