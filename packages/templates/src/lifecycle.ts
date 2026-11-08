import type Phaser from 'phaser';
import { createPhaserGame } from '@bamboo/phaser-kit';
import type { PhaserGameHost } from '@bamboo/phaser-kit';

/**
 * 一套游戏的生命周期：日常玩法（GameContext）与隐藏小游戏（ArcadeContext）共用这一段。
 * 放在 templates 包内（而不是 phaser-kit）是因为它只服务「游戏包」这一层；
 * 隐藏小游戏包不能 import templates（会多一条 workspace 依赖），所以 defineArcadeGame
 * 仍然自己写了一遍同构实现，并在那边补了同样的「mount 防重入」。
 */
export interface GameLifecycle {
  mount(host: PhaserGameHost, scenes: Phaser.Types.Scenes.SceneType[]): Promise<void>;
  unmount(): Promise<void>;
  pause(): void;
  resume(): void;
}

export function createGameLifecycle(): GameLifecycle {
  let game: Phaser.Game | null = null;

  return {
    async mount(host, scenes): Promise<void> {
      // 防重入：外壳重试 / HMR 时若上一局没销毁干净，先收掉，避免残留 canvas 与 rAF 循环
      if (game !== null) {
        game.destroy(true);
        game = null;
      }
      game = createPhaserGame(host, { scenes });
    },

    async unmount(): Promise<void> {
      game?.destroy(true);
      game = null;
    },

    pause(): void {
      game?.loop.sleep();
    },

    resume(): void {
      game?.loop.wake();
    },
  };
}
