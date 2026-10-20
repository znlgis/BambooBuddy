import type { ArcadeContext } from '@bamboo/game-kit';
import type Phaser from 'phaser';
import { CSS, THEME, roundRect, shade, sparkleAt } from '@bamboo/phaser-kit';
import { ArcadeScene } from './arcadeScene';
import { hashString } from './rng';
import {
  TETRIS_COLS,
  TETRIS_GOAL_LINES,
  TETRIS_RESCUE_ROWS,
  TETRIS_ROWS,
  activeCells,
  advance,
  createTetrisState,
  ghostPiece,
  hardDrop,
  planPlacement,
  shapeCells,
  stepDown,
  tryMove,
  tryRotate,
} from './tetris.logic';
import type { PieceKind, TetrisLockResult, TetrisState } from './tetris.logic';

/** 8 × 14 的棋盘：格子 60，底部操作区离宿主预留的 200px 还有余量 */
const CELL = 60;
const BOARD_W = TETRIS_COLS * CELL;
const BOARD_H = TETRIS_ROWS * CELL;
const BOARD_X = 36;
const BOARD_Y = 232;

/** 右侧：两个预览 + 4 个方向键 + 一个「掉下去」 */
const PREVIEW_X = 536;
const PREVIEW_W = 190;
const PREVIEW_CY = 280;
const PREVIEW_GAP = 116;
const PREVIEW_CELL = 24;

const PIECE_COLORS: Record<PieceKind, number> = {
  I: THEME.water,
  O: THEME.gold,
  T: THEME.lavender,
  S: THEME.bambooLight,
  Z: THEME.warmRed,
  J: THEME.skyDeep,
  L: THEME.wood,
};

const RAINBOW = [THEME.warmRed, THEME.gold, THEME.bamboo, THEME.water, THEME.lavender, THEME.pink];

/**
 * 俄罗斯方块：拼满一行就消掉，累计 3 行完成。
 *
 * 场景只做三件事：把状态画出来、把按钮 / 滑动原样交给纯逻辑、把结果演出来。
 * ?autoplay=1 时 AI 也只是调用同一组 handleRotate / handleMove / handleHardDrop，
 * 没有第二条「自动通关」分支。
 */
class TetrisScene extends ArcadeScene {
  private state!: TetrisState;
  private done = false;
  private lastTick = 0;
  private dragStart: { x: number; y: number } | null = null;
  private cellsGfx: Phaser.GameObjects.Graphics | null = null;
  private previewGfx: Phaser.GameObjects.Graphics | null = null;
  private goalText: Phaser.GameObjects.Text | null = null;

  constructor(ctx: ArcadeContext) {
    super('tetris', ctx);
  }

  create(): void {
    const seed = hashString(this.ctx.manifest.id + ':' + this.now());
    this.state = createTetrisState(seed);

    this.drawBackground();
    this.drawBoardFrame();
    this.cellsGfx = this.add.graphics().setDepth(3);
    // 预览框画在 HUD 层（depth 10）上，方块必须更高一层，否则会被框的底色盖住
    this.previewGfx = this.add.graphics().setDepth(12);
    this.drawHud();
    this.drawControls();
    this.bindBoardGestures();
    this.drawHeader(this.t('arcade.tetris.name'), this.t('arcade.tetris.desc'));
    this.renderAll();

    this.lastTick = this.now();
    this.announceRound(1, TETRIS_GOAL_LINES);
    if (!this.autoplay && !this.instant) this.say('arcade.tetris.intro');
    if (this.autoplay) this.time.delayedCall(240, () => this.autoStep());
  }

  override update(): void {
    if (this.done || this.autoplay || this.state.finished) return;
    const now = this.now();
    const delta = Math.min(220, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    if (delta <= 0) return;

    const previous = this.state.active;
    const result = advance(this.state, delta);
    if (result.locked) {
      this.applyLock(result, false);
      return;
    }
    this.state = result.state;
    // 重力累计时间变了但画面没变时不重画
    if (this.state.active !== previous) this.renderCells();
  }

  /* ---------------- 输入：按钮与滑动走同一条路径 ---------------- */

  private handleMove(dx: number): void {
    if (this.done || this.state.finished) return;
    const result = tryMove(this.state, dx);
    if (!result.moved) return;
    this.state = result.state;
    this.renderCells();
  }

  private handleRotate(playTap = false): void {
    if (this.done || this.state.finished) return;
    const result = tryRotate(this.state, 1);
    if (!result.moved) return;
    this.state = result.state;
    this.renderCells();
    if (playTap) this.sfx('tap');
  }

  private handleSoftDrop(): void {
    if (this.done || this.state.finished) return;
    this.applyLock(stepDown(this.state), false);
  }

  private handleHardDrop(): void {
    if (this.done || this.state.finished) return;
    this.applyLock(hardDrop(this.state), true);
  }

  /** 棋盘上：左右滑 = 移动，下滑 = 下落一格，点按 = 旋转（与按钮同一组函数） */
  private bindBoardGestures(): void {
    const zone = this.add
      .zone(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2, BOARD_W, BOARD_H)
      .setInteractive();

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.done) return;
      this.dragStart = { x: pointer.x, y: pointer.y };
    });

    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.done) return;
      const start = this.dragStart;
      this.dragStart = null;
      if (!start) return;
      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
        this.handleRotate(true);
        return;
      }
      if (Math.abs(dx) >= Math.abs(dy)) {
        const steps = Math.min(3, Math.max(1, Math.round(Math.abs(dx) / 90)));
        for (let index = 0; index < steps; index += 1) this.handleMove(dx > 0 ? 1 : -1);
        return;
      }
      if (dy > 50) this.handleSoftDrop();
    });

    zone.on('pointerout', () => {
      this.dragStart = null;
    });
  }

  /* ---------------- 落子结果：消行 / 彩虹 / 结束都用这一个入口 ---------------- */

  private applyLock(result: TetrisLockResult, hard: boolean): void {
    this.state = result.state;
    this.renderAll();
    if (!result.locked) return;

    if (hard && !this.autoplay) {
      this.sfx('jump');
      if (!this.reducedMotion) this.cameras.main.shake(60, 0.0015);
    }

    if (result.rescues > 0) this.playRescue();
    if (result.clearedRows.length > 0) this.flashRows(result.clearedRows);

    const progressed = result.cleared > 0 || result.rescues > 0;
    if (progressed) {
      this.sfx(result.cleared > 0 ? 'correct' : 'sparkle');
      if (result.cleared >= 2) this.say('arcade.nice');
      this.showBanner(this.t('arcade.roundDone'), { y: 320, holdMs: 800 });
      if (!this.state.finished) {
        const next = Math.min(TETRIS_GOAL_LINES, this.state.lines + 1);
        this.announceRound(next, TETRIS_GOAL_LINES);
      }
    }

    if (result.finished) this.completeGame();
  }

  private completeGame(): void {
    if (this.done) return;
    this.done = true;
    this.dragStart = null;
    this.time.delayedCall(this.autoplay ? 240 : 620, () => this.finish(this.state.score));
  }

  /* ---------------- autoplay：AI 规划 → 同一组输入函数 ---------------- */

  private autoStep(): void {
    if (this.done || this.state.finished) return;

    const placement = planPlacement(this.state);
    if (placement) {
      let guard = 0;
      while (this.state.active.rotation !== placement.rotation && guard < 4) {
        const before = this.state;
        this.handleRotate(false);
        guard += 1;
        if (this.state === before) break;
      }
      guard = 0;
      while (this.state.active.x !== placement.x && guard < TETRIS_COLS + 4) {
        const before = this.state;
        this.handleMove(this.state.active.x < placement.x ? 1 : -1);
        guard += 1;
        if (this.state === before) break;
      }
    }

    this.handleHardDrop();
    if (!this.done && !this.state.finished) {
      this.time.delayedCall(80, () => this.autoStep());
    }
  }

  /* ---------------- 绘制 ---------------- */

  private drawBackground(): void {
    const bg = this.add.graphics().setDepth(-10);
    bg.fillStyle(THEME.paper, 1);
    bg.fillRect(0, 0, this.W, this.H);
    bg.fillStyle(THEME.mint, 0.55);
    bg.fillCircle(86, 1180, 170);
    bg.fillStyle(THEME.sky, 0.5);
    bg.fillCircle(694, 1220, 150);
  }

  private drawBoardFrame(): void {
    const frame = this.add.graphics().setDepth(1);
    roundRect(
      frame,
      BOARD_X - 10,
      BOARD_Y - 10,
      BOARD_W + 20,
      BOARD_H + 20,
      26,
      THEME.paperDeep,
      THEME.outline,
      5,
    );

    const cells = this.add.graphics().setDepth(2);
    for (let row = 0; row < TETRIS_ROWS; row += 1) {
      for (let column = 0; column < TETRIS_COLS; column += 1) {
        const x = BOARD_X + column * CELL;
        const y = BOARD_Y + row * CELL;
        roundRect(cells, x + 3, y + 3, CELL - 6, CELL - 6, 12, THEME.card, null, 0, 0.92);
      }
    }
  }

  private drawHud(): void {
    const g = this.add.graphics().setDepth(10);
    roundRect(g, BOARD_X, 164, 320, 60, 30, THEME.card, THEME.outline, 4);
    this.goalText = this.addText(BOARD_X + 160, 194, '', 28, CSS.ink, true).setDepth(11);
    this.addText(631, 194, this.t('arcade.next'), 28, CSS.ink, true).setDepth(11);

    for (let index = 0; index < 2; index += 1) {
      roundRect(
        g,
        PREVIEW_X,
        PREVIEW_CY + index * PREVIEW_GAP - 52,
        PREVIEW_W,
        104,
        24,
        THEME.paperDeep,
        THEME.outline,
        4,
      );
    }
  }

  private drawControls(): void {
    this.addBigButton(578, 700, '←', () => this.handleMove(-1), {
      width: 96,
      height: 96,
      fontSize: 44,
      color: THEME.bamboo,
    }).setDepth(30);
    this.addBigButton(684, 700, '→', () => this.handleMove(1), {
      width: 96,
      height: 96,
      fontSize: 44,
      color: THEME.bamboo,
    }).setDepth(30);
    this.addBigButton(578, 812, '↻', () => this.handleRotate(), {
      width: 96,
      height: 96,
      fontSize: 46,
      color: THEME.gold,
      textColor: CSS.ink,
    }).setDepth(30);
    this.addBigButton(684, 812, '↓', () => this.handleSoftDrop(), {
      width: 96,
      height: 96,
      fontSize: 46,
      color: THEME.skyDeep,
    }).setDepth(30);
    this.addBigButton(630, 958, this.t('arcade.drop'), () => this.handleHardDrop(), {
      width: 204,
      height: 108,
      fontSize: 38,
      color: THEME.warmRed,
    }).setDepth(30);
  }

  private renderAll(): void {
    this.renderCells();
    this.renderPreview();
    this.updateHud();
  }

  private renderCells(): void {
    const g = this.cellsGfx;
    if (!g) return;
    g.clear();

    for (let row = 0; row < TETRIS_ROWS; row += 1) {
      for (let column = 0; column < TETRIS_COLS; column += 1) {
        const kind = this.state.board[row]![column];
        if (kind !== null) this.drawBlock(g, column, row, kind, 1);
      }
    }

    if (this.state.finished) return;
    const ghost = ghostPiece(this.state);
    for (const cell of activeCells(ghost)) {
      if (cell.y >= 0) this.drawGhost(g, cell.x, cell.y, ghost.kind);
    }
    for (const cell of activeCells(this.state.active)) {
      if (cell.y >= 0) this.drawBlock(g, cell.x, cell.y, this.state.active.kind, 1);
    }
  }

  private drawBlock(
    g: Phaser.GameObjects.Graphics,
    column: number,
    row: number,
    kind: PieceKind,
    alpha: number,
  ): void {
    const x = BOARD_X + column * CELL;
    const y = BOARD_Y + row * CELL;
    const color = PIECE_COLORS[kind];
    roundRect(g, x + 3, y + 3, CELL - 6, CELL - 6, 12, color, THEME.outline, 3, alpha);
    g.fillStyle(shade(color, 1.28), 0.55 * alpha);
    g.fillRoundedRect(x + 11, y + 9, CELL * 0.36, CELL * 0.18, 6);
    g.fillStyle(shade(color, 0.82), 0.45 * alpha);
    g.fillRoundedRect(x + 10, y + CELL - 17, CELL - 20, 8, 4);
  }

  private drawGhost(
    g: Phaser.GameObjects.Graphics,
    column: number,
    row: number,
    kind: PieceKind,
  ): void {
    const x = BOARD_X + column * CELL;
    const y = BOARD_Y + row * CELL;
    const color = PIECE_COLORS[kind];
    g.fillStyle(color, 0.18);
    g.fillRoundedRect(x + 6, y + 6, CELL - 12, CELL - 12, 10);
    g.lineStyle(3, shade(color, 0.82), 0.55);
    g.strokeRoundedRect(x + 6, y + 6, CELL - 12, CELL - 12, 10);
  }

  private renderPreview(): void {
    const g = this.previewGfx;
    if (!g) return;
    g.clear();
    const previews = this.state.queue.slice(0, 2);
    previews.forEach((kind, index) => {
      const cells = shapeCells(kind, 0);
      const minX = Math.min(...cells.map((cell) => cell.x));
      const maxX = Math.max(...cells.map((cell) => cell.x));
      const minY = Math.min(...cells.map((cell) => cell.y));
      const maxY = Math.max(...cells.map((cell) => cell.y));
      const width = (maxX - minX + 1) * PREVIEW_CELL;
      const height = (maxY - minY + 1) * PREVIEW_CELL;
      const originX = 631 - width / 2 - minX * PREVIEW_CELL;
      const originY = PREVIEW_CY + index * PREVIEW_GAP - height / 2 - minY * PREVIEW_CELL;
      for (const cell of cells) {
        const x = originX + cell.x * PREVIEW_CELL;
        const y = originY + cell.y * PREVIEW_CELL;
        roundRect(
          g,
          x,
          y,
          PREVIEW_CELL - 2,
          PREVIEW_CELL - 2,
          6,
          PIECE_COLORS[kind],
          THEME.outline,
          2,
        );
      }
    });
  }

  private updateHud(): void {
    const remaining = Math.max(0, TETRIS_GOAL_LINES - this.state.lines);
    this.goalText?.setText(this.t('arcade.goalLines', { n: remaining }));
  }

  /* ---------------- 反馈动画 ---------------- */

  private flashRows(rows: readonly number[]): void {
    const g = this.add.graphics().setDepth(15);
    for (const row of rows) {
      g.fillStyle(THEME.gold, 0.85);
      g.fillRoundedRect(BOARD_X + 4, BOARD_Y + row * CELL + 4, BOARD_W - 8, CELL - 8, 10);
    }
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: this.reducedMotion ? 200 : 460,
      delay: 60,
      onComplete: () => g.destroy(),
    });
  }

  /** 堆到顶的彩虹救援：最下面 4 行闪一道彩虹，然后继续玩 */
  private playRescue(): void {
    const top = BOARD_Y + (TETRIS_ROWS - TETRIS_RESCUE_ROWS) * CELL;
    const bandHeight = (TETRIS_RESCUE_ROWS * CELL) / RAINBOW.length;
    const g = this.add.graphics().setDepth(16);
    for (let index = 0; index < RAINBOW.length; index += 1) {
      g.fillStyle(RAINBOW[index]!, 0.85);
      g.fillRect(BOARD_X, top + index * bandHeight, BOARD_W, bandHeight);
    }
    if (this.reducedMotion) {
      this.time.delayedCall(300, () => g.destroy());
    } else {
      this.tweens.add({
        targets: g,
        alpha: 0,
        duration: 700,
        delay: 120,
        onComplete: () => g.destroy(),
      });
      sparkleAt(this, BOARD_X + BOARD_W / 2, top + 40, THEME.gold, 6);
    }
  }
}

export function createTetrisScene(ctx: ArcadeContext): Phaser.Types.Scenes.SceneType {
  return class extends TetrisScene {
    constructor() {
      super(ctx);
    }
  };
}
