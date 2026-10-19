import { defineStore } from 'pinia';
import { ref } from 'vue';
import { platform } from '../shell/platform';

/** 键与取值都固定：e2e 会直接读 localStorage 断言（'1' 静音 / '0' 有声音） */
const MUTED_KEY = 'bamboo.muted';

/**
 * 声音开关。给孩子的产品必须有这个：公交上、睡前、课堂上都需要"静音但还能玩"。
 * 音效与朗读都走 platform.audio，setMuted 会同时停掉正在念的旁白。
 */
export const useSettings = defineStore('settings', () => {
  const muted = ref(false);

  /** 隐私模式里 localStorage 可能直接抛错：读不到就按"有声音"处理，本次会话仍可手动关 */
  function readMuted(): boolean {
    try {
      return window.localStorage.getItem(MUTED_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** 启动时读回上次的选择 */
  function init(): void {
    const saved = readMuted();
    muted.value = saved;
    platform.audio.setMuted(saved);
  }

  function setMuted(next: boolean): void {
    muted.value = next;
    platform.audio.setMuted(next);
    if (next) platform.audio.stopSpeech();
    try {
      window.localStorage.setItem(MUTED_KEY, next ? '1' : '0');
    } catch {
      // 写不了也无所谓：本次会话仍然生效
    }
  }

  function toggle(): void {
    setMuted(!muted.value);
  }

  return { muted, init, setMuted, toggle };
});
