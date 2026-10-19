import { loadTask } from '@bamboo/content';
import type { Locale } from '@bamboo/content/ids';
import type { DebugOptions, GameContext, GameEventMap, GameManifest } from '@bamboo/game-kit';
import { recordDebugEvent } from './debug';
import { platform } from './platform';

export interface GameHostHooks {
  /** 退出原因：replay = 原地再来一局（不刷新页面） */
  onExit: (reason?: 'quit' | 'replay') => void;
  onEvent: <K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]) => void;
}

/**
 * 调试开关只对开发服务器与自动化浏览器开放：
 * 否则一个分享链接带上 ?autoplay=1 就能自动通关把星星写进存档。
 */
function debugAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

/** ?autoplay=1 自动通关；?instant=1 跳过过场与语音等待（截图/冒烟巡检用） */
export function readDebugOptions(): DebugOptions | undefined {
  if (!debugAllowed()) return undefined;
  // 两个来源都要认：'/?autoplay=1#/play/brush' 与 '/#/play/brush?autoplay=1'。
  // search 里的显式参数优先（家长可能把带参数的链接收藏起来）。
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const queryAt = hash.indexOf('?');
  if (queryAt >= 0) {
    for (const [key, value] of new URLSearchParams(hash.slice(queryAt + 1))) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  const autoplay = params.get('autoplay') === '1';
  const instant = params.get('instant') === '1';
  if (!autoplay && !instant) return undefined;
  const options: DebugOptions = {};
  if (autoplay) options.autoplay = true;
  if (instant) options.instant = true;
  return options;
}

/** 事件细节：e2e 靠它区分"哪一个场景 / 哪一个任务 / 哪种退出" */
function detailOf<K extends keyof GameEventMap>(
  type: K,
  payload: GameEventMap[K],
): string | undefined {
  if (type === 'scene:enter') return (payload as GameEventMap['scene:enter']).scene;
  if (type === 'task:retry') return (payload as GameEventMap['task:retry']).step;
  if (type === 'task:complete') return (payload as GameEventMap['task:complete']).taskId;
  if (type === 'session:exit') return (payload as GameEventMap['session:exit']).reason;
  return undefined;
}

/**
 * 交给玩法的运行时上下文。
 * ★ 异步：完整内容（语音文案 / 关卡脚本）走动态 import，
 * 首屏只有摘要，进入玩法的那一刻才下载这一关的详情。
 */
export async function createGameContext(
  manifest: GameManifest,
  container: HTMLElement,
  hooks: GameHostHooks,
  completedBefore: boolean,
  locale: Locale,
): Promise<GameContext> {
  const task = await loadTask(manifest.id, locale);
  if (!task) throw new Error('找不到玩法内容：' + manifest.id);

  return {
    container,
    manifest,
    task,
    services: platform,
    locale,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    debug: readDebugOptions(),
    completedBefore,
    emit(type, payload) {
      platform.telemetry.track(type, payload);
      recordDebugEvent(type, detailOf(type, payload));
      hooks.onEvent(type, payload);
    },
    requestExit(reason) {
      hooks.onExit(reason);
    },
  };
}