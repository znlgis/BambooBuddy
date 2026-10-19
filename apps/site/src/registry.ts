import type { TaskId } from '@bamboo/content';
import type { GameModule } from '@bamboo/game-kit';

export type GameLoader = () => Promise<{ default: GameModule }>;

/**
 * 任务 id → 玩法包。外壳不认识任何具体玩法，Vite 会把十个玩法各自切成独立 chunk，
 * Phaser 只在这些 chunk 里（首屏因此不含游戏引擎）。
 * 新增一个日常任务 = 加一行 —— 子路径由 games/daily/package.json 的 exports 锁死。
 */
export const registry: Record<TaskId, GameLoader> = {
  brush: () => import('@bamboo/game-daily/brush'),
  wash: () => import('@bamboo/game-daily/wash'),
  feed: () => import('@bamboo/game-daily/feed'),
  dress: () => import('@bamboo/game-daily/dress'),
  bath: () => import('@bamboo/game-daily/bath'),
  sleep: () => import('@bamboo/game-daily/sleep'),
  tidy: () => import('@bamboo/game-daily/tidy'),
  sport: () => import('@bamboo/game-daily/sport'),
  emotion: () => import('@bamboo/game-daily/emotion'),
  learn: () => import('@bamboo/game-daily/learn'),
};
