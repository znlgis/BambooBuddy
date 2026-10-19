import { ProgressManager } from '@bamboo/progress';
import { initDebugBridge, setDebugSave } from './debug';
import { platform } from './platform';

/**
 * 存档编排器：读档只在第一次发生（single-flight），所有会改存档的操作都经过它。
 * 界面层只调它的方法拿结果，绝不自己拼 SaveData。
 */
export const progressManager = new ProgressManager(platform.storage, () => platform.now());

// 启动即把空档挂到 window.__bamboo.save：e2e 不需要等界面点出任何东西
initDebugBridge(platform.now());
setDebugSave(progressManager.snapshot());
