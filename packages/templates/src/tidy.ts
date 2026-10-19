import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  CSS,
  THEME,
  createDragController,
  createHand,
  drawBin,
  drawRoom,
  drawToy,
  groundShadow,
  popIn,
  roundRect,
  sparkleAt,
  springBack,
  textStyle,
} from '@bamboo/phaser-kit';
import type { DragController } from '@bamboo/phaser-kit';
import { createTidyState, tidyComplete, tidyItem, tryTidy } from './tidy.logic';
import type { TidyLevel, ToyKind } from './tidy.logic';
import { SCENE_KEYS, TIDY_LAYOUT } from './layout';

/**
 * 整理：把地上的玩具按类别送回箱子。
 *
 * 色盲友好：箱子颜色只是装饰，类别全靠箱口的图标 + 箱子下面的名字区分；
 * 玩具自己的颜色也和箱子不一定一样（内容里就是故意错开的），逼着孩子看形状。
 */

/** 抓取半径：玩具本身只有 70 左右，判定放宽到 86 */
const GRAB_RADIUS = 86;

/** 投箱判定半径：任务约定 ≥120，这里 130 */
const BIN_RADIUS = 130;

/** 三个箱子在底部一排；小车的箱子在第二排（layout 里的坐标），箱体收窄才不出画 */
const BIN_SIZE: Record<ToyKind, { w: number; h: number }> = {
  ball: { w: 190, h: 150 },
  block: { w: 190, h: 150 },
  book: { w: 190, h: 150 },
  car: { w: 140, h: 118 },
};

interface BinInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  art: Phaser.GameObjects.Graphics;
}

type TidyItem = TidyLevel['items'][number];

export function createTidyScene(ctx: GameContext, level: TidyLevel): Phaser.Types.Scenes.SceneType {
  return class TidyScene extends BaseScene {
    private drag: DragController | null = null;
    private state = createTidyState();
    private bins = new Map<ToyKind, BinInfo>();
    private nodes = new Map<string, Phaser.GameObjects.Container>();
    private homes = new Map<string, { x: number; y: number }>();
    private hintRing: Phaser.GameObjects.Graphics | null = null;
    private hand: Phaser.GameObjects.Graphics | null = null;
    private finished = false;
    /** 上一次真的动过的时间：卡住 9 秒就把正确箱子亮出来 */
    private lastActionAt = 0;

    constructor() {
      super(SCENE_KEYS.tidy, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.tidy });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });

      this.drag = createDragController(this);
      this.onShutdownCleanup(() => {
        this.drag?.destroy();
        this.drag = null;
        this.hideHand();
      });

      const room = this.add.graphics().setDepth(0);
      drawRoom(room, level.room, this.W, this.H);
      this.drawPlayMat();
      this.drawBins();
      this.drawToys();
      this.drawHeader(ctx.task.title);
      this.fadeIn();

      this.lastActionAt = this.ctx.services.now();
      if (!this.instant) this.speak(ctx.task.intro);
      this.time.addEvent({ delay: 1200, loop: true, callback: () => this.checkIdle() });

      if (this.autoplay) this.runAutoplay();
    }

    // ---------------- 布景 ----------------

    /**
     * 玩具散落区（layout 的 stage）在房间的地板线之上：铺一块游戏垫，
     * 玩具才像"摊在地垫上"，而不是浮在墙上。
     */
    private drawPlayMat(): void {
      const g = this.add.graphics().setDepth(1);
      const x = 40;
      const y = 500;
      const w = 670;
      const h = 430;
      roundRect(g, x, y, w, h, 44, 0xd9e7c6, THEME.bambooLight, 6);
      roundRect(g, x + 18, y + 18, w - 36, h - 36, 34, 0xe2eed2, null, 0);
      g.lineStyle(3, THEME.bambooLight, 0.5);
      for (let i = 1; i < 6; i += 1) g.lineBetween(x + 30, y + (h * i) / 6, x + w - 30, y + (h * i) / 6);
    }

    private drawBins(): void {
      for (const bin of level.bins) {
        const point = TIDY_LAYOUT.bins[bin.kind];
        const size = BIN_SIZE[bin.kind];
        const art = this.add.graphics().setDepth(10);
        drawBin(art, bin.kind, parseHex(bin.color), point.x, point.y, size.w, size.h);
        // 箱子下面的名字：靠图标认类别，字只是备份（不识字的孩子也能看图）
        this.add
          .text(point.x, point.y + size.h / 2 + 30, bin.label, textStyle(32, CSS.ink, true))
          .setOrigin(0.5)
          .setDepth(12);
        this.bins.set(bin.kind, { x: point.x, y: point.y, ...size, art });
      }
    }

    private drawToys(): void {
      for (const item of level.items) {
        const x = TIDY_LAYOUT.stage.x + item.x * TIDY_LAYOUT.stage.w;
        const y = TIDY_LAYOUT.stage.y + item.y * TIDY_LAYOUT.stage.h;
        const node = this.add.container(x, y).setDepth(30);
        const art = this.add.graphics();
        groundShadow(art, 0, 44, 76, 18, 0.12);
        drawToy(art, item.kind, parseHex(item.color), 0, 0, 1);
        node.add(art);
        this.nodes.set(item.id, node);
        this.homes.set(item.id, { x, y });
        popIn(this, node);

        this.drag?.add({
          obj: node,
          radius: GRAB_RADIUS,
          enabled: () => !this.finished && this.nodes.has(item.id),
          onGrab: () => this.grab(item.id, node),
          onDrop: () => this.drop(item.id, node),
        });
      }
    }

    // ---------------- 拖拽 ----------------

    private grab(itemId: string, node: Phaser.GameObjects.Container): void {
      if (this.finished || !this.nodes.has(itemId)) return;
      this.lastActionAt = this.ctx.services.now();
      this.hideHand();
      this.clearHintRing();
      node.setDepth(90);
      this.tweens.killTweensOf(node);
      this.tweens.add({ targets: node, scale: 1.15, duration: 120, ease: 'Quad.easeOut' });
    }

    private drop(itemId: string, node: Phaser.GameObjects.Container): void {
      if (this.finished) return;
      this.lastActionAt = this.ctx.services.now();
      this.clearHintRing();

      const item = tidyItem(level, itemId);
      const home = this.homes.get(itemId);
      if (!item || !home) return;

      const binKind = this.binAt(node.x, node.y);
      if (binKind === item.kind) {
        this.sort(item, node, binKind);
        return;
      }

      // 放进错的箱子才算错；放在空地上只是弹回去，不打断
      if (binKind !== null) {
        this.noteMistake('tidy');
        this.say(ctx.task.retry, 1800);
        this.shakeBin(binKind);
        // 亮出对的箱子：下一次就知道要看箱口图标了
        this.time.delayedCall(320, () => this.showBinHint(item.kind));
      }
      node.setDepth(30);
      springBack(this, node, home.x, home.y);
      this.tweens.add({ targets: node, scale: 1, duration: 200 });
    }

    private binAt(x: number, y: number): ToyKind | null {
      let best: ToyKind | null = null;
      let bestDistance = BIN_RADIUS;
      for (const [kind, bin] of this.bins) {
        const distance = Math.hypot(x - bin.x, y - bin.y);
        if (distance <= bestDistance) {
          best = kind;
          bestDistance = distance;
        }
      }
      return best;
    }

    private sort(item: TidyItem, node: Phaser.GameObjects.Container, binKind: ToyKind): void {
      const result = tryTidy(this.state, level, item.id, binKind);
      if (result.status !== 'correct') return;
      this.state = result.state;

      this.noteCorrect();
      this.sfx('pop');
      const bin = this.bins.get(binKind);
      this.drag?.remove(node);
      this.nodes.delete(item.id);
      this.tweens.killTweensOf(node);
      if (bin) {
        sparkleAt(this, bin.x, bin.y - 20, THEME.gold, 5);
        this.tweens.add({
          targets: node,
          x: bin.x,
          y: bin.y + 10,
          scale: 0.28,
          alpha: 0.9,
          duration: 240,
          ease: 'Quad.easeOut',
          onComplete: () => node.destroy(),
        });
      } else {
        this.tweens.add({ targets: node, scale: 0.28, alpha: 0, duration: 240, onComplete: () => node.destroy() });
      }

      if (tidyComplete(this.state, level)) this.complete();
    }

    // ---------------- 提示 ----------------

    private shakeBin(kind: ToyKind): void {
      const bin = this.bins.get(kind);
      if (!bin) return;
      this.tweens.killTweensOf(bin.art);
      this.tweens.add({
        targets: bin.art,
        x: 12,
        duration: 55,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => bin.art.setX(0),
      });
    }

    private showBinHint(kind: ToyKind): void {
      const bin = this.bins.get(kind);
      if (!bin) return;
      this.clearHintRing();
      const ring = this.add.graphics().setDepth(40);
      ring.setPosition(bin.x, bin.y);
      ring.lineStyle(9, THEME.gold, 0.95);
      ring.strokeCircle(0, 0, Math.max(bin.w, bin.h) / 2 + 30);
      this.hintRing = ring;
      this.tweens.add({
        targets: ring,
        scale: 1.12,
        alpha: 0.4,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.time.delayedCall(2600, () => this.clearHintRing());
    }

    private clearHintRing(): void {
      if (!this.hintRing) return;
      this.tweens.killTweensOf(this.hintRing);
      this.hintRing.destroy();
      this.hintRing = null;
    }

    private checkIdle(): void {
      if (this.finished || this.autoplay) return;
      const now = this.ctx.services.now();
      if (now - this.lastActionAt < 9000) return;
      this.lastActionAt = now;
      const next = level.items.find((item) => this.nodes.has(item.id));
      const home = next ? this.homes.get(next.id) : undefined;
      if (!next || !home) return;
      this.showBinHint(next.kind);
      if (!this.hand) this.hand = createHand(this, home.x, home.y + 40, 1.15);
      this.showHint(ctx.task.tip, 2600, 300);
    }

    private hideHand(): void {
      if (!this.hand) return;
      this.tweens.killTweensOf(this.hand);
      this.hand.destroy();
      this.hand = null;
    }

    // ---------------- 收尾 ----------------

    private complete(): void {
      if (this.finished) return;
      this.finished = true;
      this.hideHand();
      this.clearHintRing();
      for (const bin of this.bins.values()) sparkleAt(this, bin.x, bin.y - 40, THEME.gold, 4);
      this.time.delayedCall(this.instant ? 120 : 480, () => this.finishTask({ praise: ctx.task.done }));
    }

    // ---------------- 自动通关 ----------------

    /** 先真的把玩具挪到箱子上，再走与真实拖拽完全相同的落点判定 */
    private runAutoplay(): void {
      const travel = this.instant ? 90 : 260;
      const gap = this.instant ? 40 : 110;
      level.items.forEach((item, index) => {
        const node = this.nodes.get(item.id);
        const bin = this.bins.get(item.kind);
        if (!node || !bin) return;
        this.time.delayedCall(140 + index * (travel + gap), () => {
          if (this.finished) return;
          node.setDepth(90);
          this.tweens.add({
            targets: node,
            x: bin.x,
            y: bin.y,
            duration: travel,
            ease: 'Quad.easeInOut',
            onComplete: () => {
              if (!this.finished) this.drop(item.id, node);
            },
          });
        });
      });
    }
  };
}

function parseHex(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}
