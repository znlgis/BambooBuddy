import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  THEME,
  createDragController,
  createHand,
  drawClothing,
  drawPanda,
  drawRoom,
  groundShadow,
  popIn,
  roundRect,
  sparkleAt,
  springBack,
} from '@bamboo/phaser-kit';
import type { DragController, PandaAccessories, PandaMood } from '@bamboo/phaser-kit';
import { createDressState, dressComplete, dressItem, tryDress } from './dress.logic';
import type { ClothingKind, DressLevel } from './dress.logic';
import { SCENE_KEYS } from './layout';

/**
 * 穿衣：把台面上的衣服拖到竹竹身上该去的地方。
 *
 * 为什么坐标写死在这里：内容 JSON 只给 0–1 的相对坐标，真正的像素位置由模板定；
 * 这一关的四个部位（头顶 / 胸口 / 侧后 / 脚）与台面就是下面这几个常量，
 * QA 用同一组数字做真实拖拽（半径 130，小朋友手抖也放得进去）。
 */

/** 竹竹站位：脚落在 1045 的地板上，与下面四个槽位对得上 */
const PANDA_POSE = { x: 375, y: 855, scale: 1.3 } as const;

/** 衣服台：内容 JSON 的 items.x / items.y（0–1）映射到这条台面 */
const TRAY = { x: 60, y: 1090, w: 630, h: 120 } as const;

/** 台面上沿：衣服摆在这里，看起来是"放在台子上"而不是浮着 */
const TABLE_TOP_Y = 1210;

/** 抓取半径（拖拽起点判定）：手指比图粗一圈 */
const GRAB_RADIUS = 92;

/** 槽位判定半径：任务约定 ≥120，这里给 130 */
const SLOT_RADIUS = 130;

/** 四个部位的判定中心 */
const SLOTS: Record<ClothingKind, { x: number; y: number }> = {
  hat: { x: 375, y: 560 },
  bib: { x: 375, y: 810 },
  backpack: { x: 460, y: 760 },
  // 内容现在不给 outfit；留着这个部位，等级脚本换成整套衣服时也能玩
  outfit: { x: 375, y: 900 },
  shoes: { x: 375, y: 1110 },
};

/**
 * drawPanda 的配件是按 id 前缀取预置配色的（见 phaser-kit/panda.ts）。
 * 内容里的颜色无法直接塞进去，所以按"离得最近"挑一种预置 ——
 * 至少保证穿上身的那件和拖过来的那件是同一色系。
 */
const ACCESSORY_CANDIDATES: Record<ClothingKind, { id: string; color: number }[]> = {
  hat: [
    { id: 'hat-bamboo', color: THEME.bamboo },
    { id: 'hat-straw', color: THEME.sun },
    { id: 'hat-crown', color: THEME.gold },
  ],
  bib: [
    { id: 'bib-star', color: THEME.sun },
    { id: 'bib-bamboo', color: THEME.bamboo },
    { id: 'bib-flower', color: THEME.pink },
  ],
  outfit: [
    { id: 'outfit-pjs', color: THEME.lavender },
    { id: 'outfit-rain', color: THEME.gold },
  ],
  backpack: [
    { id: 'backpack-red', color: THEME.warmRed },
    { id: 'backpack-leaf', color: THEME.bamboo },
  ],
  shoes: [
    { id: 'shoes-red', color: THEME.warmRed },
    { id: 'shoes-green', color: THEME.bamboo },
  ],
};

function parseHex(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

function colorDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return dr * dr + dg * dg + db * db;
}

function accessoryIdFor(slot: ClothingKind, hex: string): string {
  const target = parseHex(hex);
  const candidates = ACCESSORY_CANDIDATES[slot];
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = colorDistance(target, candidate.color);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.id;
}

type DressItem = DressLevel['items'][number];

export function createDressScene(ctx: GameContext, level: DressLevel): Phaser.Types.Scenes.SceneType {
  return class DressScene extends BaseScene {
    private drag: DragController | null = null;
    private panda: Phaser.GameObjects.Graphics | null = null;
    private state = createDressState();
    private nodes = new Map<string, Phaser.GameObjects.Container>();
    private homes = new Map<string, { x: number; y: number }>();
    private hintRing: Phaser.GameObjects.Graphics | null = null;
    private hand: Phaser.GameObjects.Graphics | null = null;
    private finished = false;
    /** 上一次真的动过的时间：卡住 9 秒就把正确槽位亮出来 */
    private lastActionAt = 0;

    constructor() {
      super(SCENE_KEYS.dress, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.dress });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });

      this.drag = createDragController(this);
      this.onShutdownCleanup(() => {
        this.drag?.destroy();
        this.drag = null;
        this.hideHand();
      });

      const room = this.add.graphics().setDepth(0);
      drawRoom(room, level.room, this.W, this.H);
      this.drawTable();
      this.drawPandaBody();
      this.drawItems();
      this.drawHeader(ctx.task.title);
      this.fadeIn();

      this.lastActionAt = this.ctx.services.now();
      if (!this.instant) this.speak(ctx.task.intro);

      // 孩子卡住时不会说"我卡住了"：长时间没动作就把手和该去的位置亮出来
      this.time.addEvent({ delay: 1200, loop: true, callback: () => this.checkIdle() });

      if (this.autoplay) this.runAutoplay();
    }

    // ---------------- 布景 ----------------

    private drawTable(): void {
      const g = this.add.graphics().setDepth(2);
      roundRect(g, TRAY.x - 20, TABLE_TOP_Y, TRAY.w + 40, 26, 13, THEME.wood, THEME.outline, 5);
      g.fillStyle(THEME.woodDeep, 1);
      g.fillRect(TRAY.x + 20, TABLE_TOP_Y + 26, 22, 78);
      g.fillRect(TRAY.x + TRAY.w - 42, TABLE_TOP_Y + 26, 22, 78);
      groundShadow(g, this.W / 2, TABLE_TOP_Y + 112, TRAY.w, 26, 0.1);
    }

    private drawPandaBody(): void {
      const g = this.add.graphics().setDepth(5);
      this.panda = g;
      this.redrawPanda('happy');
    }

    /** 每穿上一件就重画一次：衣服是画在竹竹身上的，不是贴一张图在旁边 */
    private redrawPanda(mood: PandaMood): void {
      const g = this.panda;
      if (!g) return;
      g.clear();
      drawPanda(g, PANDA_POSE.x, PANDA_POSE.y, PANDA_POSE.scale, {
        mood,
        accessories: this.accessories(),
        blush: true,
      });
      const backpack = this.wornBackpack();
      // 画在身前偏右的小书包：在白色肚皮上看得清，又不会盖住脸与围兜主体
      if (backpack) {
        drawClothing(g, 'backpack', parseHex(backpack), PANDA_POSE.x + 75, PANDA_POSE.y + 45, 1);
      }
    }

    private accessories(): PandaAccessories {
      const accessories: PandaAccessories = {};
      for (const [itemId, slot] of Object.entries(this.state)) {
        // 书包不交给 drawPanda：phaser-kit 把它画在身体后面，
        // 这个体型下会被竹竹的肚子完全挡住 —— 孩子就看不到"背上了"
        if (slot === 'backpack') continue;
        const item = dressItem(level, itemId);
        if (!item) continue;
        accessories[slot] = accessoryIdFor(slot, item.color);
      }
      return accessories;
    }

    /** 已经穿上的书包颜色（没有就返回 undefined） */
    private wornBackpack(): string | undefined {
      for (const [itemId, slot] of Object.entries(this.state)) {
        if (slot !== 'backpack') continue;
        return dressItem(level, itemId)?.color;
      }
      return undefined;
    }

    private drawItems(): void {
      for (const item of level.items) {
        const x = TRAY.x + item.x * TRAY.w;
        const y = TRAY.y + item.y * TRAY.h;
        const node = this.add.container(x, y).setDepth(30);
        const art = this.add.graphics();
        groundShadow(art, 0, 52, 84, 18, 0.12);
        drawClothing(art, item.slot, parseHex(item.color), 0, 0, 1);
        node.add(art);
        this.nodes.set(item.id, node);
        this.homes.set(item.id, { x, y });
        popIn(this, node);

        this.drag?.add({
          obj: node,
          radius: GRAB_RADIUS,
          enabled: () => !this.finished && this.nodes.has(item.id),
          onGrab: () => this.grabItem(item.id, node),
          onDrop: () => this.dropItem(item.id, node),
        });
      }
    }

    // ---------------- 拖拽 ----------------

    private grabItem(itemId: string, node: Phaser.GameObjects.Container): void {
      const item = dressItem(level, itemId);
      if (!item || this.finished) return;
      this.lastActionAt = this.ctx.services.now();
      this.hideHand();
      node.setDepth(90);
      this.tweens.killTweensOf(node);
      this.tweens.add({ targets: node, scale: 1.14, duration: 120, ease: 'Quad.easeOut' });
      // 一拿起来就亮出"这件该去哪"：比任何文字都直观，也保证不会放错得莫名其妙
      this.showSlotHint(item.slot);
    }

    private dropItem(itemId: string, node: Phaser.GameObjects.Container): void {
      if (this.finished) return;
      this.lastActionAt = this.ctx.services.now();
      this.clearSlotHint();

      const item = dressItem(level, itemId);
      const home = this.homes.get(itemId);
      if (!item || !home) return;

      const slot = this.slotAt(node.x, node.y);
      if (slot === item.slot) {
        this.wear(item, node);
        return;
      }

      // 只有"放进别的部位"才算放错；随手放在空地上只是弹回去，不打击孩子
      if (slot !== null) {
        this.noteMistake('dress');
        this.say(ctx.task.retry, 1800);
      }
      node.setDepth(30);
      springBack(this, node, home.x, home.y);
      this.tweens.add({ targets: node, scale: 1, duration: 200 });
    }

    private slotAt(x: number, y: number): ClothingKind | null {
      let best: ClothingKind | null = null;
      let bestDistance = SLOT_RADIUS;
      for (const kind of Object.keys(SLOTS) as ClothingKind[]) {
        const point = SLOTS[kind];
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance <= bestDistance) {
          best = kind;
          bestDistance = distance;
        }
      }
      return best;
    }

    private wear(item: DressItem, node: Phaser.GameObjects.Container): void {
      const result = tryDress(this.state, level, item.id, item.slot);
      if (result.status !== 'correct') return;
      this.state = result.state;

      this.noteCorrect();
      this.sfx('correct');
      this.clearSlotHint();
      const point = SLOTS[item.slot];
      sparkleAt(this, point.x, point.y, THEME.gold, 6);

      this.drag?.remove(node);
      this.nodes.delete(item.id);
      this.tweens.killTweensOf(node);
      this.tweens.add({
        targets: node,
        x: point.x,
        y: point.y,
        scale: 0.2,
        alpha: 0,
        duration: 220,
        ease: 'Quad.easeIn',
        onComplete: () => node.destroy(),
      });

      this.redrawPanda('happy');
      if (dressComplete(this.state, level)) this.complete();
    }

    // ---------------- 槽位发光 ----------------

    private showSlotHint(slot: ClothingKind): void {
      this.clearSlotHint();
      const point = SLOTS[slot];
      const ring = this.add.graphics().setDepth(60);
      ring.setPosition(point.x, point.y);
      ring.lineStyle(9, THEME.gold, 0.95);
      ring.strokeCircle(0, 0, SLOT_RADIUS + 8);
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
    }

    private clearSlotHint(): void {
      if (!this.hintRing) return;
      this.tweens.killTweensOf(this.hintRing);
      this.hintRing.destroy();
      this.hintRing = null;
    }

    // ---------------- 卡住兜底 ----------------

    private checkIdle(): void {
      if (this.finished || this.autoplay) return;
      const now = this.ctx.services.now();
      if (now - this.lastActionAt < 9000) return;
      this.lastActionAt = now;

      const next = level.items.find((item) => this.nodes.has(item.id));
      const home = next ? this.homes.get(next.id) : undefined;
      if (!next || !home) return;

      this.showSlotHint(next.slot);
      if (!this.hand) this.hand = createHand(this, home.x, home.y + 46, 1.15);
      this.showHint(ctx.task.tip, 2600, 300);
      // 提示亮一会儿就收：常亮会变成"照着做"，孩子就不看竹竹了
      this.time.delayedCall(3200, () => this.clearSlotHint());
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
      this.clearSlotHint();
      this.redrawPanda('excited');
      sparkleAt(this, PANDA_POSE.x, PANDA_POSE.y - 120, THEME.gold, 10);
      this.time.delayedCall(this.instant ? 120 : 480, () => this.finishTask({ praise: ctx.task.done }));
    }

    // ---------------- 自动通关 ----------------

    /** 和真实拖拽共用一个落点判定：自动化测到的行为就是孩子玩到的行为 */
    private runAutoplay(): void {
      const travel = this.instant ? 90 : 340;
      const gap = this.instant ? 40 : 200;
      level.items.forEach((item, index) => {
        const node = this.nodes.get(item.id);
        const point = SLOTS[item.slot];
        if (!node) return;
        this.time.delayedCall(160 + index * (travel + gap), () => {
          if (this.finished) return;
          node.setDepth(90);
          this.tweens.add({
            targets: node,
            x: point.x,
            y: point.y,
            duration: travel,
            ease: 'Quad.easeInOut',
            onComplete: () => {
              if (!this.finished) this.dropItem(item.id, node);
            },
          });
        });
      });
    }
  };
}
