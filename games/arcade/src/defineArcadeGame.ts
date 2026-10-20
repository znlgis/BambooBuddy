import type { ArcadeContext, ArcadeManifest, ArcadeModule } from '@bamboo/game-kit';
import { createPhaserGame } from '@bamboo/phaser-kit';
import type Phaser from 'phaser';

export interface ArcadeGameDefinition {
  manifest: ArcadeManifest;
  /** 一局的场景编排（三款都是一屏一场景，但接口留成数组，与日常玩法一致） */
  scenes: (ctx: ArcadeContext) => Phaser.Types.Scenes.SceneType[];
}

/**
 * 一个隐藏小游戏 = 一个场景 + 生命周期。与日常玩法的 defineGame 同构，
 * 但上下文是 ArcadeContext（没有任务、没有星星、不写任务存档）。
 */
export function defineArcadeGame(definition: ArcadeGameDefinition): ArcadeModule {
  let game: Phaser.Game | null = null;

  return {
    manifest: definition.manifest,

    async mount(ctx: ArcadeContext): Promise<void> {
      game = createPhaserGame(ctx, { scenes: definition.scenes(ctx) });
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
