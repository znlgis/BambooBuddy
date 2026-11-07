import type { DebugOptions, PlatformServices } from './contract';
import type { ArcadeGameId, Locale } from './contract';

/** 难度等级：每完成 ARCADE_LEVEL_EVERY_PLAYS 局升一级，最高 ARCADE_LEVEL_MAX 级 */
export const ARCADE_LEVEL_EVERY_PLAYS = 2;
/** 难度封顶：到顶后不再变难，但无限畅玩仍然可以一直玩 */
export const ARCADE_LEVEL_MAX = 12;

/** 由某款游戏累计完成的局数算难度等级（1..ARCADE_LEVEL_MAX）；存档、界面与游戏共用这一份 */
export function arcadeLevelFor(plays: number): number {
  // NaN / 负数当 0（1 级）；+Infinity 自然封顶到最高级
  const safePlays = Number.isNaN(plays) ? 0 : Math.max(0, Math.floor(plays));
  return Math.min(ARCADE_LEVEL_MAX, 1 + Math.floor(safePlays / ARCADE_LEVEL_EVERY_PLAYS));
}

/**
 * 隐藏小游戏的契约（不含 Phaser、不含 TaskId）。
 *
 * 为什么不复用 GameContext：那套契约的中心是「一条任务 + 关卡数据 + task:complete + 星星」，
 * 而三款彩蛋是实时街机（自己的帧循环、状态机、AI），没有内容 JSON、没有星星、也不该动任务存档。
 */
export interface ArcadeManifest {
  id: ArcadeGameId;
  /** 中文名（界面展示走 i18n 的 arcade.<id>.name） */
  title: string;
  version: string;
  designSize: { width: number; height: number };
  ageRange: [number, number];
}

/** 一局结束后的去向：once = 结算回游戏厅；continuous = 无限畅玩，外壳直接接着开下一局 */
export type ArcadeRoundMode = 'once' | 'continuous';

export interface ArcadeEventMap {
  'arcade:start': { gameId: ArcadeGameId; at: number };
  'arcade:round': { gameId: ArcadeGameId; round: number; totalRounds: number };
  /** 一局真正结束：外壳据此写存档（最高分 + 今天玩过）；mode 告诉外壳要不要接着开下一局 */
  'arcade:complete': {
    gameId: ArcadeGameId;
    score: number;
    durationMs: number;
    mode: ArcadeRoundMode;
  };
  'arcade:exit': { reason: 'complete' | 'quit' };
}

export interface ArcadeContext {
  container: HTMLElement;
  manifest: ArcadeManifest;
  /** 复用同一个平台出口：小游戏只用到 audio / now */
  services: PlatformServices;
  locale: Locale;
  reducedMotion: boolean;
  /** 本局难度等级（1..ARCADE_LEVEL_MAX）：外壳按该游戏累计局数传入，游戏逻辑据此调参 */
  level: number;
  /**
   * 无限畅玩（竹林小路）：一局结束后不弹「明天再来」、不返回游戏厅，
   * 由外壳直接接着开下一局，直到孩子自己按返回/关闭。
   */
  unlimited: boolean;
  /** ?autoplay=1 自动通关 / ?instant=1 跳过过场（与日常玩法同一套开关） */
  debug?: DebugOptions;
  emit<K extends keyof ArcadeEventMap>(type: K, payload: ArcadeEventMap[K]): void;
  requestExit(reason?: 'quit'): void;
}

export interface ArcadeModule {
  manifest: ArcadeManifest;
  mount(ctx: ArcadeContext): Promise<void>;
  unmount(): Promise<void>;
  pause(): void;
  resume(): void;
}
