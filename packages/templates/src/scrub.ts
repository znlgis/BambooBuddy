import type Phaser from 'phaser';
import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  THEME,
  circle,
  createDragController,
  drawBubbles,
  drawHand,
  drawPanda,
  drawPandaHead,
  drawRoom,
  drawSponge,
  drawToothbrush,
  drawTowel,
  drawTub,
  drawWaterStream,
  popIn,
  roundRect,
  shade,
  sparkleAt,
  springBack,
} from '@bamboo/phaser-kit';
import type { DragController } from '@bamboo/phaser-kit';
import { SCRUB_LAYOUT, SCENE_KEYS } from './layout';
import { allSpotsClean, createScrubState, finishTap, scrubAt } from './scrub.logic';
import type { ScrubLevel, ScrubState } from './scrub.logic';

type Variant = 'brush' | 'wash' | 'bath';
type SpotKind = ScrubLevel['spots'][number]['kind'];

/**
 * 三种刷洗玩法的目标矩形直接取 layout.ts 里的 SCRUB_LAYOUT.stage：
 * e2e 与场景必须用同一份坐标，不然"点到了却没反应"会被当成 bug。
 */
const STAGE = SCRUB_LAYOUT.stage;

/** 点的屏幕半径按目标区短边算：刷牙（260×220）约 19px，够孩子看清，也比命中圈小（判定更宽容） */
const SPOT_RADIUS = Math.min(STAGE.w, STAGE.h) * 0.085;

/** 指针移动超过这么多像素才记一次刷洗：一帧刷十几下会让关卡瞬间通关，也不像"刷" */
const MIN_SCRUB_STEP = 10;

/** 抓工具的半径：孩子手指粗，抓不准也要抓得到 */
const GRAB_RADIUS = 130;

/** 12 秒没有任何有效操作才提示（不打断正在慢慢试的孩子） */
const IDLE_HINT_MS = 12_000;

interface SpotView {
  id: string;
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
}

function pickVariant(level: ScrubLevel): Variant {
  // 关卡脚本只用 tool 区分三种画面：牙刷=牙齿近景，hands=洗手池，海绵/毛巾=浴缸
  if (level.tool === 'brush') return 'brush';
  if (level.tool === 'hands') return 'wash';
  return 'bath';
}

/**
 * 刷洗模板（刷牙 / 洗手 / 洗澡共用一套逻辑，画面由 tool + room 决定）：
 * - 拿工具在目标区来回蹭，每个点蹭够 rubs 次就干净；全程零失败；
 * - 刷干净后出现一个大按钮（冲一冲 / 擦一擦），按够次数完成；
 * - ?autoplay=1 走 attemptScrub / attemptFinish 这两个真实处理函数，不另写跳过逻辑。
 */
export function createScrubScene(ctx: GameContext, level: ScrubLevel): Phaser.Types.Scenes.SceneType {
  return class ScrubScene extends BaseScene {
    private readonly level = level;
    private readonly variant: Variant = pickVariant(level);
    private state!: ScrubState;
    private drag: DragController | null = null;
    private pandaG: Phaser.GameObjects.Graphics | null = null;
    private propG: Phaser.GameObjects.Graphics | null = null;
    private finishButton: Phaser.GameObjects.Container | null = null;
    private spotViews: SpotView[] = [];
    private targetHint: Phaser.GameObjects.Graphics | null = null;
    private guideHand: Phaser.GameObjects.Graphics | null = null;
    private nudgeHand: Phaser.GameObjects.Graphics | null = null;
    private grabbing = false;
    private lastScrubAt: { x: number; y: number } | null = null;
    private lastActionAt = 0;
    private allClean = false;
    private done = false;
    /** autoplay 的墙钟定时器：shutdown 时必须清掉，否则退出后还会往已销毁的场景里塞操作 */
    private autoplayTimers: number[] = [];

    constructor() {
      super(SCENE_KEYS.scrub, ctx);
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.scrub });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });
      this.state = createScrubState(this.level);
      this.lastActionAt = this.ctx.services.now();

      this.drawWorld();
      this.spawnSpots();
      this.spawnTool();
      this.fadeIn();

      this.time.addEvent({ delay: 1000, loop: true, callback: () => this.checkIdle() });

      // 语音只是引导，不阻塞操作；?instant=1（冒烟/截图）时连开场白都跳过
      if (!this.instant) this.speak(this.ctx.task.intro);

      // 开局一只小手搭在工具上：孩子不需要读字就知道要拖它
      if (!this.autoplay) {
        this.guideHand = this.createHandAt(
          SCRUB_LAYOUT.toolHome.x + 46,
          SCRUB_LAYOUT.toolHome.y + 24,
          1.05,
        );
        this.time.delayedCall(4200, () => this.dismissGuide());
      }

      this.onShutdownCleanup(() => {
        for (const timer of this.autoplayTimers) window.clearTimeout(timer);
        this.autoplayTimers.length = 0;
        this.input.off('pointermove', this.handleMove);
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
      drawRoom(room, this.level.room, this.W, this.H);
      this.drawHeader(this.ctx.task.title);

      const back = this.add.graphics().setDepth(1);
      if (this.variant === 'brush') {
        // 洗手间镜子：把大头近景框起来，也解释"为什么脸这么大"
        roundRect(back, 52, 300, 646, 710, 72, THEME.sky, THEME.outline, 8);
        roundRect(back, 74, 322, 602, 666, 60, THEME.skyDeep, null, 0);
      }

      this.pandaG = this.add.graphics().setDepth(3);
      this.refreshPanda();

      this.propG = this.add.graphics().setDepth(6);
      this.drawProps();

      const ambience = this.add.graphics().setDepth(8);
      this.drawAmbience(ambience);
    }

    private drawProps(): void {
      const g = this.propG;
      if (!g) return;
      g.clear();
      if (this.variant === 'wash') {
        this.drawWashBasin(g);
      } else if (this.variant === 'bath') {
        // 浴缸压住下半身：看起来就是"坐在浴缸里"
        drawTub(g, 375, 1000, 540, 240);
      }
    }

    /**
     * 洗手池画在 scrub.ts 内部：公共 props 里的 drawSink 没有柜体、龙头和盆身之间还有缝，
     * 在"竹竹站在池子后面"的构图上会像一块悬在胸口的铁片。这里补成完整的台盆。
     */
    private drawWashBasin(g: Phaser.GameObjects.Graphics): void {
      // 柜体先画，盆体压住它的上沿
      roundRect(g, 238, 1092, 284, 58, 16, THEME.wood, THEME.outline, 5);
      // 龙头先画：立柱下端会被盆沿挡住，看起来才是从盆后面立起来的
      g.fillStyle(THEME.grey, 1);
      g.fillRect(366, 898, 24, 104);
      g.fillRect(366, 898, 118, 24);
      g.fillRect(460, 898, 24, 98);
      g.lineStyle(5, THEME.outline, 1);
      g.strokeRect(366, 898, 24, 104);
      g.strokeRect(366, 898, 118, 24);
      g.strokeRect(460, 898, 24, 98);
      // 盆体与水面：压住龙头下段
      roundRect(g, 230, 958, 300, 146, 26, THEME.white, THEME.outline, 6);
      roundRect(g, 258, 980, 244, 96, 18, THEME.sky, THEME.outline, 4);
      g.fillStyle(THEME.water, 1);
      g.fillEllipse(380, 1026, 208, 56);
      // 出水：从盆沿内侧落进水里
      drawWaterStream(g, 472, 980, 20, 56);
    }

    private drawAmbience(g: Phaser.GameObjects.Graphics): void {
      if (this.variant === 'wash') {
        // 环境泡泡只放在两侧和盆里：目标区（胸口/手）留给可擦掉的泡沫点，
        // 否则孩子分不清"哪些泡泡要搓"。
        drawBubbles(g, 214, 892, 34, 3);
        drawBubbles(g, 546, 906, 32, 3);
        drawBubbles(g, 380, 1012, 66, 5);
      } else if (this.variant === 'bath') {
        drawBubbles(g, 300, 852, 70, 5);
        drawBubbles(g, 470, 878, 60, 4);
        drawBubbles(g, 375, 1008, 120, 7);
      }
    }

    /** 变干净之后换一张脸：刷牙闭嘴、洗澡眼睛眯起来，作为"做到了"的奖励 */
    private refreshPanda(): void {
      const g = this.pandaG;
      if (!g) return;
      g.clear();
      if (this.variant === 'brush') {
        drawPandaHead(g, 375, 665, 1.6, { mouthOpen: !this.allClean, mood: 'happy' });
      } else if (this.variant === 'wash') {
        drawPanda(g, 375, 850, 0.8, { mood: this.allClean ? 'fresh' : 'happy' });
      } else {
        drawPanda(g, 375, 840, 0.78, { mood: this.allClean ? 'fresh' : 'neutral' });
      }
    }

    private spawnSpots(): void {
      for (const spot of this.level.spots) {
        const point = this.spotPoint(spot.x, spot.y);
        const r = SPOT_RADIUS * spot.size;
        const g = this.add.graphics().setDepth(30);
        this.drawSpot(g, spot.kind, r);
        g.setPosition(point.x, point.y);
        this.spotViews.push({ id: spot.id, g, x: point.x, y: point.y });
      }
    }

    /** 内容 JSON 的 0–1 坐标 → 设计坐标（唯一映射点） */
    private spotPoint(x: number, y: number): { x: number; y: number } {
      return { x: STAGE.x + x * STAGE.w, y: STAGE.y + y * STAGE.h };
    }

    private drawSpot(g: Phaser.GameObjects.Graphics, kind: SpotKind, r: number): void {
      if (kind === 'foam') {
        drawBubbles(g, 0, 0, r * 1.5, 5);
        return;
      }
      if (kind === 'dirt') {
        g.fillStyle(shade(THEME.woodDeep, 0.88), 0.85);
        g.fillCircle(-r * 0.34, r * 0.1, r * 0.62);
        g.fillCircle(r * 0.36, -r * 0.16, r * 0.52);
        g.fillCircle(r * 0.04, -r * 0.46, r * 0.38);
        g.fillStyle(shade(THEME.woodDeep, 0.7), 0.8);
        g.fillCircle(-r * 0.1, r * 0.3, r * 0.22);
        return;
      }
      // 细菌：圆身子 + 小刺 + 两只眼睛（纯几何，不依赖图片）
      circle(g, 0, 0, r, 0x9d86bf, THEME.outline, 4);
      g.lineStyle(4, THEME.outline, 1);
      for (let i = 0; i < 5; i += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
        g.lineBetween(
          Math.cos(angle) * r,
          Math.sin(angle) * r,
          Math.cos(angle) * r * 1.42,
          Math.sin(angle) * r * 1.42,
        );
      }
      g.fillStyle(THEME.white, 1);
      g.fillCircle(-r * 0.26, -r * 0.12, r * 0.2);
      g.fillCircle(r * 0.26, -r * 0.12, r * 0.2);
      g.fillStyle(THEME.outline, 1);
      g.fillCircle(-r * 0.22, -r * 0.1, r * 0.09);
      g.fillCircle(r * 0.3, -r * 0.1, r * 0.09);
    }

    // ---------------- 工具与输入 ----------------

    private spawnTool(): void {
      const tool = this.add.container(SCRUB_LAYOUT.toolHome.x, SCRUB_LAYOUT.toolHome.y).setDepth(120);
      const shadow = this.add.graphics();
      shadow.fillStyle(THEME.outline, 0.12);
      shadow.fillEllipse(0, 64, 150, 30);
      const art = this.add.graphics();
      if (this.variant === 'brush') {
        drawToothbrush(art, 0, 0, 1.15);
      } else if (this.variant === 'wash') {
        drawHand(art, -34, -6, 1.05);
        drawHand(art, 34, -6, 1.05);
      } else {
        drawSponge(art, 0, 0, 1.25);
      }
      tool.add([shadow, art]);
      popIn(this, tool, 180);

      // 拖拽控制器本身监听整屏指针；这里只要一个"能抓的东西"
      this.drag = createDragController(this);
      this.drag.add({
        obj: tool,
        radius: GRAB_RADIUS,
        onGrab: (obj) => this.onToolGrab(obj),
        onDrop: (obj) => this.onToolDrop(obj),
      });
      this.input.on('pointermove', this.handleMove);
    }

    /**
     * 按住工具移动时把指针换算成目标区相对坐标。
     * 用指针而不是工具中心：工具是跟着手指走的，孩子看的是"我蹭到哪儿了"。
     */
    private readonly handleMove = (pointer: Phaser.Input.Pointer): void => {
      if (!this.grabbing || this.done) return;
      const last = this.lastScrubAt;
      if (last && Math.hypot(pointer.x - last.x, pointer.y - last.y) < MIN_SCRUB_STEP) return;
      this.lastScrubAt = { x: pointer.x, y: pointer.y };
      this.attemptScrub((pointer.x - STAGE.x) / STAGE.w, (pointer.y - STAGE.y) / STAGE.h);
    };

    private onToolGrab(obj: Phaser.GameObjects.Container): void {
      this.grabbing = true;
      this.lastScrubAt = null;
      this.lastActionAt = this.ctx.services.now();
      this.tweens.killTweensOf(obj);
      obj.setDepth(220);
      this.showTargetHint();
      this.dismissGuide();
    }

    private onToolDrop(obj: Phaser.GameObjects.Container): void {
      this.grabbing = false;
      this.lastScrubAt = null;
      obj.setDepth(120);
      this.hideTargetHint();
      springBack(this, obj, SCRUB_LAYOUT.toolHome.x, SCRUB_LAYOUT.toolHome.y);
    }

    /** 真实操作与 autoplay 共用的"刷一下" */
    private attemptScrub(x: number, y: number): void {
      if (this.done) return;
      this.lastActionAt = this.ctx.services.now();
      const before = this.state;
      const result = scrubAt(before, this.level, x, y);
      if (!result.hitId) return;
      const counted = result.state !== before;
      this.state = result.state;
      const view = this.spotViews.find((item) => item.id === result.hitId);
      if (!view) return;

      if (counted) {
        this.noteCorrect();
        this.sfx('bubble');
        this.bubbleAt(view.x, view.y);
        // 刷一下缩一点，表示"越来越干净"；最后一下直接走淡出，避免两个补间抢 scale
        if (result.cleanedNow.length === 0 && !this.reducedMotion) {
          const left = this.level.rubs - (this.state.cleaned[view.id] ?? 0);
          this.tweens.add({
            targets: view.g,
            scale: 0.62 + (0.38 * left) / this.level.rubs,
            duration: 140,
            ease: 'Quad.easeOut',
          });
        }
      }

      if (result.cleanedNow.length > 0) {
        this.sfx('pop');
        sparkleAt(this, view.x, view.y, THEME.skyDeep, 4);
        this.tweens.add({
          targets: view.g,
          alpha: 0,
          scale: 0.2,
          duration: 300,
          ease: 'Quad.easeOut',
          onComplete: () => view.g.destroy(),
        });
        this.maybeFinish();
      }
    }

    /** 真实操作与 autoplay 共用的"冲/擦一下" */
    private attemptFinish(): void {
      if (this.done) return;
      this.lastActionAt = this.ctx.services.now();
      if (!allSpotsClean(this.state, this.level)) return;
      const result = finishTap(this.state, this.level);
      this.state = result.state;
      this.noteCorrect();
      this.sfx('water');
      this.finishSplash();
      if (result.done) this.complete();
    }

    // ---------------- 完成 ----------------

    private maybeFinish(): void {
      if (this.allClean || !allSpotsClean(this.state, this.level)) return;
      this.allClean = true;
      this.refreshPanda();
      sparkleAt(this, STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, THEME.gold, 8);
      if (!this.reducedMotion) this.cameras.main.flash(180, 255, 250, 220);
      if ((this.level.finish?.taps ?? 0) <= 0) {
        this.complete();
        return;
      }
      this.showFinishButton();
    }

    private showFinishButton(): void {
      if (this.finishButton || this.done) return;
      const kind = this.level.finish?.kind ?? 'rinse';
      const button = this.addButton(
        SCRUB_LAYOUT.finish.x,
        SCRUB_LAYOUT.finish.y,
        kind === 'wipe' ? this.tr('game.wipe') : this.tr('game.rinse'),
        () => this.attemptFinish(),
        {
          width: 420,
          height: 118,
          fontSize: 44,
          color: kind === 'wipe' ? THEME.bamboo : THEME.waterDeep,
        },
      );
      button.setDepth(300);
      this.finishButton = button;
      popIn(this, button, 100);
      if (!this.instant && !this.autoplay) this.say(kind === 'wipe' ? this.tr('game.wipeHint') : this.tr('game.rinseHint'), 2400, 250);
    }

    /** 每按一下冲/擦，目标区上就有一小段水柱或毛巾掠过的反馈 */
    private finishSplash(): void {
      const kind = this.level.finish?.kind ?? 'rinse';
      const cx = STAGE.x + STAGE.w / 2;
      const cy = STAGE.y + STAGE.h / 2;
      const fx = this.add.graphics().setDepth(260).setPosition(cx, cy);
      if (kind === 'wipe') {
        drawTowel(fx, 0, 0, 1.4);
      } else {
        drawWaterStream(fx, 0, -STAGE.h / 2, 70, STAGE.h);
      }
      this.tweens.add({
        targets: fx,
        alpha: 0,
        y: cy + 30,
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => fx.destroy(),
      });
    }

    private complete(): void {
      if (this.done) return;
      this.done = true;
      this.grabbing = false;
      this.hideTargetHint();
      this.hideNudgeHand();
      // 不传 stars：没做错过任何一步，自然就是 3 星
      this.finishTask();
    }

    // ---------------- 提示与小手 ----------------

    private checkIdle(): void {
      if (this.done) return;
      const now = this.ctx.services.now();
      if (now - this.lastActionAt < IDLE_HINT_MS) return;
      this.lastActionAt = now;
      this.showNudgeHand();
      this.say(this.ctx.task.tip, 3200, 250);
    }

    private showNudgeHand(): void {
      this.hideNudgeHand();
      let x = SCRUB_LAYOUT.toolHome.x + 30;
      let y = SCRUB_LAYOUT.toolHome.y - 30;
      if (this.allClean) {
        x = SCRUB_LAYOUT.finish.x;
        y = SCRUB_LAYOUT.finish.y - 80;
      } else if (this.grabbing) {
        x = STAGE.x + STAGE.w / 2;
        y = STAGE.y + STAGE.h / 2;
      }
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

    private showTargetHint(): void {
      this.hideTargetHint();
      const g = this.add.graphics().setDepth(26);
      g.lineStyle(7, THEME.gold, 0.9);
      g.strokeRoundedRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 48);
      this.targetHint = g;
      if (this.reducedMotion) return;
      this.tweens.add({
        targets: g,
        alpha: 0.3,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    private hideTargetHint(): void {
      if (!this.targetHint) return;
      this.tweens.killTweensOf(this.targetHint);
      this.targetHint.destroy();
      this.targetHint = null;
    }

    private bubbleAt(x: number, y: number): void {
      const g = this.add.graphics().setDepth(240).setPosition(x, y);
      g.lineStyle(4, THEME.white, 0.95);
      g.strokeCircle(0, 0, 13);
      g.strokeCircle(17, -9, 8);
      g.strokeCircle(-13, -12, 6);
      this.tweens.add({
        targets: g,
        y: y - 40,
        alpha: 0,
        scale: 1.35,
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => g.destroy(),
      });
    }

    // ---------------- 自动通关（与真实操作共用处理函数） ----------------

    private runAutoplay(): void {
      const steps: (() => void)[] = [];
      for (const spot of this.level.spots) {
        for (let i = 0; i < this.level.rubs; i += 1) {
          steps.push(() => this.attemptScrub(spot.x, spot.y));
        }
      }
      for (let i = 0; i < (this.level.finish?.taps ?? 0); i += 1) {
        steps.push(() => this.attemptFinish());
      }
      // 用墙钟而不是 Phaser 计时器：Phaser 在场景刚启动的 120 帧里会压缩 delta，
      // 低帧率设备（含无头浏览器）上 2 秒的自动演示会被拉成 5 秒，验收会误判超时。
      // 刷牙 12 下 + 冲水 5 下 ≈ 2 秒；洗澡 16 下 + 5 下 ≈ 2.5 秒，正好在 2–4 秒。
      steps.forEach((step, index) => {
        this.autoplayTimers.push(window.setTimeout(step, 150 + index * 110));
      });
    }
  };
}