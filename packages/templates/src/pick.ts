import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  CSS,
  drawEmotionFace,
  drawPanda,
  drawRoom,
  drawRug,
  heartPath,
  popIn,
  roundRect,
  shade,
  sparkleAt,
  textStyle,
  THEME,
} from '@bamboo/phaser-kit';
import type { PandaMood } from '@bamboo/phaser-kit';
import { SCENE_KEYS } from './layout';
import { COMFORT_LABELS, chooseEmotion, comfort, createPickState, currentRound } from './pick.logic';
import type { Emotion, PickLevel, PickState } from './pick.logic';

/** 三张脸卡片的尺寸（≥150×180 的儿童可点下限，这里留得更大） */
const FACE = { w: 200, h: 230, gap: 24, top: 950 } as const;
/** 竹竹站位：脚踩在小地毯上，卡片在它前面一排 */
const PANDA = { x: 375, y: 760, scale: 0.82 } as const;
/** 安慰按钮：与卡片同一套"手动画 + 手动命中"，避免 Phaser 容器命中区在 4.x 的怪癖 */
const COMFORT = { cx: 375, cy: 1254, w: 460, h: 104 } as const;

/** 卡片下面的字：先认脸，字只是补充（4–8 岁不一定识字） */
const EMOTION_LABELS: Record<Emotion, string> = {
  happy: '开心',
  sad: '难过',
  angry: '生气',
  scared: '害怕',
  sleepy: '困了',
};

/**
 * 竹竹本体没有"害怕"这个表情，用难过的脸近似；
 * 脸卡片上仍然是完整的害怕脸（竖眉 + 圆嘴），所以认知目标不受影响。
 */
function pandaMoodOf(emotion: Emotion): PandaMood {
  switch (emotion) {
    case 'happy':
      return 'happy';
    case 'sad':
      return 'sad';
    case 'angry':
      return 'angry';
    case 'sleepy':
      return 'sleepy';
    case 'scared':
      return 'sad';
  }
}

interface FaceOption {
  emotion: Emotion;
  node: Phaser.GameObjects.Container;
  x: number;
  y: number;
}

/**
 * 认情绪：看竹竹现在的脸，从三张里选出同样的心情，再做一个安慰动作。
 *
 * 选错只是换一句更温柔的话（任务内容里的 retry），不扣任何东西；
 * 选对就进入"安慰"阶段 —— 孩子既练了识别，也练了回应别人的情绪。
 */
export function createPickScene(ctx: GameContext, level: PickLevel): Phaser.Types.Scenes.SceneType {
  return class PickScene extends BaseScene {
    private readonly level: PickLevel;
    private state: PickState = createPickState();
    private panda: Phaser.GameObjects.Graphics | null = null;
    private questionText: Phaser.GameObjects.Text | null = null;
    private progressText: Phaser.GameObjects.Text | null = null;
    private cards: FaceOption[] = [];
    private comfortNode: Phaser.GameObjects.Container | null = null;
    private comfortVisible = false;
    /** 自动通关的节拍走墙钟 setTimeout：无头 CI 帧率低时 Phaser Clock 会因 delta 平滑而变慢 */
    private autoTimer: number | null = null;
    private done = false;

    constructor() {
      super(SCENE_KEYS.pick, ctx);
      this.level = level;
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.pick });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });

      this.drawHeader(this.ctx.task.title);
      this.drawScenery();
      this.drawQuestionCard();
      this.progressText = this.add
        .text(this.W - 52, 122, '', textStyle(30, CSS.paper, true))
        .setOrigin(1, 0.5)
        .setDepth(21);
      this.panda = this.add.graphics().setDepth(3);
      this.renderRound();

      this.input.on('pointerdown', this.onPointerDown);
      this.onShutdownCleanup(() => {
        this.input.off('pointerdown', this.onPointerDown);
        this.clearAuto();
      });

      this.fadeIn();
      // 自动通关是给 QA 的：与真实操作共用 chooseFace / pressComfort，只是替孩子点
      if (this.autoplay) this.autoTimer = window.setTimeout(() => this.autoStep(), this.autoDelay());
    }

    // ---------------- 输入 ----------------

    private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
      if (this.done) return;
      if (this.state.phase === 'comfort') {
        if (!this.comfortVisible) return;
        if (
          Math.abs(pointer.x - COMFORT.cx) <= COMFORT.w / 2 &&
          Math.abs(pointer.y - COMFORT.cy) <= COMFORT.h / 2
        ) {
          this.pressComfort();
        }
        return;
      }
      const card = this.cards.find(
        (item) =>
          Math.abs(pointer.x - item.x) <= FACE.w / 2 && Math.abs(pointer.y - item.y) <= FACE.h / 2,
      );
      if (card) this.chooseFace(card.emotion);
    };

    /** 真实点击与 ?autoplay=1 共用的判定入口 */
    private chooseFace(emotion: Emotion): void {
      if (this.done) return;
      const round = currentRound(this.state, this.level);
      if (!round) return;
      const result = chooseEmotion(this.state, this.level, emotion);

      if (result.status === 'wrong') {
        // 只放一声柔和的重试音 + 一句"再看看"，不扣星星、不禁止再选
        this.noteMistake('pick');
        const card = this.cards.find((item) => item.emotion === emotion);
        if (card) this.shakeCard(card);
        this.say(this.ctx.task.retry, 1800, 912);
        return;
      }
      if (result.status !== 'comfort') return;

      this.state = result.state;
      this.noteCorrect();
      this.sfx('sparkle');
      sparkleAt(this, PANDA.x, PANDA.y - 120, THEME.gold, 7);
      this.enterComfort();
    }

    /** 安慰动作：与真实点击按钮共用 */
    private pressComfort(): void {
      if (this.done || this.state.phase !== 'comfort' || !this.comfortVisible) return;
      this.sfx('tap');
      this.hideComfort();
      const result = comfort(this.state, this.level);
      this.state = result.state;
      this.sfx('sparkle');
      if (result.finished) {
        this.finish();
        return;
      }
      this.renderRound();
    }

    // ---------------- 自动通关 ----------------

    private autoDelay(): number {
      return this.instant ? 240 : 520;
    }

    private autoStep(): void {
      if (this.done) return;
      if (this.state.phase === 'choose') {
        const round = currentRound(this.state, this.level);
        if (round) this.chooseFace(round.target);
      } else {
        this.pressComfort();
      }
      if (!this.done) this.autoTimer = window.setTimeout(() => this.autoStep(), this.autoDelay());
    }

    private clearAuto(): void {
      if (this.autoTimer !== null) {
        window.clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
    }

    // ---------------- 回合 ----------------

    private renderRound(): void {
      const round = currentRound(this.state, this.level);
      if (!round) return;
      this.clearCards();
      this.hideComfort();
      this.drawPandaMood(pandaMoodOf(round.target));
      this.questionText?.setText(round.question);
      this.progressText?.setText(`${this.state.round + 1} / ${this.level.rounds.length}`);
      this.buildCards(round.options);
      if (!this.autoplay && !this.instant) this.speak(round.question);
    }

    private enterComfort(): void {
      const round = currentRound(this.state, this.level);
      if (!round) return;
      this.clearCards();
      // 认出心情之后，竹竹的笑容和小爱心就是最直接的"你懂我"
      this.drawPandaMood('happy', true);
      this.showComfortButton(COMFORT_LABELS[round.comfort]);
      if (!this.autoplay && !this.instant) this.speak(COMFORT_LABELS[round.comfort]);
    }

    private finish(): void {
      if (this.done) return;
      this.done = true;
      this.clearAuto();
      this.hideComfort();
      this.clearCards();
      if (this.autoplay || this.instant) {
        this.finishTask({ praise: this.ctx.task.done });
        return;
      }
      this.time.delayedCall(240, () => this.finishTask({ praise: this.ctx.task.done }));
    }

    // ---------------- 绘制 ----------------

    private drawScenery(): void {
      const bg = this.add.graphics().setDepth(0);
      drawRoom(bg, 'bedroom', this.W, this.H);
      drawRug(bg, this.W / 2, 880, 560, 160, THEME.lavender);
    }

    private drawQuestionCard(): void {
      const card = this.add.graphics().setDepth(1);
      roundRect(card, 55, 176, 640, 152, 30, THEME.card, THEME.outline, 6);
      roundRect(card, 71, 192, 608, 120, 20, THEME.paperDeep, null, 0);
      this.questionText = this.add
        .text(this.W / 2, 252, '', {
          ...textStyle(38, CSS.ink, true),
          align: 'center',
          wordWrap: { width: 560, useAdvancedWrap: true },
        })
        .setOrigin(0.5)
        .setDepth(2);
    }

    private drawPandaMood(mood: PandaMood, hearts = false): void {
      const g = this.panda;
      if (!g) return;
      g.clear();
      drawPanda(g, PANDA.x, PANDA.y, PANDA.scale, { mood, hearts });
    }

    private buildCards(options: readonly Emotion[]): void {
      const count = options.length;
      const total = count * FACE.w + (count - 1) * FACE.gap;
      const startX = (this.W - total) / 2;
      const cy = FACE.top + FACE.h / 2;
      options.forEach((emotion, index) => {
        const cx = startX + index * (FACE.w + FACE.gap) + FACE.w / 2;
        const node = this.add.container(cx, cy).setDepth(2);
        const g = this.add.graphics();
        roundRect(g, -FACE.w / 2, -FACE.h / 2, FACE.w, FACE.h, 26, THEME.card, THEME.outline, 6);
        roundRect(g, -FACE.w / 2 + 12, -FACE.h / 2 + 12, FACE.w - 24, FACE.h - 24, 18, THEME.paper, null, 0);
        drawEmotionFace(g, emotion, 0, -22, 62);
        const label = this.add
          .text(0, 78, EMOTION_LABELS[emotion], textStyle(34, CSS.ink, true))
          .setOrigin(0.5);
        node.add([g, label]);
        this.cards.push({ emotion, node, x: cx, y: cy });
      });
    }

    private shakeCard(card: FaceOption): void {
      if (this.reducedMotion) return;
      this.tweens.killTweensOf(card.node);
      card.node.x = card.x;
      this.tweens.add({
        targets: card.node,
        x: card.x + 14,
        duration: 70,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => card.node.setX(card.x),
      });
    }

    private clearCards(): void {
      for (const card of this.cards) {
        // 卡片可能在晃动补间里：先停掉再销毁，避免动画继续写已销毁对象
        this.tweens.killTweensOf(card.node);
        card.node.destroy(true);
      }
      this.cards = [];
    }

    private showComfortButton(label: string): void {
      if (this.comfortNode) return;
      const node = this.add.container(COMFORT.cx, COMFORT.cy).setDepth(6);
      const g = this.add.graphics();
      roundRect(g, -COMFORT.w / 2, -COMFORT.h / 2 + 8, COMFORT.w, COMFORT.h, COMFORT.h / 2, shade(THEME.bamboo, 0.72), THEME.outline, 4);
      roundRect(g, -COMFORT.w / 2, -COMFORT.h / 2, COMFORT.w, COMFORT.h, COMFORT.h / 2, THEME.bamboo, THEME.outline, 5);
      heartPath(g, -COMFORT.w / 2 + 62, 0, 27, THEME.card, null);
      const text = this.add.text(20, -2, label, textStyle(40, CSS.card, true)).setOrigin(0.5);
      node.add([g, text]);
      this.comfortNode = node;
      this.comfortVisible = true;
      popIn(this, node);
    }

    private hideComfort(): void {
      this.comfortVisible = false;
      this.comfortNode?.destroy(true);
      this.comfortNode = null;
    }
  };
}
