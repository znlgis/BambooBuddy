import { onBeforeUnmount, onMounted } from 'vue';
import { platform } from './platform';

/**
 * 玩耍计时：给「20 分钟休息提醒」与家长页提供数据。
 *
 * 为什么不每 30 秒写一次档：`addPlaySeconds` 每次都会走完整存档落盘（IndexedDB
 * 整份序列化 + 写入）。孩子一局游戏 60 秒写两次、20 分钟写 40 次，对旧手机是
 * 白白的写放大与耗电。这里把秒数先累加在内存里，每 FLUSH_MS 合并落盘一次，
 * 页面切后台 / 卸载时再补一次 —— 提醒以分钟计，精度足够，写入量降到约 1/10。
 *
 * 计时口径与改造前一致：只在游戏页挂载期间累计，休息提醒按"游戏时间"算。
 */

/** 每 30 秒累计一次（与改造前一致的采样粒度） */
const TICK_SECONDS = 30;
/** 内存里的秒数最多攒这么久就落一次盘（5 分钟） */
const FLUSH_MS = 5 * 60 * 1000;

export function startPlayClock(addSeconds: (seconds: number) => Promise<void>): void {
  let pending = 0;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let offPause: (() => void) | null = null;

  async function flush(): Promise<void> {
    const seconds = pending;
    if (seconds <= 0) return;
    pending = 0;
    try {
      await addSeconds(seconds);
    } catch {
      // 写档失败：把这批秒数放回去，下一次 flush 还有机会补上
      pending += seconds;
    }
  }

  /** 只在页面前台可见时累计：后台标签页的定时器会被节流，按 tick 计会把后台时间也算成游戏时间 */
  function visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  onMounted(() => {
    tickTimer = setInterval(() => {
      if (visible()) pending += TICK_SECONDS;
    }, TICK_SECONDS * 1000);
    flushTimer = setInterval(() => {
      void flush();
    }, FLUSH_MS);
    // 切后台就落一次：移动端标签页被系统回收时，onBeforeUnmount 不一定跑得到
    offPause = platform.lifecycle.onPause(() => {
      void flush();
    });
  });

  onBeforeUnmount(() => {
    if (tickTimer !== null) clearInterval(tickTimer);
    if (flushTimer !== null) clearInterval(flushTimer);
    tickTimer = null;
    flushTimer = null;
    offPause?.();
    offPause = null;
    // 卸载时把剩下的秒数写掉；不 await（组件正在销毁，写盘不该阻塞导航）
    void flush();
  });
}
