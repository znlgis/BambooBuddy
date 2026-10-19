import { createWebPlatform } from '@bamboo/platform';

/**
 * 唯一的平台出口：存档（IndexedDB）、音频（WebAudio + TTS）、生命周期、遥测。
 * 游戏与界面都不许绕过它去碰 localStorage / fetch —— 儿童产品的边界就靠这一层守住。
 */
export const platform = createWebPlatform();
