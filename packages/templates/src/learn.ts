import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  circle,
  CSS,
  drawPanda,
  drawRoom,
  drawRug,
  drawShape,
  roundRect,
  sparkleAt,
  starPath,
  textStyle,
  THEME,
} from '@bamboo/phaser-kit';
import type Phaser from 'phaser';
import { SCENE_KEYS } from './layout';
import { chooseOption, createLearnState, currentQuestion } from './learn.logic';
import type { LearnLevel, LearnState, Shape } from './learn.logic';

/** 选项卡片：比"≥190×240"再宽一点，孩子不用瞄准 */
const CARD = { w: 200, h: 250, gap: 24, top: 910, margin: 40 } as const;
/** 竹竹站在右侧的小垫子上，把黑板与卡片中间留给孩子看题 */
const PANDA = { x: 588, y: 780, scale: 0.62 } as const;

type LearnRound = LearnLevel['rounds'][number];

/** 形状卡片的颜色只用来区分图形，不承担"正确答案"的信息（答案看形状本身） */
const SHAPE_COLORS: Record<Shape, number> = {
  circle: THEME.warmRed,
  square: THEME.bamboo,
  triangle: THEME.gold,
  star: THEME.sun,
  heart: THEME.pink,
};

/** 内容里的颜色是 #rrggbb，绘制层要数字；写坏了就用灰色兜底，不让画面炸掉 */
function colorOf(hex: string | undefined, fallback: number): number {
  return hex ? Number.parseInt(hex.slice(1), 16) : fallback;
}

interface OptionCard {
  index: number;
  node: Phaser.GameObjects.Container;
  x: number;
  y: number;
}

/**
 * 轻认知：认颜色 / 形状 / 数字，点卡片作答。
 *
 * 同一题可以一直重试，选错只是卡片轻轻晃一下 + 一句"再想想"；
 * 答对后 600ms 才换下一题 —— 给孩子一点时间看见自己答对了。
 */
export function createLearnScene(ctx: GameContext, level: LearnLevel): Phaser.Types.Scenes.SceneType {
  return class LearnScene extends BaseScene {
    private readonly level: LearnLevel;
    private state: LearnState = createLearnState();
    private questionText: Phaser.GameObjects.Text | null = null;
    private progressText: Phaser.GameObjects.Text | null = null;
    private cards: OptionCard[] = [];
    /** 当前一题的卡片宽度（选项数不同会收缩，命中判定必须用同一个值） */
    private cardW: number = CARD.w;
    /** 答对后到下一题之间的短暂锁：防止连点把下一题也点掉 */
    private locked = false;
    /** 自动通关与换题延时都走墙钟 setTimeout：无头 CI 帧率低时 Phaser Clock 会变慢 */
    private autoTimer: number | null = null;
    private stepTimer: number | null = null;
    private done = false;

    constructor() {
      super(SCENE_KEYS.learn, ctx);
      this.level = level;
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.learn });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });

      this.drawHeader(this.ctx.task.title);
      this.drawClassroom();
      this.drawPandaAside();
      this.drawBoard();
      this.progressText = this.add
        .text(this.W - 52, 122, '', textStyle(30, CSS.paper, true))
        .setOrigin(1, 0.5)
        .setDepth(21);
      this.renderQuestion();

      this.input.on('pointerdown', this.onPointerDown);
      this.onShutdownCleanup(() => {
        this.input.off('pointerdown', this.onPointerDown);
        this.clearTimers();
      });

      this.fadeIn();
      // 自动通关与真实操作共用 chooseCard（答案直接取自关卡脚本）
      if (this.autoplay) this.autoTimer = window.setTimeout(() => this.autoStep(), this.autoDelay());
    }

    // ---------------- 输入 ----------------

    private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
      if (this.done || this.locked) return;
      const card = this.cards.find(
        (item) =>
          Math.abs(pointer.x - item.x) <= this.cardW / 2 && Math.abs(pointer.y - item.y) <= CARD.h / 2,
      );
      if (card) this.chooseCard(card.index);
    };

    private autoDelay(): number {
      return this.instant ? 260 : 800;
    }

    private autoStep(): void {
      if (this.done) return;
      if (!this.locked) {
        const question = currentQuestion(this.state, this.level);
        if (question) this.chooseCard(question.answer);
      }
      if (!this.done) this.autoTimer = window.setTimeout(() => this.autoStep(), this.autoDelay());
    }

    private clearTimers(): void {
      if (this.autoTimer !== null) {
        window.clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
      if (this.stepTimer !== null) {
        window.clearTimeout(this.stepTimer);
        this.stepTimer = null;
      }
    }

    /** 真实点击与 ?autoplay=1 共用的判定入口 */
    private chooseCard(index: number): void {
      if (this.done || this.locked) return;
      const question = currentQuestion(this.state, this.level);
      if (!question) return;
      // answer 越界（内容写坏）时取不到卡片：退回第一张继续走，
      // chooseOption 那边会把越界 answer 当成「怎么点都对」，不会把孩子或 autoplay 卡死
      const card = this.cards.find((item) => item.index === index) ?? this.cards[0];
      if (!card) return;

      const result = chooseOption(this.state, this.level, index);
      if (result.status === 'wrong') {
        // 不扣分、不换题，只给一次温柔的晃动和重试提示
        this.noteMistake('learn');
        this.shakeCard(card);
        this.say(this.ctx.task.retry, 2000, 380);
        return;
      }

      this.state = result.state;
      this.locked = true;
      this.noteCorrect();
      this.sfx('correct');
      // 颜色题：把答对的那个颜色名念出来，视力/色觉不同的孩子也有第二条线索
      if (question.kind === 'color' && !this.autoplay && !this.instant) {
        const answer = question.options[question.answer];
        if (answer) this.speak(answer.label);
      }
      sparkleAt(this, card.x, card.y, THEME.gold, 8);
      if (!this.reducedMotion) {
        this.tweens.killTweensOf(card.node);
        this.tweens.add({
          targets: card.node,
          y: card.y - 24,
          scaleX: 1.06,
          scaleY: 1.06,
          duration: 140,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => {
            card.node.setPosition(card.x, card.y);
            card.node.setScale(1);
          },
        });
      }

      if (result.status === 'done') {
        // 最后一题答对就立刻落档：原来要等 600ms 的换题延时，那段窗口里退出会白玩一局
        this.finish();
        return;
      }
      const wait = this.instant ? 150 : 600;
      this.stepTimer = window.setTimeout(() => {
        this.stepTimer = null;
        if (this.done) return;
        this.locked = false;
        this.renderQuestion();
      }, wait);
    }

    private finish(): void {
      if (this.done) return;
      this.done = true;
      this.clearTimers();
      // 落档优先：完成判定一成立就同步 finishTask（原来非调试模式要等 220ms）
      this.finishTask({ praise: this.ctx.task.done });
    }

    // ---------------- 回合 ----------------

    private renderQuestion(): void {
      const question = currentQuestion(this.state, this.level);
      if (!question) return;
      this.clearCards();
      this.questionText?.setText(question.question);
      this.progressText?.setText(`${this.state.round + 1} / ${this.level.rounds.length}`);
      this.buildCards(question);
      if (!this.autoplay && !this.instant) this.speak(question.question);
    }

    private buildCards(question: LearnRound): void {
      const count = question.options.length;
      // 选项最多 4 个：按可用宽度收缩卡片，否则 4×200+3×24=872 > 750，两侧各被裁掉 61px
      const cardW = Math.min(
        CARD.w,
        Math.floor((this.W - CARD.margin * 2 - (count - 1) * CARD.gap) / count),
      );
      this.cardW = cardW;
      const total = count * cardW + (count - 1) * CARD.gap;
      const startX = (this.W - total) / 2;
      const cy = CARD.top + CARD.h / 2;

      question.options.forEach((option, index) => {
        const cx = startX + index * (cardW + CARD.gap) + cardW / 2;
        const node = this.add.container(cx, cy).setDepth(2);
        const g = this.add.graphics();
        roundRect(g, -cardW / 2, -CARD.h / 2, cardW, CARD.h, 30, THEME.card, THEME.outline, 6);
        roundRect(g, -cardW / 2 + 14, -CARD.h / 2 + 14, cardW - 28, CARD.h - 28, 22, THEME.paper, null, 0);
        node.add(g);

        if (question.kind === 'color') {
          circle(g, 0, -30, 62, colorOf(option.color, THEME.grey), THEME.outline, 4);
          // 色盲友好：颜色之外再给一条「花纹」通道 —— 按选项下标取实心 / 圆环 / 十字 / 圆点。
          // 三个选项的花纹一定互不相同，所以即使分不清红绿也能靠花纹分辨（题面语音还会念颜色名）。
          this.drawColorPattern(g, 0, -30, 62, index);
          node.add(
            this.add.text(0, 82, option.label, textStyle(34, CSS.ink, true)).setOrigin(0.5),
          );
        } else if (question.kind === 'shape') {
          const shape = option.shape ?? 'circle';
          drawShape(g, shape, 0, -30, 62, SHAPE_COLORS[shape]);
          node.add(
            this.add.text(0, 82, option.label, textStyle(34, CSS.ink, true)).setOrigin(0.5),
          );
        } else {
          // 数字卡片不放多余的字：数字本身就是答案，字号大到一眼能认
          const size = option.label.length >= 3 ? 84 : option.label.length === 2 ? 104 : 118;
          node.add(
            this.add.text(0, -6, option.label, textStyle(size, CSS.ink, true)).setOrigin(0.5),
          );
        }

        this.cards.push({ index, node, x: cx, y: cy });
      });
    }

    /**
     * 颜色卡片的第二通道花纹：0 实心、1 圆环、2 十字、3 中心圆点。
     * 只画在圆内（半径 62），不会溢出卡片；用深色描边保证在浅色（黄）和中间色上都能看清。
     */
    private drawColorPattern(
      g: Phaser.GameObjects.Graphics,
      cx: number,
      cy: number,
      radius: number,
      index: number,
    ): void {
      const ink = THEME.outline;
      const pattern = index % 4;
      if (pattern === 0) return;
      if (pattern === 1) {
        g.lineStyle(8, ink, 0.85);
        g.strokeCircle(cx, cy, radius * 0.55);
        return;
      }
      if (pattern === 2) {
        g.lineStyle(8, ink, 0.85);
        g.lineBetween(cx - radius * 0.62, cy, cx + radius * 0.62, cy);
        g.lineBetween(cx, cy - radius * 0.62, cx, cy + radius * 0.62);
        return;
      }
      g.fillStyle(ink, 0.85);
      g.fillCircle(cx, cy, radius * 0.3);
    }

    private shakeCard(card: OptionCard): void {
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
        // 修正/答对时卡片还在弹跳补间里：先停掉再销毁
        this.tweens.killTweensOf(card.node);
        card.node.destroy(true);
      }
      this.cards = [];
    }

    // ---------------- 绘制 ----------------

    private drawClassroom(): void {
      const bg = this.add.graphics().setDepth(0);
      // 房间来自关卡脚本（schema 的 room 是 ROOMS 枚举），不要在这里写死
      drawRoom(bg, this.level.room, this.W, this.H);
      drawRug(bg, PANDA.x, 858, 300, 100, THEME.bambooLight);
    }

    /** 竹竹在右边陪着上课：开心脸，给孩子一个"一起学"的同伴 */
    private drawPandaAside(): void {
      const panda = this.add.graphics().setDepth(3);
      drawPanda(panda, PANDA.x, PANDA.y, PANDA.scale, { mood: 'happy' });
    }

    /** 顶部的小黑板：粉笔字比正文字更符合"课堂"，也让孩子知道这里是要读的题 */
    private drawBoard(): void {
      const g = this.add.graphics().setDepth(1);
      roundRect(g, 55, 172, 640, 156, 26, THEME.woodDeep, THEME.outline, 7);
      roundRect(g, 72, 189, 606, 122, 16, 0x5f7f56, null, 0);
      starPath(g, 104, 216, 14, 6, 5, THEME.paper, null, 0);
      starPath(g, 648, 288, 11, 5, 5, THEME.paper, null, 0);
      this.questionText = this.add
        .text(this.W / 2, 250, '', {
          ...textStyle(36, CSS.paper, true),
          align: 'center',
          wordWrap: { width: 540, useAdvancedWrap: true },
          lineSpacing: 6,
        })
        .setOrigin(0.5)
        .setDepth(2);
    }
  };
}
