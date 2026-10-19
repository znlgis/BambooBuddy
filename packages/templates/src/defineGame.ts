import type { GameContext, GameManifest, GameModule } from '@bamboo/game-kit';
import { createPhaserGame } from '@bamboo/phaser-kit';
import type Phaser from 'phaser';

export interface GameDefinition {
  manifest: GameManifest;
  /**
   * 这一局的场景编排。关卡脚本在构建期由 content:check 用模板 schema 校验，
   * 运行时不再跑 zod（否则 zod + 全部模板 schema 会进每个游戏 chunk）。
   */
  scenes: (ctx: GameContext) => Phaser.Types.Scenes.SceneType[];
}

/**
 * 一个日常玩法 = 一个模板场景 + 生命周期。
 * 十个玩法共用这一段，游戏包只剩下"这一关数据怎么交给模板"。
 */
export function defineGame(definition: GameDefinition): GameModule {
  let game: Phaser.Game | null = null;

  return {
    manifest: definition.manifest,

    async mount(ctx: GameContext): Promise<void> {
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
