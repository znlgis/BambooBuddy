import type { Locale } from '@bamboo/content/ids';
import type {
  ArcadeContext,
  ArcadeEventMap,
  ArcadeManifest,
} from '@bamboo/game-kit';
import { readDebugOptions } from './createGameContext';
import { recordDebugEvent } from './debug';
import { platform } from './platform';

export interface ArcadeHostHooks {
  onEvent: <K extends keyof ArcadeEventMap>(type: K, payload: ArcadeEventMap[K]) => void;
  /** 离开这一局（完成卡片 / 顶部返回确认） */
  onExit: () => void;
}

function detailOf<K extends keyof ArcadeEventMap>(
  type: K,
  payload: ArcadeEventMap[K],
): string | undefined {
  if (type === 'arcade:start' || type === 'arcade:complete') {
    return (payload as ArcadeEventMap['arcade:start']).gameId;
  }
  if (type === 'arcade:round') {
    const round = payload as ArcadeEventMap['arcade:round'];
    return round.gameId + ':' + round.round;
  }
  if (type === 'arcade:exit') return (payload as ArcadeEventMap['arcade:exit']).reason;
  return undefined;
}

/**
 * 交给隐藏小游戏的运行时上下文：与 createGameContext 同一套平台出口、同一套调试开关，
 * 只是没有任务内容（彩蛋不是内容 JSON 驱动的，也不该碰任务存档）。
 */
export function createArcadeContext(
  manifest: ArcadeManifest,
  container: HTMLElement,
  hooks: ArcadeHostHooks,
  locale: Locale,
): ArcadeContext {
  return {
    container,
    manifest,
    services: platform,
    locale,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    debug: readDebugOptions(),
    emit(type, payload) {
      recordDebugEvent(type, detailOf(type, payload));
      hooks.onEvent(type, payload);
    },
    requestExit() {
      hooks.onExit();
    },
  };
}
