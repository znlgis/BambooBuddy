import type { GameContext } from '@bamboo/game-kit';
import { BaseScene, CSS, drawPanda, drawRoom, roundRect, THEME, textStyle } from '@bamboo/phaser-kit';
import { PANDA, SCENE_KEYS } from './layout';

/**
 * 模板还没接上时的占位玩法：仍然走完整的"开始 → 完成 → 存档"链路，
 * 让外壳、存档、家长页与端到端测试可以先跑通（场景实装后逐个替换）。
 */
export function createPlaceholderScene(ctx: GameContext): Phaser.Types.Scenes.SceneType {
  return class PlaceholderScene extends BaseScene {
    constructor() {
      super(SCENE_KEYS.placeholder, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.placeholder });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });
      const g = this.add.graphics();
      drawRoom(g, 'playroom', this.W, this.H);
      drawPanda(g, PANDA.x, PANDA.groundY, PANDA.scale, { mood: 'happy' });
      this.drawHeader(ctx.task.title);
      const card = this.add.graphics();
      roundRect(card, 95, 640, 560, 190, 36, THEME.card, THEME.outline, 6);
      this.add
        .text(this.W / 2, 735, ctx.task.intro, {
          ...textStyle(34, CSS.ink, true),
          align: 'center',
          wordWrap: { width: 490, useAdvancedWrap: true },
        })
        .setOrigin(0.5);
      this.addButton(this.W / 2, 1010, this.tr('game.start'), () => {
        this.noteCorrect();
        this.finishTask();
      });
      this.speak(ctx.task.intro);
      if (this.autoplay) this.time.delayedCall(120, () => this.finishTask());
    }
  };
}