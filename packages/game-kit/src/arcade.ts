import type { DebugOptions, PlatformServices } from './contract';
import type { ArcadeGameId, Locale } from './contract';

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

export interface ArcadeEventMap {
  'arcade:start': { gameId: ArcadeGameId; at: number };
  'arcade:round': { gameId: ArcadeGameId; round: number; totalRounds: number };
  /** 一局真正结束：外壳据此写存档（最高分 + 今天玩过） */
  'arcade:complete': { gameId: ArcadeGameId; score: number; durationMs: number };
  'arcade:exit': { reason: 'complete' | 'quit' };
}

export interface ArcadeContext {
  container: HTMLElement;
  manifest: ArcadeManifest;
  /** 复用同一个平台出口：小游戏只用到 audio / now */
  services: PlatformServices;
  locale: Locale;
  reducedMotion: boolean;
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
