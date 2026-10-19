import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { initDebugBridge } from './shell/debug';
import './style.css';

/**
 * 调试桥在挂载之前就建好：e2e 可能一打开页面就读 window.__bamboo.save，
 * 不等用户点任何东西。它不含任何个人信息，生产环境同样开着。
 */
initDebugBridge();

createApp(App).use(createPinia()).mount('#app');
