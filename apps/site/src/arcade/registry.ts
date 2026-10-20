import type { ArcadeGameId, ArcadeModule } from '@bamboo/game-kit';

export type ArcadeLoader = () => Promise<{ default: ArcadeModule }>;

/**
 * 隐藏小游戏 id → 玩法包。三款各自切成独立 chunk（Vite 按 games 包的入口文件命名），
 * Phaser 仍走共享的 vendor chunk；首屏一分不涨。
 */
export const arcadeRegistry: Record<ArcadeGameId, ArcadeLoader> = {
  popstar: () => import('@bamboo/game-arcade/popstar'),
  bounce: () => import('@bamboo/game-arcade/bounce'),
  tetris: () => import('@bamboo/game-arcade/tetris'),
};
