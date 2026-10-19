import type Phaser from 'phaser';
import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  CSS,
  THEME,
  circle,
  createDragController,
  drawFood,
  drawPanda,
  drawPlate,
  drawRoom,
  popIn,
  roundRect,
  shade,
  sparkleAt,
  springBack,
  starPath,
  textStyle,
} from '@bamboo/phaser-kit';
import type { DragController } from '@bamboo/phaser-kit';
import { SCENE_KEYS } from './layout';
import { bite, createFeedState, feedProgress } from './feed.logic';
import type { FeedLevel, FeedState } from './feed.logic';
import type { FoodKind } from './common';
import type { MessageKey } from '@bamboo/i18n';

/** 竹竹嘴的中心（设计坐标）：拖到这里才算喂到 */
const MOUTH = { x: 375, y: 650 } as const;

/** 嘴的判定半径：比看到的嘴大得多，孩子不用瞄准 */
const BITE_RADIUS = 150;

/**
 * 食物 0–1 坐标映射到的桌面矩形（写死常量，换美术只改这一处）。
 * 内容脚本里有"同一列上下两个食物"（苹果 0.62 / 饼干 0.86），
 * 所以桌子画得深一些、纵向留够 300px，标签才不会互相压住。
 */
const FOOD_RECT = { x: 105, y: 770, w: 540, h: 300 } as const;

/** 桌面台面（食物区必须落在里面，否则看起来像浮在空中） */
const TABLE = { x: 55, y: 748, w: 640, h: 400 } as const;

/** 顶部均衡进度的圆心与半径 */
const BALANCE_Y = 306;
const BALANCE_R = 52;

/** 抓食物的半径：比食物本身大，孩子按偏一点也能拖 */
const GRAB_RADIUS = 100;

/** 12 秒没有任何有效操作才提示 */
const IDLE_HINT_MS = 12_000;

/** "吃得真均衡"这句夸奖至少留这么久再做完成结算，不然会被完成卡片打断 */
const BALANCE_LINE_MS = 900;

/** 食物类别 → 文案键（中英共用一份；孩子看图为主，文字只做备份） */
const FOOD_LABEL_KEYS: Record<FoodKind, MessageKey> = {
  bamboo: 'food.bamboo',
  veg: 'food.veg',
  fruit: 'food.fruit',
  grain: 'food.grain',
  protein: 'food.protein',
  snack: 'food.snack',
};

interface FoodView {
  food: FeedLevel['foods'][number];
  container: Phaser.GameObjects.Container;
  homeX: number;
  homeY: number;
  finished: boolean;
}

interface BalanceView {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Graphics;
  lit: boolean;
}

/**
 * 吃饭模板：把桌上的食物拖到竹竹嘴边，一口一口喂完。
 * - 教育点是"不挑食"：顶部按 needKinds 显示均衡进度，吃到一类亮一个；
 * - 拖到别处只弹回，不算错、不惩罚；
 * - ?autoplay=1 逐口走 attemptBite（与真实拖拽同一条处理函数）。
 */
export function createFeedScene(ctx: GameContext, level: FeedLevel): Phaser.Types.Scenes.SceneType {
  return class FeedScene extends BaseScene {
    private readonly level = level;
    private state!: FeedState;
    private drag: DragController | null = null;
    private pandaG: Phaser.GameObjects.Graphics | null = null;
    private mouthHint: Phaser.GameObjects.Graphics | null = null;
    private guideHand: Phaser.GameObjects.Graphics | null = null;
    private nudgeHand: Phaser.GameObjects.Graphics | null = null;
    private foodViews: FoodView[] = [];
    private balanceViews = new Map<FoodKind, BalanceView>();
    private lastActionAt = 0;
    private done = false;
    private balancedSaid = false;
    private balancedAt = 0;
    /** autoplay 的墙钟定时器：shutdown 时必须清掉，否则退出后还会往已销毁的场景里塞操作 */
    private autoplayTimers: number[] = [];

    constructor() {
      super(SCENE_KEYS.feed, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.feed });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });
      this.state = createFeedState();
      this.lastActionAt = this.ctx.services.now();

      this.drawWorld();
      this.spawnFoods();
      this.drawBalance();
      this.fadeIn();

      this.time.addEvent({ delay: 1000, loop: true, callback: () => this.checkIdle() });

      if (!this.instant) this.speak(this.ctx.task.intro);

      if (!this.autoplay) {
        const first = this.foodViews[0];
        if (first) {
          // 小手放在食物左下方：直接压在食物上会挡住它，孩子反而看不清要拖什么
          this.guideHand = this.createHandAt(first.homeX - 96, first.homeY - 26, 1.05);
          this.time.delayedCall(4200, () => this.dismissGuide());
        }
      }

      this.onShutdownCleanup(() => {
        for (const timer of this.autoplayTimers) window.clearTimeout(timer);
        this.autoplayTimers.length = 0;
        this.drag?.destroy();
        this.drag = null;
        this.killHand(this.guideHand);
        this.guideHand = null;
        this.killHand(this.nudgeHand);
        this.nudgeHand = null;
      });

      if (this.autoplay) this.runAutoplay();
    }

    // ---------------- 画面 ----------------

    private drawWorld(): void {
      const room = this.add.graphics().setDepth(0);
      drawRoom(room, 'kitchen', this.W, this.H);
      this.drawHeader(this.ctx.task.title);

      // 竹竹在桌子后面：先画它，桌面会把下半身挡住
      this.pandaG = this.add.graphics().setDepth(2);
      this.drawPandaArt();

      const table = this.add.graphics().setDepth(6);
      this.drawTableArt(table);
    }

    private drawPandaArt(): void {
      const g = this.pandaG;
      if (!g) return;
      g.clear();
      // 围兜 + 饿了的张嘴：一眼看懂"该喂它了"
      drawPanda(g, 375, 700, 0.8, { mood: 'hungry', accessories: { bib: 'bib-star' } });
    }

    private drawTableArt(g: Phaser.GameObjects.Graphics): void {
      roundRect(g, TABLE.x, TABLE.y, TABLE.w, TABLE.h, 34, THEME.wood, THEME.outline, 7);
      roundRect(g, TABLE.x + 23, TABLE.y + 24, TABLE.w - 46, 130, 26, shade(THEME.wood, 1.08), null, 0);
      // 餐垫：米白一块，食物和标签在深色木桌上才看得清
      roundRect(g, 92, 786, 566, 300, 30, THEME.cream, null, 0);
      // 前缘与桌腿
      roundRect(
        g,
        TABLE.x,
        TABLE.y + TABLE.h,
        TABLE.w,
        62,
        { tl: 0, tr: 0, bl: 30, br: 30 },
        shade(THEME.wood, 0.9),
        THEME.outline,
        5,
      );

      for (const legX of [118, 592]) {
        g.fillStyle(THEME.woodDeep, 1);
        g.fillRect(legX, TABLE.y + TABLE.h + 56, 40, 120);
        g.lineStyle(5, THEME.outline, 1);
        g.strokeRect(legX, TABLE.y + TABLE.h + 56, 40, 120);
      }
    }

    /** 内容 JSON 的 0–1 坐标 → 设计坐标（唯一映射点） */
    private foodPoint(x: number, y: number): { x: number; y: number } {
      return { x: FOOD_RECT.x + x * FOOD_RECT.w, y: FOOD_RECT.y + y * FOOD_RECT.h };
    }

    /**
     * 同一列上下挨得近时，把标签翻到食物上方 —— 否则下面那份食物会盖住它。
     * 规则按坐标算而不是写死第几个，换关卡脚本也不用重调。
     */
    private labelAbove(index: number, homes: { x: number; y: number }[]): boolean {
      const home = homes[index];
      let above = Number.POSITIVE_INFINITY;
      let below = Number.POSITIVE_INFINITY;
      homes.forEach((other, otherIndex) => {
        if (otherIndex === index || Math.abs(other.x - home.x) > 90) return;
        const dy = other.y - home.y;
        if (dy > 0 && dy < below) below = dy;
        if (dy < 0 && -dy < above) above = -dy;
      });
      return below < 130 && above > below;
    }

    private spawnFoods(): void {
      // 先算所有落点：判断标签上下需要看到同列的其他食物
      const homes = this.level.foods.map((food) => this.foodPoint(food.x, food.y));
      this.level.foods.forEach((food, index) => {
        const home = homes[index];
        const container = this.add.container(home.x, home.y).setDepth(30);
        const above = this.labelAbove(index, homes);

        const art = this.add.graphics();
        drawPlate(art, 0, 34, 60);
        drawFood(art, food.kind, 0, -2, 0.9);

        const labelText = this.tr(FOOD_LABEL_KEYS[food.kind]);
        const label = this.add
          // 英文标签更长（Bamboo shoot / Veggie）：长词缩一号，避免压到盘子与旁边食物
          .text(0, above ? -97 : 91, labelText, textStyle(labelText.length > 6 ? 24 : 30, CSS.ink, true))
          .setOrigin(0.5);
        const tag = this.add.graphics();
        const tagW = label.width + 26;
        roundRect(tag, -tagW / 2, above ? -118 : 70, tagW, 42, 21, THEME.card, THEME.outline, 3, 0.95);

        container.add([art, tag, label]);
        popIn(this, container, 120 + index * 60);

        const view: FoodView = {
          food,
          container,
          homeX: home.x,
          homeY: home.y,
          finished: false,
        };
        this.foodViews.push(view);

        this.drag ??= createDragController(this);
        this.drag.add({
          obj: container,
          radius: GRAB_RADIUS,
          enabled: () => !view.finished && !this.done,
          onGrab: () => this.onFoodGrab(view),
          onDrop: () => this.onFoodDrop(view),
        });
      });
    }

    private drawBalance(): void {
      const bar = this.add.graphics().setDepth(40);
      roundRect(bar, 58, 238, 634, 136, 68, THEME.card, THEME.outline, 5);
      this.add
        .text(this.W / 2, 206, this.tr('game.balance'), textStyle(32, CSS.inkSoft, true))
        .setOrigin(0.5)
        .setDepth(41);

      // needKinds 去重后平均摆一排；重复的类别只亮一个图标
      const kinds = [...new Set(this.level.needKinds)];
      const gap = Math.min(132, (this.W - 180) / Math.max(1, kinds.length));
      const startX = this.W / 2 - ((kinds.length - 1) * gap) / 2;
      kinds.forEach((kind, index) => {
        const holder = this.add.container(startX + index * gap, BALANCE_Y).setDepth(42);
        const bg = this.add.graphics();
        const icon = this.add.graphics();
        drawFood(icon, kind, 0, 6, 0.42);
        holder.add([bg, icon]);
        this.balanceViews.set(kind, { container: holder, bg, icon, lit: false });
      });
      this.refreshBalance(true);
    }

    /** 吃到一类就点亮一个图标：金圈 + 小星星 + 图标恢复全彩 */
    private refreshBalance(initial = false): void {
      const kinds = new Set(feedProgress(this.state, this.level).kinds);
      for (const [kind, view] of this.balanceViews) {
        const lit = kinds.has(kind);
        if (!initial && lit === view.lit) continue;
        view.lit = lit;
        view.bg.clear();
        circle(view.bg, 0, 0, BALANCE_R, lit ? THEME.card : THEME.paperDeep, THEME.outline, 4);
        if (lit) {
          view.bg.lineStyle(7, THEME.gold, 1);
          view.bg.strokeCircle(0, 0, BALANCE_R);
          starPath(view.bg, BALANCE_R * 0.72, -BALANCE_R * 0.72, 14, 6, 5, THEME.gold, THEME.goldDeep, 3);
        }
        view.icon.setAlpha(lit ? 1 : 0.45);
        if (lit && !initial && !this.reducedMotion) {
          this.tweens.add({ targets: view.container, scale: 1.2, duration: 130, yoyo: true });
        }
      }
    }

    // ---------------- 拖拽 ----------------

    private onFoodGrab(view: FoodView): void {
      if (view.finished || this.done) return;
      this.lastActionAt = this.ctx.services.now();
      this.tweens.killTweensOf(view.container);
      view.container.setDepth(200);
      this.showMouthHint();
      this.dismissGuide();
    }

    private onFoodDrop(view: FoodView): void {
      this.lastActionAt = this.ctx.services.now();
      view.container.setDepth(30);
      this.hideMouthHint();
      if (view.finished || this.done) return;

      // 拖到嘴边：容器中心或手指位置任一进入大圈都算，避免"明明放上去了却没吃到"
      const pointer = this.input.activePointer;
      const near =
        Math.hypot(view.container.x - MOUTH.x, view.container.y - MOUTH.y) <= BITE_RADIUS ||
        Math.hypot(pointer.x - MOUTH.x, pointer.y - MOUTH.y) <= BITE_RADIUS;
      if (near) this.attemptBite(view);
      if (!view.finished) springBack(this, view.container, view.homeX, view.homeY);
    }

    /** 真实拖拽与 autoplay 共用的"喂一口" */
    private attemptBite(view: FoodView): void {
      if (this.done || view.finished) return;
      const result = bite(this.state, this.level, view.food.id);
      this.state = result.state;
      this.noteCorrect();
      this.lastActionAt = this.ctx.services.now();
      this.sfx('chew');
      this.chewFeedback();

      if (result.finished) {
        view.finished = true;
        this.drag?.remove(view.container);
        this.tweens.killTweensOf(view.container);
        this.tweens.add({
          targets: view.container,
          alpha: 0,
          scale: 0.7,
          duration: 260,
          ease: 'Quad.easeOut',
          onComplete: () => view.container.destroy(true),
        });
      }

      this.refreshBalance();
      const progress = feedProgress(this.state, this.level);
      if (progress.balanced && !this.balancedSaid) {
        this.balancedSaid = true;
        this.balancedAt = this.ctx.services.now();
        this.say(this.tr('game.balanced'), 2600, 430);
      }
      if (progress.complete) this.complete();
    }

    private chewFeedback(): void {
      const panda = this.pandaG;
      if (panda) {
        this.tweens.killTweensOf(panda);
        panda.setY(6);
        this.tweens.add({ targets: panda, y: 0, duration: 160, ease: 'Quad.easeOut' });
      }
      sparkleAt(this, MOUTH.x, MOUTH.y, THEME.gold, 3);
      // 腮帮子鼓一下：不用重画整只熊猫也能看出"在嚼"
      const cheek = this.add.graphics().setDepth(50).setPosition(MOUTH.x, MOUTH.y - 6);
      cheek.fillStyle(THEME.blush, 0.9);
      cheek.fillEllipse(0, 0, 64, 46);
      this.tweens.add({
        targets: cheek,
        scale: 1.35,
        alpha: 0,
        duration: 320,
        ease: 'Quad.easeOut',
        onComplete: () => cheek.destroy(),
      });
    }

    private showMouthHint(): void {
      this.hideMouthHint();
      const g = this.add.graphics().setDepth(20).setPosition(MOUTH.x, MOUTH.y);
      g.lineStyle(8, THEME.warmRed, 0.75);
      g.strokeCircle(0, 0, 120);
      this.mouthHint = g;
      if (this.reducedMotion) return;
      this.tweens.add({
        targets: g,
        alpha: 0.3,
        scale: 1.08,
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    private hideMouthHint(): void {
      if (!this.mouthHint) return;
      this.tweens.killTweensOf(this.mouthHint);
      this.mouthHint.destroy();
      this.mouthHint = null;
    }

    // ---------------- 完成 ----------------

    private complete(): void {
      if (this.done) return;
      this.done = true;
      this.hideMouthHint();
      this.hideNudgeHand();
      // "吃得真均衡"刚说出口时稍等一下，别让完成卡片把它盖掉
      const elapsed = this.balancedAt === 0 ? BALANCE_LINE_MS : this.ctx.services.now() - this.balancedAt;
      const wait = Math.max(0, BALANCE_LINE_MS - elapsed);
      if (wait > 0) {
        this.autoplayTimers.push(window.setTimeout(() => this.finishTask(), wait));
      } else {
        this.finishTask();
      }
    }

    // ---------------- 提示与小手 ----------------

    private checkIdle(): void {
      if (this.done) return;
      const now = this.ctx.services.now();
      if (now - this.lastActionAt < IDLE_HINT_MS) return;
      this.lastActionAt = now;
      const next = this.foodViews.find((view) => !view.finished);
      this.showNudgeHand(next ? next.container.x : MOUTH.x, next ? next.container.y - 90 : MOUTH.y + 120);
      this.say(this.ctx.task.tip, 3200, 430);
    }

    private showNudgeHand(x: number, y: number): void {
      this.hideNudgeHand();
      const hand = this.createHandAt(x, y, 1.15);
      this.nudgeHand = hand;
      this.time.delayedCall(3600, () => {
        if (this.nudgeHand === hand) this.hideNudgeHand();
      });
    }

    private hideNudgeHand(): void {
      this.killHand(this.nudgeHand);
      this.nudgeHand = null;
    }

    private dismissGuide(): void {
      this.killHand(this.guideHand);
      this.guideHand = null;
    }

    private killHand(hand: Phaser.GameObjects.Graphics | null): void {
      if (!hand) return;
      this.tweens.killTweensOf(hand);
      hand.destroy();
    }

    // ---------------- 自动通关（与真实操作共用处理函数） ----------------

    private runAutoplay(): void {
      let index = 0;
      for (const view of this.foodViews) {
        for (let i = 0; i < view.food.bites; i += 1) {
          // 墙钟定时器：Phaser 计时器在低帧率设备开场会被压缩 delta，自动演示会莫名变慢
          this.autoplayTimers.push(window.setTimeout(() => this.autoBite(view), 420 + index * 300));
          index += 1;
        }
      }
    }

    private autoBite(view: FoodView): void {
      if (this.done || view.finished) return;
      // 与真实拖拽同一条路径：先把食物摆到嘴边，再交给 attemptBite
      this.tweens.killTweensOf(view.container);
      view.container.setPosition(MOUTH.x, MOUTH.y);
      this.attemptBite(view);
      if (!view.finished) springBack(this, view.container, view.homeX, view.homeY);
    }
  };
}