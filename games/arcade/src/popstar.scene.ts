import type { ArcadeContext } from '@bamboo/game-kit';
import {
  CSS,
  THEME,
  cloud,
  heartPath,
  roundRect,
  shade,
  sparkleAt,
  starPath,
  textStyle,
} from '@bamboo/phaser-kit';
import type Phaser from 'phaser';
import { ArcadeScene } from './arcadeScene';
import type { PopstarBoard, PopstarState, StarFamily } from './popstar.logic';
import {
  POPSTAR_AUTO_STEP_MS,
  POPSTAR_COLS,
  POPSTAR_HINT_AFTER_MS,
  POPSTAR_MIN_GROUP,
  POPSTAR_ROUNDS,
  POPSTAR_ROWS,
  advanceRound,
  createPopstarState,
  findGroup,
  goalForRound,
  largestGroup,
  popTone,
  remainingToGoal,
  roundProgress,
  tryPop,
} from './popstar.logic';
import { hashString } from './rng';

/** 顶部标题条之下、底部 200px 宿主区之上的一屏棋盘（8×10，格子 80） */
const CELL = 80;
const BOARD_TOP = 274;
const HUD_Y = 196;
const BASKET_TOP = 1090;
const BASKET_WIDTH = 420;
const BASKET_HEIGHT = 42;
const STAR_RADIUS = CELL * 0.44;
/** 四种家族：颜色 + 花纹双通道（圆点 / 圆环 / 爱心 / 小花） */
const FAMILY_COLORS: readonly number[] = [THEME.warmRed, THEME.gold, THEME.water, THEME.bamboo];

/**
 * 消灭星星：点一组 4 邻接的同家族星星，整组爆掉，上方落下、顶部补星。
 *
 * 逻辑全在 popstar.logic：场景只负责画棋盘、把点按换算成格子、把结果演出。
 * autoplay 每 120ms 用 largestGroup 选最大组，再调用与真实点击完全相同的 popGroup。
 */
class PopstarScene extends ArcadeScene {
  private state: PopstarState;
  private boardGfx: Phaser.GameObjects.Graphics | null = null;
  private basketGfx: Phaser.GameObjects.Graphics | null = null;
  private hintGfx: Phaser.GameObjects.Graphics | null = null;
  private hintTween: Phaser.Tweens.Tween | null = null;
  private hintTimer: Phaser.Time.TimerEvent | null = null;
  private autoTimer: Phaser.Time.TimerEvent | null = null;
  private roundTimer: Phaser.Time.TimerEvent | null = null;
  private roundText: Phaser.GameObjects.Text | null = null;
  private goalText: Phaser.GameObjects.Text | null = null;
  private scoreText: Phaser.GameObjects.Text | null = null;
  private basketLabel: Phaser.GameObjects.Text | null = null;
  private lastActionAt = 0;
  private gameOver = false;

  constructor(ctx: ArcadeContext) {
    super('popstar', ctx);
    const seed = hashString(`${ctx.manifest.id}:${ctx.services.now()}`);
    this.state = createPopstarState(seed);
  }

  create(): void {
    this.drawBackdrop();
    this.drawHeader(this.t('arcade.popstar.name'), this.t('arcade.popstar.desc'));
    this.drawBoardFrame();
    this.boardGfx = this.add.graphics().setDepth(4);
    this.drawHud();
    this.renderBoard();
    this.syncHud();
    this.lastActionAt = this.now();

    this.input.on('pointerdown', this.onPointerDown);
    this.events.once('shutdown', this.onShutdown);

    this.announceRound(this.state.round + 1, POPSTAR_ROUNDS);
    if (!this.autoplay) this.say('arcade.popstar.intro');
    if (this.autoplay) this.scheduleAuto(180);
  }

  /** 8 秒不动就轻闪一下最大的一组；autoplay 自己会走，不需要提示 */
  override update(): void {
    if (this.gameOver || this.autoplay || this.state.status !== 'playing') return;
    if (this.hintGfx !== null) return;
    if (this.now() - this.lastActionAt < POPSTAR_HINT_AFTER_MS) return;
    this.showHint();
  }

  // ---------------- 输入：真实点击与 autoplay 共用 popGroup ----------------

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.gameOver || this.state.status !== 'playing') return;
    const col = Math.floor((pointer.x - this.boardLeft) / CELL);
    const row = Math.floor((pointer.y - BOARD_TOP) / CELL);
    if (col < 0 || col >= POPSTAR_COLS || row < 0 || row >= POPSTAR_ROWS) return;
    this.clearHint();
    this.popGroup(findGroup(this.state.board, row * POPSTAR_COLS + col));
  };

  /** 唯一的消除入口：点击、autoplay 都从这里进 tryPop，没有第二条通关分支 */
  private popGroup(group: readonly number[]): void {
    if (this.gameOver || this.state.status !== 'playing') return;
    const beforeBoard = this.state.board;
    const result = tryPop(this.state, group);
    if (result.popped === 0 && result.autoCollected === 0) return;

    this.state = result.state;
    this.lastActionAt = this.now();
    this.clearHint();

    if (result.popped > 0) {
      this.ctx.services.audio.tone(popTone(result.popped), 150);
      this.sfx(result.popped >= 6 ? 'sparkle' : 'pop');
      this.flyStars(group, beforeBoard, false);
      this.showPopLabel(this.groupCenter(group), result.popped);
      if (!this.reducedMotion && result.popped >= 8) {
        const center = this.groupCenter(group);
        sparkleAt(this, center.x, center.y, THEME.gold, 5);
      }
    }

    if (result.autoCollected > 0) {
      const popped = result.popped > 0 ? new Set(group) : new Set<number>();
      const leftovers: number[] = [];
      for (let index = 0; index < beforeBoard.length; index += 1) {
        if (beforeBoard[index] !== null && !popped.has(index)) leftovers.push(index);
      }
      this.flyStars(leftovers, beforeBoard, true);
      this.showPopLabel({ x: this.W / 2, y: BASKET_TOP - 30 }, result.autoCollected);
      this.sfx('sparkle');
    }

    this.renderBoard();
    this.syncHud();
    if (result.roundDone) this.handleRoundDone();
  }

  // ---------------- autoplay：每 120ms 点一次最大组 ----------------

  private scheduleAuto(delay: number): void {
    if (!this.autoplay || this.gameOver) return;
    this.autoTimer?.remove(false);
    this.autoTimer = this.time.delayedCall(delay, () => {
      this.autoTimer = null;
      this.autoStep();
    });
  }

  private autoStep(): void {
    if (!this.autoplay || this.gameOver || this.state.status !== 'playing') return;
    this.popGroup(largestGroup(this.state.board));
    if (!this.gameOver && this.state.status === 'playing') {
      this.scheduleAuto(POPSTAR_AUTO_STEP_MS);
    }
  }

  // ---------------- 轮次与结算 ----------------

  private handleRoundDone(): void {
    if (this.gameOver || this.roundTimer !== null) return;
    this.sfx('correct');
    this.showBanner(this.t('arcade.roundDone'), {
      color: THEME.bamboo,
      textColor: CSS.paper,
      holdMs: 900,
    });
    const delay = this.instant ? 120 : this.autoplay ? 360 : 1500;
    this.roundTimer = this.time.delayedCall(delay, () => {
      this.roundTimer = null;
      this.state = advanceRound(this.state);
      if (this.state.status === 'done') {
        this.gameOver = true;
        this.finish(this.state.score);
        return;
      }
      this.renderBoard();
      this.syncHud();
      this.announceRound(this.state.round + 1, POPSTAR_ROUNDS);
      this.lastActionAt = this.now();
      if (this.autoplay) this.scheduleAuto(120);
    });
  }

  // ---------------- 8 秒提示 ----------------

  private showHint(): void {
    const group = largestGroup(this.state.board);
    if (group.length < POPSTAR_MIN_GROUP) return;
    this.lastActionAt = this.now();
    const g = this.add.graphics().setDepth(9);
    const size = CELL - 12;
    for (const index of group) {
      const center = this.cellCenter(index);
      roundRect(
        g,
        center.x - size / 2,
        center.y - size / 2,
        size,
        size,
        16,
        THEME.gold,
        THEME.goldDeep,
        5,
        0.22,
      );
    }
    this.hintGfx = g;
    if (this.reducedMotion) {
      this.hintTimer = this.time.delayedCall(1200, () => {
        this.hintTimer = null;
        this.clearHint();
      });
      return;
    }
    this.hintTween = this.tweens.add({
      targets: g,
      alpha: 0.35,
      duration: 300,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        this.hintTween = null;
        this.clearHint();
      },
    });
  }

  private clearHint(): void {
    if (this.hintTween !== null) {
      this.hintTween.remove();
      this.hintTween = null;
    }
    if (this.hintTimer !== null) {
      this.hintTimer.remove(false);
      this.hintTimer = null;
    }
    if (this.hintGfx !== null) {
      this.hintGfx.destroy();
      this.hintGfx = null;
    }
  }

  private readonly onShutdown = (): void => {
    this.input.off('pointerdown', this.onPointerDown);
    this.autoTimer?.remove(false);
    this.autoTimer = null;
    this.roundTimer?.remove(false);
    this.roundTimer = null;
    this.clearHint();
  };

  // ---------------- 绘制 ----------------

  private get boardLeft(): number {
    return (this.W - POPSTAR_COLS * CELL) / 2;
  }

  private cellCenter(index: number): { x: number; y: number } {
    const row = Math.floor(index / POPSTAR_COLS);
    const col = index % POPSTAR_COLS;
    return {
      x: this.boardLeft + col * CELL + CELL / 2,
      y: BOARD_TOP + row * CELL + CELL / 2,
    };
  }

  private groupCenter(group: readonly number[]): { x: number; y: number } {
    if (group.length === 0) return { x: this.W / 2, y: BOARD_TOP + CELL };
    let x = 0;
    let y = 0;
    for (const index of group) {
      const center = this.cellCenter(index);
      x += center.x;
      y += center.y;
    }
    return { x: x / group.length, y: y / group.length };
  }

  /** 浅色天空 + 几朵云：星星在纸上，纸在天空上，比深色底更适合小朋友 */
  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(THEME.sky, 1);
    g.fillRect(-40, -40, this.W + 80, this.H + 80);
    cloud(g, 14, 1214, 190, THEME.white, 0.5);
    cloud(g, 548, 1240, 220, THEME.white, 0.45);
    g.fillStyle(THEME.white, 0.55);
    for (const [x, y, radius] of [
      [30, 1120, 5],
      [718, 1148, 4],
      [24, 268, 4],
      [726, 300, 5],
    ] as const) {
      g.fillCircle(x, y, radius);
    }
  }

  private drawBoardFrame(): void {
    const g = this.add.graphics().setDepth(1);
    const width = POPSTAR_COLS * CELL;
    const height = POPSTAR_ROWS * CELL;
    roundRect(
      g,
      this.boardLeft - 12,
      BOARD_TOP - 12,
      width + 24,
      height + 24,
      30,
      THEME.paperDeep,
      THEME.outline,
      5,
    );
    roundRect(g, this.boardLeft - 4, BOARD_TOP - 4, width + 8, height + 8, 24, THEME.paper, null, 0);
    for (let row = 0; row < POPSTAR_ROWS; row += 1) {
      for (let col = 0; col < POPSTAR_COLS; col += 1) {
        if ((row + col) % 2 !== 0) continue;
        roundRect(
          g,
          this.boardLeft + col * CELL + 5,
          BOARD_TOP + row * CELL + 5,
          CELL - 10,
          CELL - 10,
          14,
          THEME.card,
          null,
          0,
          0.55,
        );
      }
    }
  }

  private drawHud(): void {
    const bar = this.add.graphics().setDepth(10);
    roundRect(bar, 14, 168, 170, 56, 28, THEME.card, THEME.outline, 4);
    roundRect(bar, this.W / 2 - 175, 168, 350, 56, 28, THEME.card, THEME.outline, 4);
    roundRect(bar, this.W - 134, 168, 120, 56, 28, THEME.card, THEME.outline, 4);
    starPath(bar, this.W - 114, HUD_Y, 17, 8, 5, THEME.gold, THEME.goldDeep, 3);

    this.roundText = this.addText(99, HUD_Y, '', 24, CSS.ink, true).setDepth(11);
    this.goalText = this.addText(this.W / 2, HUD_Y, '', 24, CSS.ink, true).setDepth(11);
    this.scoreText = this.add
      .text(this.W - 72, HUD_Y, '0', textStyle(26, CSS.gold, true))
      .setOrigin(0.5)
      .setDepth(11);

    this.basketGfx = this.add.graphics().setDepth(10);
    this.basketLabel = this.addText(
      this.W / 2,
      BASKET_TOP + BASKET_HEIGHT / 2,
      '',
      22,
      CSS.ink,
      true,
    ).setDepth(11);
  }

  private syncHud(): void {
    const state = this.state;
    this.roundText?.setText(
      this.t('arcade.roundOf', { n: state.round + 1, total: POPSTAR_ROUNDS }),
    );
    this.goalText?.setText(
      state.status === 'playing'
        ? this.t('arcade.goalPopped', { n: remainingToGoal(state) })
        : this.t('arcade.nice'),
    );
    this.scoreText?.setText(String(state.score));
    // 竹筐最多画满；超出目标的星星仍然计分，但不让「25 / 24」这种数字吓到孩子
    const basketCount = Math.min(state.collected, goalForRound(state.round));
    this.basketLabel?.setText(`${basketCount} / ${goalForRound(state.round)}`);
    this.drawBasket();
  }

  private drawBasket(): void {
    const g = this.basketGfx;
    if (g === null) return;
    const cx = this.W / 2;
    const left = cx - BASKET_WIDTH / 2;
    g.clear();
    g.fillStyle(THEME.outline, 0.12);
    g.fillEllipse(cx, BASKET_TOP + BASKET_HEIGHT + 8, BASKET_WIDTH * 0.88, 16);
    roundRect(g, left, BASKET_TOP, BASKET_WIDTH, BASKET_HEIGHT, 18, THEME.wood, THEME.outline, 5);
    g.lineStyle(3, shade(THEME.wood, 0.72), 0.55);
    for (let x = left + 30; x < left + BASKET_WIDTH - 18; x += 36) {
      g.lineBetween(x, BASKET_TOP + 5, x, BASKET_TOP + BASKET_HEIGHT - 5);
    }
    const innerWidth = BASKET_WIDTH - 64;
    roundRect(
      g,
      cx - innerWidth / 2,
      BASKET_TOP + 9,
      innerWidth,
      BASKET_HEIGHT - 18,
      12,
      THEME.paperDeep,
      null,
      0,
    );
    const progress = roundProgress(this.state);
    if (progress > 0) {
      roundRect(
        g,
        cx - innerWidth / 2 + 3,
        BASKET_TOP + 12,
        (innerWidth - 6) * progress,
        BASKET_HEIGHT - 24,
        9,
        THEME.gold,
        THEME.goldDeep,
        2,
      );
    }
  }

  private renderBoard(): void {
    const g = this.boardGfx;
    if (g === null) return;
    g.clear();
    for (let index = 0; index < this.state.board.length; index += 1) {
      const family = this.state.board[index];
      if (family === null || family === undefined) continue;
      const center = this.cellCenter(index);
      this.drawStar(g, center.x, center.y, family, STAR_RADIUS);
    }
  }

  /** 星星本体：四种颜色 + 四种花纹（圆点 / 圆环 / 爱心 / 小花），不靠颜色单独传达信息 */
  private drawStar(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    family: StarFamily,
    radius: number,
  ): void {
    const color = FAMILY_COLORS[family] ?? THEME.gold;
    starPath(g, x, y, radius, radius * 0.46, 5, color, THEME.outline, Math.max(3, radius * 0.12));
    const ink = THEME.outline;
    if (family === 0) {
      g.fillStyle(ink, 0.85);
      g.fillCircle(x - radius * 0.2, y + radius * 0.02, radius * 0.11);
      g.fillCircle(x + radius * 0.2, y - radius * 0.12, radius * 0.11);
      g.fillCircle(x + radius * 0.02, y + radius * 0.24, radius * 0.11);
    } else if (family === 1) {
      g.lineStyle(radius * 0.16, ink, 0.9);
      g.strokeCircle(x, y, radius * 0.36);
    } else if (family === 2) {
      heartPath(g, x, y + radius * 0.04, radius * 0.74, ink, null);
    } else {
      g.fillStyle(ink, 0.85);
      for (let petal = 0; petal < 5; petal += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * petal) / 5;
        g.fillCircle(
          x + Math.cos(angle) * radius * 0.22,
          y + Math.sin(angle) * radius * 0.22,
          radius * 0.12,
        );
      }
      g.fillStyle(color, 1);
      g.fillCircle(x, y, radius * 0.1);
      g.lineStyle(2, ink, 1);
      g.strokeCircle(x, y, radius * 0.1);
    }
  }

  private showPopLabel(at: { x: number; y: number }, count: number): void {
    const label = this.addText(at.x, at.y, `+${count}`, 42, CSS.gold, true).setDepth(750);
    this.tweens.add({
      targets: label,
      y: at.y - (this.reducedMotion ? 24 : 70),
      alpha: 0,
      duration: this.reducedMotion ? 320 : 720,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** 爆掉的星星飞进竹筐；无解时剩下的星星飞回天上（reducedMotion 只留一点星光） */
  private flyStars(indices: readonly number[], board: PopstarBoard, toSky: boolean): void {
    if (indices.length === 0) return;
    if (this.reducedMotion) {
      sparkleAt(this, this.W / 2, BASKET_TOP, THEME.gold, 3);
      return;
    }
    const limit = toSky ? 80 : 40;
    for (let order = 0; order < Math.min(indices.length, limit); order += 1) {
      const index = indices[order];
      if (index === undefined) continue;
      const family = board[index];
      if (family === null || family === undefined) continue;
      const from = this.cellCenter(index);
      const star = this.add.graphics().setDepth(700);
      this.drawStar(star, 0, 0, family, 22);
      star.setPosition(from.x, from.y);
      const lane = (index % 7) - 3;
      this.tweens.add({
        targets: star,
        x: toSky ? from.x + lane * 42 : this.W / 2 + lane * 30,
        y: toSky ? -80 : BASKET_TOP + 16,
        scale: toSky ? 0.5 : 0.35,
        alpha: 0.1,
        duration: toSky ? 700 : 460,
        delay: Math.min(240, order * (toSky ? 8 : 16)),
        ease: 'Quad.easeIn',
        onComplete: () => star.destroy(),
      });
    }
  }
}

export function createPopstarScene(ctx: ArcadeContext): Phaser.Types.Scenes.SceneType {
  return class extends PopstarScene {
    constructor() {
      super(ctx);
    }
  };
}
