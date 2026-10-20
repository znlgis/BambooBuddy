import type { ArcadeContext } from '@bamboo/game-kit';
import type Phaser from 'phaser';
import {
  CSS,
  THEME,
  circle,
  createHand,
  ellipse,
  groundShadow,
  roundRect,
  shade,
  sparkleAt,
  starPath,
} from '@bamboo/phaser-kit';
import { ArcadeScene } from './arcadeScene';
import {
  BOUNCE_BOARD,
  BOUNCE_ROUNDS,
  BOUNCE_STARS_PER_BLOCK,
  DEFAULT_AIM,
  advanceBounce,
  aimToward,
  autoplayTarget,
  canFire,
  createBounceGame,
  fireBall,
  launchPointFor,
  predictAim,
  remainingBlocks,
  scoreOf,
} from './bounce.logic';
import type { BounceAim, BounceBlock, BounceEvents, BounceState, Vec2 } from './bounce.logic';
import { hashString } from './rng';

/** 竹筐（星星的归宿）：放在右下角，不挡发射器 */
const BASKET = { x: 636, y: 1032 } as const;
/** autoplay 的模拟倍速：真实操作不赶，调试/自动化 8 秒内走完 */
const AUTOPLAY_SPEED = 10;
/** autoplay 每次推进的模拟片长：片内也会尝试发射，装弹一好立刻发 */
const AUTO_CHUNK_MS = 24;
/** 单帧真实时间上限：切后台/卡顿时不让球瞬移 */
const MAX_FRAME_MS = 200;

/**
 * 弹一弹：按住屏幕任意位置拖动瞄准，松手把球弹出去。
 *
 * 场景只做「画 + 喂手势」：
 * - 真实触摸与 autoplay 都走 beginAim / releaseShot 这同一对函数；
 * - 物理、碎块、下沉、开花全部在 bounce.logic 里（定步长、种子确定）；
 * - 没有失败：球回发射器、方块贴底开花，都是"再来"不是"输"。
 */
class BounceScene extends ArcadeScene {
  private state!: BounceState;
  private aim: BounceAim = DEFAULT_AIM;
  private dragging = false;
  private lastFrameAt = 0;
  private finishSent = false;
  private hand: Phaser.GameObjects.Graphics | null = null;

  private blocksG!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private ballsG!: Phaser.GameObjects.Graphics;
  private launcherG!: Phaser.GameObjects.Graphics;
  private hudG!: Phaser.GameObjects.Graphics;
  private roundText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private starsText!: Phaser.GameObjects.Text;

  constructor(ctx: ArcadeContext) {
    super('bounce', ctx);
  }

  create(): void {
    // 种子 = 游戏 id + 打开这一局的墙钟；同一次打开可复现，换一局布局会变
    this.state = createBounceGame(hashString(this.ctx.manifest.id + ':' + this.now()));
    this.aim = DEFAULT_AIM;

    this.drawStage();
    this.drawHeader(this.t('arcade.bounce.name'));
    this.roundText = this.addText(
      this.W / 2,
      108,
      this.t('arcade.roundOf', { n: 1, total: BOUNCE_ROUNDS.length }),
      26,
      '#d9e8c8',
      true,
    ).setDepth(21);
    this.goalText = this.addText(this.W / 2, 226, '', 28, CSS.ink, true).setDepth(23);
    this.starsText = this.addText(0, 226, '', 30, CSS.ink, true).setDepth(23).setOrigin(0, 0.5);

    this.hudG = this.add.graphics().setDepth(22);
    this.blocksG = this.add.graphics().setDepth(10);
    this.aimG = this.add.graphics().setDepth(12);
    this.launcherG = this.add.graphics().setDepth(14);
    this.ballsG = this.add.graphics().setDepth(16);

    this.drawAll();
    this.announceRound(1, BOUNCE_ROUNDS.length);

    if (!this.autoplay && !this.instant) {
      this.say('arcade.bounce.intro');
      // 减少动态偏好：不摆动手势，语音 + 瞄准虚线已经够引导
      if (!this.reducedMotion) this.showHintHand();
    }

    this.input.on('pointerdown', this.onPointerDown);
    this.input.on('pointermove', this.onPointerMove);
    this.input.on('pointerup', this.onPointerUp);
    this.input.on('pointerupoutside', this.onPointerUp);
    this.events.on('update', this.onFrame);
    this.events.once('shutdown', this.onShutdown);

    this.lastFrameAt = this.now();
  }

  // ---------------- 输入：真实触摸与 autoplay 共用 ----------------

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.beginAim({ x: pointer.x, y: pointer.y });
  };

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragging) return;
    this.aim = aimToward({ x: pointer.x, y: pointer.y });
  };

  private readonly onPointerUp = (): void => {
    this.releaseShot();
  };

  /** 按下（或 autoplay 决定目标）→ 更新瞄准；这是真实手势与自动通关的唯一入口 */
  private beginAim(point: Vec2): void {
    if (this.state.finished || this.state.roundDone) return;
    this.dragging = true;
    this.aim = aimToward(point);
    this.hideHintHand();
  }

  /** 松手（或 autoplay 模拟松手）→ 装弹好了就发；自动通关不会走另一条分支 */
  private releaseShot(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.state.finished || this.state.roundDone) return;
    if (!canFire(this.state)) return;

    const shot = fireBall(this.state, this.aim);
    if (!shot.fired) return;
    this.state = shot.state;
    this.sfx('jump');
    this.applyEvents(shot.events);
  }

  // ---------------- 帧循环 ----------------

  private readonly onFrame = (): void => {
    if (this.state.finished) return;
    const now = this.now();
    const elapsed = Math.max(0, Math.min(MAX_FRAME_MS, now - this.lastFrameAt));
    this.lastFrameAt = now;

    if (this.autoplay) this.advanceAutoplay(elapsed);
    else this.applyAdvance(elapsed);

    this.drawAll();
  };

  private applyAdvance(dtMs: number): void {
    const result = advanceBounce(this.state, dtMs);
    this.state = result.state;
    this.applyEvents(result.events);
  }

  /**
   * autoplay：用墙钟差 × 倍速推进；每一小片都先看能不能发射，
   * 发射走 beginAim + releaseShot（与手指完全同一条路）。
   */
  private advanceAutoplay(realMs: number): void {
    let remaining = Math.min(MAX_FRAME_MS, realMs) * AUTOPLAY_SPEED;
    let guard = 0;
    while (remaining > 0 && guard < 400 && !this.state.finished) {
      if (canFire(this.state)) {
        const target = autoplayTarget(this.state);
        if (target !== null) {
          this.beginAim({ x: target.x, y: target.y });
          this.releaseShot();
        }
      }
      const chunk = Math.min(remaining, AUTO_CHUNK_MS);
      this.applyAdvance(chunk);
      remaining -= chunk;
      guard += 1;
    }
  }

  private applyEvents(events: BounceEvents): void {
    if (events.broken.length > 0) {
      this.sfx('pop');
      for (const block of events.broken) this.onBlockBroken(block);
    }
    if (events.flowered.length > 0) {
      this.sfx('sparkle');
      for (const block of events.flowered) this.onBlockFlowered(block);
    }
    if (events.roundCompleted !== null) this.onRoundCompleted();
    if (events.roundStarted !== null) this.onRoundStarted(events.roundStarted);
    if (events.finished) this.completeGame();
  }

  // ---------------- 反馈 ----------------

  private onBlockBroken(block: BounceBlock): void {
    if (!this.reducedMotion) sparkleAt(this, block.x, block.y, THEME.gold, 4);
    this.flyStars(block.x, block.y);
  }

  /** 贴底不失败：方块开出小花飞走，星星照收 */
  private onBlockFlowered(block: BounceBlock): void {
    const flower = this.add.graphics().setDepth(17);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = (Math.PI * 2 * petal) / 5 - Math.PI / 2;
      circle(flower, Math.cos(angle) * 14, Math.sin(angle) * 14, 11, THEME.pink, THEME.outline, 3);
    }
    circle(flower, 0, 0, 9, THEME.gold, THEME.outline, 3);
    flower.setPosition(block.x, block.y);

    // reduced-motion：不做"飞"，只让它安静地淡出
    const drift = this.reducedMotion ? 0 : (block.col % 2 === 0 ? -1 : 1) * 54;
    this.tweens.add({
      targets: flower,
      x: block.x + drift,
      y: this.reducedMotion ? block.y : block.y - 230,
      alpha: 0,
      scale: this.reducedMotion ? 1 : 1.35,
      duration: this.reducedMotion ? 320 : 760,
      ease: 'Sine.easeOut',
      onComplete: () => flower.destroy(),
    });
    this.flyStars(block.x, block.y);
  }

  private flyStars(x: number, y: number): void {
    if (this.reducedMotion) return;
    for (let index = 0; index < BOUNCE_STARS_PER_BLOCK; index += 1) {
      const star = this.add.graphics().setDepth(18);
      starPath(star, 0, 0, 13, 6, 5, THEME.gold, THEME.goldDeep, 3);
      star.setPosition(x + (index - 1) * 18, y);
      this.tweens.add({
        targets: star,
        x: BASKET.x,
        y: BASKET.y - 18,
        scale: 0.55,
        alpha: 0.85,
        duration: 400,
        delay: index * 45,
        ease: 'Quad.easeIn',
        onComplete: () => star.destroy(),
      });
    }
  }

  private onRoundCompleted(): void {
    this.dragging = false;
    this.sfx('correct');
    this.showBanner(this.t('arcade.roundDone'), { y: 300, holdMs: 1200 });
  }

  private onRoundStarted(round: number): void {
    this.announceRound(round, BOUNCE_ROUNDS.length);
    if (!this.reducedMotion) {
      this.blocksG.setAlpha(0);
      this.tweens.add({ targets: this.blocksG, alpha: 1, duration: 220 });
    }
  }

  private completeGame(): void {
    if (this.finishSent) return;
    this.finishSent = true;
    this.dragging = false;
    this.drawAll();
    this.finish(scoreOf(this.state));
  }

  private showHintHand(): void {
    if (this.hand !== null) return;
    this.hand = createHand(this, BOUNCE_BOARD.launchX, BOUNCE_BOARD.launchY - 150, 1.15);
    this.time.delayedCall(6000, () => this.hideHintHand());
  }

  private hideHintHand(): void {
    if (this.hand === null) return;
    this.tweens.killTweensOf(this.hand);
    this.hand.destroy();
    this.hand = null;
  }

  private readonly onShutdown = (): void => {
    this.input.off('pointerdown', this.onPointerDown);
    this.input.off('pointermove', this.onPointerMove);
    this.input.off('pointerup', this.onPointerUp);
    this.input.off('pointerupoutside', this.onPointerUp);
    this.events.off('update', this.onFrame);
    // 场景关闭时补间系统随后一起销毁，这里不 killTweensOf，直接松手
    this.hand?.destroy();
    this.hand = null;
  };

  // ---------------- 绘制 ----------------

  private drawAll(): void {
    this.drawBlocks();
    this.drawBalls();
    this.drawAim();
    this.drawLauncher();
    this.drawHud();
  }

  private drawStage(): void {
    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(THEME.paper, 1);
    bg.fillRect(0, 0, this.W, this.H);
    bg.fillStyle(THEME.paperDeep, 0.55);
    bg.fillCircle(70, 420, 92);
    bg.fillCircle(700, 760, 74);

    const board = this.add.graphics().setDepth(1);
    const { left, right, top, floor } = BOUNCE_BOARD;
    const width = right - left;
    const height = floor - top;
    roundRect(board, left - 28, top - 22, width + 56, height + 44, 44, THEME.card, THEME.outline, 6);
    roundRect(board, left, top, width, height, 26, THEME.sky, null, 0, 0.55);

    // 左右竹墙：内沿恰好是逻辑墙（球心限制在 left+半径 / right-半径）
    roundRect(board, left - 24, top - 6, 24, height + 12, 12, THEME.bamboo, THEME.outline, 4);
    roundRect(board, right, top - 6, 24, height + 12, 12, THEME.bamboo, THEME.outline, 4);
    board.lineStyle(3, THEME.bambooDeep, 0.55);
    for (let y = top + 78; y < floor; y += 112) {
      board.lineBetween(left - 22, y, left - 2, y);
      board.lineBetween(right + 2, y, right + 22, y);
    }

    this.drawBasket(board);
  }

  private drawBasket(g: Phaser.GameObjects.Graphics): void {
    groundShadow(g, BASKET.x, BASKET.y + 42, 112, 22, 0.12);
    roundRect(g, BASKET.x - 52, BASKET.y - 12, 104, 58, 18, THEME.wood, THEME.outline, 5);
    roundRect(g, BASKET.x - 58, BASKET.y - 26, 116, 24, 12, THEME.woodDeep, THEME.outline, 4);
    g.lineStyle(3, THEME.woodDeep, 0.5);
    g.lineBetween(BASKET.x - 26, BASKET.y - 6, BASKET.x - 20, BASKET.y + 38);
    g.lineBetween(BASKET.x, BASKET.y - 6, BASKET.x, BASKET.y + 40);
    g.lineBetween(BASKET.x + 26, BASKET.y - 6, BASKET.x + 20, BASKET.y + 38);
    starPath(g, BASKET.x, BASKET.y + 8, 15, 7, 5, THEME.gold, THEME.goldDeep, 3);
  }

  private drawBlocks(): void {
    const g = this.blocksG;
    g.clear();
    for (const block of this.state.blocks) {
      if (!block.alive) continue;
      const x = block.x - block.w / 2;
      const y = block.y - block.h / 2;
      const fill = block.kind === 'bouncy' ? THEME.mint : THEME.wood;
      roundRect(g, x, y, block.w, block.h, 18, fill, THEME.outline, 5);
      roundRect(g, x + 10, y + 8, block.w - 20, 12, 6, shade(fill, 1.1), null, 0, 0.9);

      if (block.kind === 'bouncy') {
        // 弹弹方块：三个小圈 + 一条弹簧线（不靠颜色单独传达）
        for (let dot = 0; dot < 3; dot += 1) {
          circle(g, block.x - 18 + dot * 18, block.y + 6, 7, THEME.gold, THEME.outline, 3);
        }
        g.lineStyle(3, THEME.bambooDeep, 0.55);
        g.lineBetween(block.x - 30, block.y - 18, block.x + 30, block.y - 18);
      } else {
        starPath(g, block.x, block.y + 4, 15, 7, 5, shade(fill, 1.22), THEME.outline, 3);
      }
    }
  }

  private drawBalls(): void {
    const g = this.ballsG;
    g.clear();
    for (const ball of this.state.balls) {
      if (!this.reducedMotion) {
        g.lineStyle(7, THEME.warmRed, 0.22);
        g.lineBetween(
          ball.x - ball.vx * 0.018,
          ball.y - ball.vy * 0.018,
          ball.x,
          ball.y,
        );
      }
      circle(g, ball.x, ball.y, BOUNCE_BOARD.ballRadius, THEME.warmRed, THEME.outline, 4);
      circle(g, ball.x - 5, ball.y - 5, 5, THEME.white, null, 0);
    }
  }

  private drawLauncher(): void {
    const g = this.launcherG;
    const { launchX, launchY } = BOUNCE_BOARD;
    g.clear();

    groundShadow(g, launchX, launchY + 40, 124, 22, 0.14);
    roundRect(g, launchX - 56, launchY + 16, 112, 24, 12, THEME.woodDeep, THEME.outline, 4);
    ellipse(g, launchX, launchY + 4, 98, 48, THEME.wood, THEME.outline, 5);
    ellipse(g, launchX, launchY + 2, 66, 30, THEME.woodDeep, null, 0);

    if (this.state.reloadLeftMs > 0) {
      const progress = 1 - this.state.reloadLeftMs / BOUNCE_BOARD.reloadMs;
      g.lineStyle(6, THEME.gold, 0.95);
      g.beginPath();
      g.arc(launchX, launchY, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      g.strokePath();
    }

    if (canFire(this.state)) {
      const point = launchPointFor(this.aim);
      circle(g, point.x, point.y, BOUNCE_BOARD.ballRadius, THEME.warmRed, THEME.outline, 4);
      circle(g, point.x - 5, point.y - 5, 5, THEME.white, null, 0);
    }

    for (let slot = 0; slot < BOUNCE_BOARD.maxBalls; slot += 1) {
      const ready = slot < BOUNCE_BOARD.maxBalls - this.state.balls.length;
      circle(
        g,
        launchX - 34 + slot * 34,
        launchY + 58,
        9,
        ready ? THEME.gold : THEME.paperDeep,
        THEME.outline,
        3,
      );
    }
  }

  private drawAim(): void {
    const g = this.aimG;
    g.clear();
    if (!this.dragging || this.state.roundDone || this.state.finished) return;

    const prediction = predictAim(this.state, this.aim);
    for (let index = 0; index < prediction.points.length - 1; index += 1) {
      const from = prediction.points[index]!;
      const to = prediction.points[index + 1]!;
      this.dashedLine(g, from.x, from.y, to.x, to.y, index === 0 ? 6 : 4);
    }
    for (const point of prediction.bouncePoints) {
      circle(g, point.x, point.y, 11, THEME.warmRed, THEME.outline, 3);
    }
    if (prediction.hitBlockId !== null) {
      const block = this.state.blocks.find((item) => item.id === prediction.hitBlockId);
      if (block !== undefined) {
        g.lineStyle(5, THEME.gold, 0.95);
        g.strokeRoundedRect(
          block.x - block.w / 2 - 5,
          block.y - block.h / 2 - 5,
          block.w + 10,
          block.h + 10,
          22,
        );
      }
    }
  }

  private dashedLine(
    g: Phaser.GameObjects.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const ux = dx / length;
    const uy = dy / length;
    g.lineStyle(width, THEME.warmRed, 0.75);
    const dash = 18;
    const gap = 12;
    for (let distance = 0; distance < length; distance += dash + gap) {
      const end = Math.min(length, distance + dash);
      g.lineBetween(x1 + ux * distance, y1 + uy * distance, x1 + ux * end, y1 + uy * end);
    }
  }

  private drawHud(): void {
    const total = BOUNCE_ROUNDS.length;
    const remaining = remainingBlocks(this.state);
    this.roundText.setText(this.t('arcade.roundOf', { n: this.state.round, total }));
    this.starsText.setText(String(scoreOf(this.state)));
    this.goalText.setText(
      this.state.roundDone || this.finishSent
        ? this.t('arcade.roundDone')
        : this.t('arcade.goalBlocks', { n: remaining }),
    );

    const g = this.hudG;
    g.clear();

    // 中间：还差几个方块（纯展示，不挡手指）
    const goalWidth = Math.max(200, this.goalText.width + 56);
    roundRect(
      g,
      this.W / 2 - goalWidth / 2,
      198,
      goalWidth,
      56,
      28,
      THEME.card,
      THEME.outline,
      4,
    );
    this.goalText.setPosition(this.W / 2, 226);

    // 右侧：已收集的星星
    const starsWidth = this.starsText.width + 108;
    const starsX = this.W - 24 - starsWidth;
    roundRect(g, starsX, 198, starsWidth, 56, 28, THEME.card, THEME.outline, 4);
    starPath(g, starsX + 38, 226, 17, 8, 5, THEME.gold, THEME.goldDeep, 3);
    this.starsText.setPosition(starsX + 64, 226);
  }
}

export function createBounceScene(ctx: ArcadeContext): Phaser.Types.Scenes.SceneType {
  return class extends BounceScene {
    constructor() {
      super(ctx);
    }
  };
}
