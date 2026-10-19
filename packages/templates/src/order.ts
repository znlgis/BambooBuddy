import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  CSS,
  THEME,
  drawBed,
  drawCurtain,
  drawLamp,
  drawOrderIcon,
  drawPanda,
  drawRoom,
  popIn,
  roundRect,
  sparkleAt,
  textStyle,
} from '@bamboo/phaser-kit';
import type { PandaMood } from '@bamboo/phaser-kit';
import { createOrderState, tapStep } from './order.logic';
import type { OrderLevel } from './order.logic';
import { ORDER_LAYOUT, SCENE_KEYS } from './layout';

/**
 * 睡前顺序：按顺序把四件事做完（拉窗帘 → 关灯 → 盖被子 → 拍拍睡）。
 *
 * 两道刻意的设计：
 * - **点错不清进度**：顺序错了只把刚点的那个晃一晃，已经做完的事仍然亮着；
 * - **不惩罚**：没有倒计时、没有扣分，只有一句"再试一次"。
 */

/** 点按判定半径：任务约定 ≥120；小朋友点不准也能点中 */
const TAP_RADIUS = 130;

/** 竹竹站位：站在床后面，床沿挡住脚，看起来是靠着床 */
const PANDA_POSE = { x: 350, y: 830, scale: 0.95 } as const;

/** 床：被子槽位（375,1040）就落在这张床上 */
const BED = { x: 140, y: 940, w: 470, h: 180 } as const;

/** 顶部进度点 */
const DOTS_Y = 168;
const DOTS_GAP = 64;

/** 当前步骤提示（只用内容里本来就有的短标签，不另写文案） */
const STEP_LABEL_Y = 226;

type OrderStep = OrderLevel['steps'][number];

interface OrderProp {
  node: Phaser.GameObjects.Container;
  art: Phaser.GameObjects.Graphics;
  step: OrderStep;
  point: { x: number; y: number };
}

export function createOrderScene(ctx: GameContext, level: OrderLevel): Phaser.Types.Scenes.SceneType {
  return class OrderScene extends BaseScene {
    private state = createOrderState();
    private panda: Phaser.GameObjects.Graphics | null = null;
    private dim: Phaser.GameObjects.Graphics | null = null;
    private progress: Phaser.GameObjects.Graphics | null = null;
    private stepLabel: Phaser.GameObjects.Text | null = null;
    private stepPill: Phaser.GameObjects.Graphics | null = null;
    private hintRing: Phaser.GameObjects.Graphics | null = null;
    private props = new Map<string, OrderProp>();
    private finished = false;
    /** 上一次真的动过的时间：卡住 9 秒就把当前步骤亮出来 */
    private lastActionAt = 0;

    constructor() {
      super(SCENE_KEYS.order, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.order });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });

      const room = this.add.graphics().setDepth(0);
      drawRoom(room, level.room, this.W, this.H);
      this.drawFurniture();
      this.drawPandaBody();
      this.drawDim();
      this.drawProps();
      this.drawHeader(ctx.task.title);
      this.drawProgressBar();
      // 英文的步骤名更长（Next: Turn off light），底下一张药丸卡保证它在任何墙面上都读得清
      this.stepPill = this.add.graphics().setDepth(21);
      this.stepLabel = this.add
        .text(this.W / 2, STEP_LABEL_Y, '', textStyle(30, CSS.inkSoft, true))
        .setOrigin(0.5)
        .setDepth(22);
      this.updateStepLabel();
      this.fadeIn();

      const onDown = (pointer: Phaser.Input.Pointer): void => this.pointerDown(pointer);
      this.input.on('pointerdown', onDown);
      this.onShutdownCleanup(() => {
        this.input.off('pointerdown', onDown);
        this.clearHintRing();
      });

      this.lastActionAt = this.ctx.services.now();
      if (!this.instant) this.speak(ctx.task.intro);
      this.time.addEvent({ delay: 1200, loop: true, callback: () => this.checkIdle() });

      if (this.autoplay) this.runAutoplay();
    }

    // ---------------- 布景 ----------------

    private drawFurniture(): void {
      const g = this.add.graphics().setDepth(2);
      // 床头柜：让落地灯有立足点，而不是浮在半空
      roundRect(g, 540, 620, 140, 22, 10, THEME.wood, THEME.outline, 4);
      g.fillStyle(THEME.woodDeep, 1);
      g.fillRect(556, 642, 18, 74);
      g.fillRect(646, 642, 18, 74);

      // 床画在竹竹之后（depth 4）：床沿挡住脚，看上去是"站在床边"
      const bed = this.add.graphics().setDepth(4);
      drawBed(bed, BED.x, BED.y, BED.w, BED.h);
    }

    private drawPandaBody(): void {
      const g = this.add.graphics().setDepth(3);
      this.panda = g;
      this.redrawPanda('sleepy');
    }

    private redrawPanda(mood: PandaMood): void {
      const g = this.panda;
      if (!g) return;
      g.clear();
      drawPanda(g, PANDA_POSE.x, PANDA_POSE.y, PANDA_POSE.scale, { mood, blush: true });
    }

    /** 关灯后才出现的暗色层：只压暗房间（竹竹和床），道具留在上面保持可点 */
    private drawDim(): void {
      const g = this.add.graphics().setDepth(5).setAlpha(0);
      g.fillStyle(0x262640, 1);
      g.fillRect(0, 0, this.W, this.H);
      this.dim = g;
    }

    private drawProps(): void {
      for (const step of level.steps) {
        const point = this.layoutFor(step);
        const node = this.add.container(point.x, point.y).setDepth(10);
        const art = this.add.graphics();
        this.drawPropArt(art, step);
        node.add(art);
        this.props.set(step.id, { node, art, step, point });
        popIn(this, node);
      }
    }

    private drawPropArt(art: Phaser.GameObjects.Graphics, step: OrderStep): void {
      if (step.icon === 'curtain') {
        // drawOrderIcon 的窗帘只有"已经拉上"这一种画法；这一关需要开/合两态，
        // 所以自己画：夜里的小窗 + 拉到两边的帘布，点一下再合上（合上的画放进动画里）
        this.drawOpenCurtain(art);
        return;
      }
      // 被子 1.1 倍刚好铺满床；再大，道具自带的枕头就会掉到床外
      drawOrderIcon(art, step.icon, 0, 0, step.icon === 'blanket' ? 1.1 : 1, true);
    }

    /** 窗帘的"拉开"状态：帘布分到两边，中间露出夜空 */
    private drawOpenCurtain(g: Phaser.GameObjects.Graphics): void {
      roundRect(g, -70, -60, 140, 150, 10, 0x4b5a78, THEME.outline, 5);
      g.lineStyle(5, THEME.wood, 1);
      g.lineBetween(0, -60, 0, 90);
      g.lineBetween(-70, 15, 70, 15);
      // 窗外的小月亮与星星（几何绘制，不引外部图片）
      g.fillStyle(THEME.sun, 1);
      g.fillCircle(24, -20, 15);
      g.fillStyle(0x4b5a78, 1);
      g.fillCircle(31, -26, 12);
      g.fillStyle(THEME.gold, 1);
      g.fillCircle(-38, -30, 4);
      g.fillCircle(-52, 44, 3);
      g.fillCircle(38, 60, 4);
      // 窗帘杆与两侧帘布（与 drawCurtain 的杆位置对齐，合上时不会跳）
      g.lineStyle(8, THEME.woodDeep, 1);
      g.lineBetween(-85, -60, 85, -60);
      for (const side of [-1, 1] as const) {
        const x = side < 0 ? -85 : 55;
        g.fillStyle(THEME.blush, 1);
        g.fillRect(x, -60, 30, 150);
        g.lineStyle(4, THEME.pink, 1);
        g.strokeRect(x, -60, 30, 150);
      }
    }

    private layoutFor(step: OrderStep): { x: number; y: number } {
      // 按图标找位置（同一个图标在别的关卡里也落在同一处），找不到再退回屏幕中上方
      const found =
        ORDER_LAYOUT.steps.find((point) => point.id === step.icon) ??
        ORDER_LAYOUT.steps.find((point) => point.id === step.id);
      return found ? { x: found.x, y: found.y } : { x: this.W / 2, y: 640 };
    }

    // ---------------- 进度与提示 ----------------

    private drawProgressBar(): void {
      this.progress = this.add.graphics().setDepth(22);
      this.redrawProgress();
    }

    private redrawProgress(): void {
      const g = this.progress;
      if (!g) return;
      g.clear();
      const total = level.steps.length;
      const startX = this.W / 2 - ((total - 1) * DOTS_GAP) / 2;
      for (let i = 0; i < total; i += 1) {
        const done = i < this.state.completed.length;
        // 已完成 = 实心，未完成 = 空心：不靠颜色单独传达信息
        g.fillStyle(done ? THEME.gold : THEME.card, 1);
        g.fillCircle(startX + i * DOTS_GAP, DOTS_Y, 13);
        g.lineStyle(4, THEME.outline, 1);
        g.strokeCircle(startX + i * DOTS_GAP, DOTS_Y, 13);
      }
    }

    private updateStepLabel(): void {
      if (!this.stepLabel) return;
      const step = level.steps[this.state.next];
      const text = step ? this.tr('game.nextStep') + step.label : '';
      this.stepLabel.setText(text);
      this.stepPill?.clear();
      if (text.length > 0 && this.stepPill) {
        const w = this.stepLabel.width + 64;
        roundRect(this.stepPill, this.W / 2 - w / 2, STEP_LABEL_Y - 30, w, 60, 30, THEME.card, THEME.outline, 4);
      }
    }

    // ---------------- 输入 ----------------

    private pointerDown(pointer: Phaser.Input.Pointer): void {
      if (this.finished) return;
      let nearest: string | null = null;
      let bestDistance = TAP_RADIUS;
      for (const [id, prop] of this.props) {
        const distance = Math.hypot(pointer.x - prop.point.x, pointer.y - prop.point.y);
        if (distance <= bestDistance) {
          nearest = id;
          bestDistance = distance;
        }
      }
      if (nearest) this.handleTap(nearest);
    }

    private handleTap(stepId: string): void {
      if (this.finished) return;
      const prop = this.props.get(stepId);
      if (!prop) return;
      this.lastActionAt = this.ctx.services.now();
      this.clearHintRing();

      // 已经做完的步骤：轻轻晃一下就好 —— 既不算错，也不清掉进度
      if (this.state.completed.includes(stepId)) {
        this.pulse(prop.node);
        return;
      }

      const result = tapStep(this.state, level, stepId);
      if (result.status === 'wrong') {
        this.noteMistake('order');
        this.say(ctx.task.retry, 1800);
        this.shake(prop.node);
        return;
      }

      this.state = result.state;
      this.noteCorrect();
      this.markDone(prop);
      this.redrawProgress();
      this.updateStepLabel();
      const duration = this.animateStep(prop);
      if (result.status === 'complete') {
        // 等最后一步的小动画播完再闭眼，不然孩子看不到"拍拍睡"做了什么
        this.time.delayedCall(duration + 140, () => this.sleep());
      }
    }

    // ---------------- 反馈动画 ----------------

    private animateStep(prop: OrderProp): number {
      const icon = prop.step.icon;
      if (icon === 'curtain') {
        this.sfx('tap');
        const closed = this.add.graphics();
        drawCurtain(closed, 0, -60, 130, 150, false);
        prop.node.add(closed);
        closed.setScale(0.06, 1);
        closed.setAlpha(0);
        this.tweens.add({
          targets: closed,
          scaleX: 1,
          alpha: 1,
          duration: 420,
          ease: 'Quad.easeOut',
          onComplete: () => prop.art.setVisible(false),
        });
        return 420;
      }
      if (icon === 'lamp') {
        this.sfx('tap');
        prop.art.clear();
        drawLamp(prop.art, 0, 40, 1, false);
        if (this.dim) this.tweens.add({ targets: this.dim, alpha: 0.42, duration: 500 });
        sparkleAt(this, prop.point.x, prop.point.y - 150, THEME.sun, 4);
        return 500;
      }
      if (icon === 'blanket') {
        this.sfx('pop');
        this.tweens.add({
          targets: prop.node,
          x: 375,
          y: 910,
          scale: 1.25,
          duration: 450,
          ease: 'Quad.easeOut',
        });
        sparkleAt(this, 375, 910, THEME.gold, 5);
        return 450;
      }
      if (icon === 'pat') {
        this.sfx('tap');
        const targetX = 450;
        const targetY = 900;
        this.tweens.add({
          targets: prop.node,
          x: targetX,
          y: targetY,
          duration: 200,
          ease: 'Quad.easeOut',
          onComplete: () => {
            // 轻拍两下：上下两次，手停在被子边
            this.tweens.add({
              targets: prop.node,
              y: targetY + 22,
              duration: 120,
              yoyo: true,
              repeat: 1,
              ease: 'Sine.easeInOut',
            });
            sparkleAt(this, targetX, targetY, THEME.pink, 4);
          },
        });
        return 560;
      }
      // clock / moon / teddy：等级脚本换成这些图标时也能跑
      this.sfx('pop');
      this.tweens.add({ targets: prop.node, scale: 1.18, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
      sparkleAt(this, prop.point.x, prop.point.y, THEME.gold, 4);
      return 320;
    }

    private markDone(prop: OrderProp): void {
      const g = this.add.graphics().setDepth(14);
      g.setPosition(prop.point.x + 78, prop.point.y - 78);
      g.fillStyle(THEME.gold, 1);
      g.fillCircle(0, 0, 19);
      g.lineStyle(5, THEME.outline, 1);
      g.beginPath();
      g.moveTo(-8, 0);
      g.lineTo(-2, 8);
      g.lineTo(10, -8);
      g.strokePath();
    }

    private shake(node: Phaser.GameObjects.Container): void {
      this.tweens.killTweensOf(node);
      const baseX = node.x;
      this.tweens.add({
        targets: node,
        x: baseX + 10,
        duration: 55,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => node.setX(baseX),
      });
    }

    private pulse(node: Phaser.GameObjects.Container): void {
      this.tweens.killTweensOf(node);
      this.tweens.add({ targets: node, scale: 1.12, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
    }

    // ---------------- 卡住兜底 ----------------

    private checkIdle(): void {
      if (this.finished || this.autoplay) return;
      const now = this.ctx.services.now();
      if (now - this.lastActionAt < 9000) return;
      this.lastActionAt = now;
      const step = level.steps[this.state.next];
      const prop = step ? this.props.get(step.id) : undefined;
      if (!prop) return;
      this.showHintRing(prop.point.x, prop.point.y);
      this.showHint(ctx.task.tip, 2600, STEP_LABEL_Y + 70);
      this.speak(prop.step.label);
      this.time.delayedCall(3200, () => this.clearHintRing());
    }

    private showHintRing(x: number, y: number): void {
      this.clearHintRing();
      const ring = this.add.graphics().setDepth(40);
      ring.setPosition(x, y);
      ring.lineStyle(9, THEME.gold, 0.95);
      ring.strokeCircle(0, 0, TAP_RADIUS + 6);
      this.hintRing = ring;
      this.tweens.add({
        targets: ring,
        scale: 1.14,
        alpha: 0.4,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    private clearHintRing(): void {
      if (!this.hintRing) return;
      this.tweens.killTweensOf(this.hintRing);
      this.hintRing.destroy();
      this.hintRing = null;
    }

    // ---------------- 收尾 ----------------

    private sleep(): void {
      if (this.finished) return;
      this.finished = true;
      this.clearHintRing();
      this.stepLabel?.setText('');
      this.stepPill?.clear();
      this.redrawPanda('sleepy');
      this.sfx('sleep');
      // 三个慢慢飘起来的 Z：不用写字也知道睡着了
      for (let i = 0; i < 3; i += 1) {
        const z = this.add
          .text(PANDA_POSE.x + 70 + i * 34, PANDA_POSE.y - 250 - i * 26, 'Z', textStyle(30 + i * 10, CSS.inkSoft, true))
          .setOrigin(0.5)
          .setDepth(16)
          .setAlpha(0.9);
        this.tweens.add({
          targets: z,
          y: z.y - 80,
          alpha: 0,
          duration: 1800,
          delay: i * 240,
          repeat: -1,
          ease: 'Sine.easeOut',
        });
      }
      this.time.delayedCall(this.instant ? 160 : 380, () => this.finishTask({ praise: ctx.task.done }));
    }

    // ---------------- 自动通关 ----------------

    /** 和真实点击走同一个 handleTap：自动化验证的就是孩子点到的路径 */
    private runAutoplay(): void {
      const gap = this.instant ? 140 : 180;
      level.steps.forEach((step, index) => {
        this.time.delayedCall(160 + index * gap, () => {
          if (!this.finished) this.handleTap(step.id);
        });
      });
    }
  };
}