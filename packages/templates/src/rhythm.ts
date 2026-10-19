import type { GameContext } from '@bamboo/game-kit';
import {
  BaseScene,
  CSS,
  drawPanda,
  drawRoom,
  roundRect,
  shade,
  sparkleAt,
  textStyle,
  THEME,
} from '@bamboo/phaser-kit';
import { SCENE_KEYS } from './layout';
import {
  createRhythmState,
  cycleMs,
  isInZone,
  nextHitDelay,
  pointerPosition,
  registerTap,
  rhythmComplete,
  zoneRange,
} from './rhythm.logic';
import type { RhythmLevel, RhythmState } from './rhythm.logic';

/** 竹竹站在草地上；脚底落在竹竿高度，跳起来才看得出"越过去" */
const STAGE = { x: 375, y: 936, scale: 0.8 } as const;
/** 底部操作面板：计时条与"跳"按钮放在这上面，和草地分开，视觉更干净 */
const PANEL = { x: 24, y: 1084, w: 702, h: 228 } as const;
/** 计时条（目标窗口标尺）。指针位置完全由墙钟算出，不由帧数累加 */
const BAR = { x: 72, y: 1178, w: 606, h: 48 } as const;
/** 两侧竹竿：张到最开也只有一条窄缝，合拢时几乎碰到一起 */
const CLAPPER = { y: 1032, h: 26, from: 120, to: 630, closedGap: 20, openGap: 110 } as const;

/**
 * 跳竹竿：看准"竹竿打开"的时机点一下。
 *
 * 判定全部交给 rhythm.logic（墙钟三角波），场景只负责三件事：
 * 把指针画出来、把点击原样交给 registerTap、把跳跃演出来。
 * 所以 ?autoplay=1 也只是"在窗口打开时调用同一个 handleTap"。
 */
export function createRhythmScene(ctx: GameContext, level: RhythmLevel): Phaser.Types.Scenes.SceneType {
  return class RhythmScene extends BaseScene {
    private readonly level: RhythmLevel;
    private state: RhythmState = createRhythmState();
    /** 场景开始时刻往前挪四分之一拍：一进场指针就在窗口正中，第一下就能跳 */
    private startAt = 0;
    private stage: Phaser.GameObjects.Graphics | null = null;
    private panda: Phaser.GameObjects.Graphics | null = null;
    private hitsText: Phaser.GameObjects.Text | null = null;
    private comboText: Phaser.GameObjects.Text | null = null;
    /** 自动通关用墙钟 setTimeout 而不是 Phaser Clock：无头 CI 帧率低时 Phaser 会平滑 delta，
     *  Clock 走得比墙钟慢，而判定用的是墙钟 —— 两边不能用同一个时基 */
    private autoTimer: number | null = null;
    private done = false;

    constructor() {
      super(SCENE_KEYS.rhythm, ctx);
      this.level = level;
    }

    create(): void {
      this.ctx.emit('scene:enter', { scene: SCENE_KEYS.rhythm });
      this.ctx.emit('session:start', { at: this.ctx.services.now() });
      this.startAt = this.ctx.services.now() - cycleMs(this.level) / 4;

      this.drawHeader(this.ctx.task.title);
      this.drawBackground();
      this.drawPanel();
      this.stage = this.add.graphics().setDepth(2);
      this.panda = this.add.graphics().setDepth(3);
      drawPanda(this.panda, STAGE.x, STAGE.y, STAGE.scale, { mood: 'happy' });
      this.drawHud();
      this.syncHud();
      this.drawTip(this.ctx.task.tip);
      this.drawStage(pointerPosition(this.ctx.services.now() - this.startAt, this.level));

      this.input.on('pointerdown', this.onPointerDown);
      this.events.on('update', this.onFrame);
      this.onShutdownCleanup(() => {
        this.events.off('update', this.onFrame);
        this.input.off('pointerdown', this.onPointerDown);
        this.clearAuto();
      });

      this.fadeIn();
      // 自动通关是调试/自动化入口：语音只会和计时抢时间，直接跳过
      if (!this.autoplay && !this.instant) this.speak(this.ctx.task.intro);
      if (this.autoplay) {
        // 开局指针就在窗口正中：先把第一下跳掉。
        // 这一下必须在首帧渲染前发生 —— 无头浏览器首帧要编译着色器，等它渲染完，
        // 第一个窗口早就过去了（实测 Phaser 的首个 delayedCall 会晚 260ms）。
        this.handleTap();
        if (!this.done) this.autoTimer = window.setTimeout(() => this.autoStep(), 24);
      }
    }

    // ---------------- 输入：整个舞台都是"跳" ----------------

    private readonly onPointerDown = (): void => {
      this.handleTap();
    };

    private readonly onFrame = (): void => {
      if (this.done) return;
      const elapsed = this.ctx.services.now() - this.startAt;
      this.drawStage(pointerPosition(elapsed, this.level));
    };

    /**
     * 真实点击与自动通关共用这一个入口。
     * 连点由 registerTap 的 220ms 门挡掉；错过不结束、不清连击以外的任何东西。
     */
    private handleTap(): void {
      if (this.done) return;
      const now = this.ctx.services.now();
      const elapsed = now - this.startAt;
      const tap = registerTap(this.state, elapsed, this.level, now);
      if (tap.ignored) return;
      this.state = tap.state;

      if (!tap.hit) {
        // 柔和的重试音（noteMistake 内部会放 retry），不抖动、不停指针、不扣进度
        this.noteMistake('rhythm');
        this.syncHud();
        return;
      }

      this.noteCorrect();
      this.ctx.services.audio.tone(tap.tone, 140);
      this.sfx('jump');
      this.jump();
      sparkleAt(this, STAGE.x, STAGE.y - 150, THEME.gold, 5);
      this.syncHud();
      if (rhythmComplete(this.state, this.level)) this.finish();
    }

    // ---------------- 自动通关 ----------------

    private autoStep(): void {
      if (this.done) return;
      const elapsed = this.ctx.services.now() - this.startAt;
      if (isInZone(elapsed, this.level)) {
        // 在窗口里就点；接着继续每 24ms 看一眼。
        // 同一个窗口内的重复点会被 registerTap 的 220ms 连点门忽略，不会多算。
        this.handleTap();
        if (!this.done) this.autoTimer = window.setTimeout(() => this.autoStep(), 24);
        return;
      }

      // 不在窗口里：睡到下一个窗口打开。
      // nextHitDelay 只朝下一个"上升沿中心"看，会漏掉一个来回里的另一半窗口，
      // 所以再和 nextCenterDelay 取更近的；醒来后用轮询吸收定时器与主线程的延迟。
      const toCenter = this.nextCenterDelay(elapsed);
      const toRisingCenter = nextHitDelay(elapsed, this.level);
      const halfWindow = (this.level.zone / 2) * (cycleMs(this.level) / 2);
      const sleep = Math.min(toCenter, toRisingCenter) - halfWindow;
      this.autoTimer = window.setTimeout(() => this.autoStep(), Math.max(16, sleep));
    }

    private nextCenterDelay(elapsed: number): number {
      const cycle = cycleMs(this.level);
      const phase = ((elapsed % cycle) + cycle) % cycle;
      const center =
        phase < cycle / 4
          ? cycle / 4
          : phase < (3 * cycle) / 4
            ? (3 * cycle) / 4
            : cycle + cycle / 4;
      return center - phase;
    }

    private clearAuto(): void {
      if (this.autoTimer !== null) {
        window.clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
    }

    // ---------------- 结算 ----------------

    private finish(): void {
      if (this.done) return;
      this.done = true;
      this.clearAuto();
      this.syncHud();
      // 调试模式不拖尾：QA 的预算是 6 秒内完成
      if (this.autoplay || this.instant) {
        this.finishTask({ praise: this.ctx.task.done });
        return;
      }
      this.time.delayedCall(220, () => this.finishTask({ praise: this.ctx.task.done }));
    }

    // ---------------- 绘制（静态部分只画一次） ----------------

    private drawBackground(): void {
      const bg = this.add.graphics().setDepth(0);
      drawRoom(bg, 'yard', this.W, this.H);
    }

    private drawPanel(): void {
      const panel = this.add.graphics().setDepth(1);
      roundRect(panel, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 34, THEME.card, THEME.outline, 6);
      roundRect(panel, PANEL.x + 12, PANEL.y + 12, PANEL.w - 24, PANEL.h - 24, 26, THEME.paper, null, 0);
    }

    private drawHud(): void {
      this.hitsText = this.add
        .text(PANEL.x + 48, 1112, '', textStyle(32, CSS.ink, true))
        .setOrigin(0, 0.5)
        .setDepth(5);
      this.comboText = this.add
        .text(PANEL.x + PANEL.w - 48, 1112, '', textStyle(32, CSS.gold, true))
        .setOrigin(1, 0.5)
        .setDepth(5);

      // 大按钮只是视觉引导：整个舞台都能点，"跳"按钮自然也在可点区域里
      const btnX = this.W / 2 - 130;
      const btnY = 1208;
      const btn = this.add.graphics().setDepth(4);
      roundRect(btn, btnX, btnY + 8, 260, 96, 48, shade(THEME.warmRed, 0.72), THEME.outline, 4);
      roundRect(btn, btnX, btnY, 260, 96, 48, THEME.warmRed, THEME.outline, 5);
      this.add
        .text(this.W / 2, btnY + 48, this.tr('game.jump'), textStyle(44, CSS.card, true))
        .setOrigin(0.5)
        .setDepth(5);
    }

    private drawTip(text: string): void {
      const label = this.add
        .text(this.W / 2, 208, text, textStyle(30, CSS.ink, true))
        .setOrigin(0.5)
        .setDepth(6);
      const w = Math.max(220, label.width + 56);
      const pill = this.add.graphics().setDepth(5);
      roundRect(pill, this.W / 2 - w / 2, 179, w, 58, 29, THEME.card, THEME.outline, 4);
    }

    private syncHud(): void {
      this.hitsText?.setText(this.tr('game.jumps', { n: this.state.hits, total: this.level.jumps }));
      this.comboText?.setText(this.state.streak >= 2 ? this.tr('game.combo', { n: this.state.streak }) : '');
    }

    private jump(): void {
      const panda = this.panda;
      if (!panda) return;
      this.tweens.killTweensOf(panda);
      panda.y = 0;
      // 减少动态偏好不是"完全不动的理由"：跳跃是核心反馈，这里只把它缩小
      const lift = this.reducedMotion ? 24 : 82;
      this.tweens.add({
        targets: panda,
        y: -lift,
        duration: this.reducedMotion ? 120 : 180,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }

    /** 每帧重画：竹竿开合 + 高亮窗口 + 指针（全部由 pos 决定，无随机） */
    private drawStage(pos: number): void {
      const g = this.stage;
      if (!g) return;
      g.clear();

      // 指针到中心 = 窗口正中 = 竹竿张到最开
      const open = 1 - Math.abs(pos - 0.5) * 2;
      const halfGap = CLAPPER.closedGap + open * CLAPPER.openGap;
      const leftW = STAGE.x - halfGap - CLAPPER.from;
      const rightW = CLAPPER.to - (STAGE.x + halfGap);
      roundRect(g, CLAPPER.from, CLAPPER.y - CLAPPER.h / 2, leftW, CLAPPER.h, CLAPPER.h / 2, THEME.bamboo, THEME.outline, 4);
      roundRect(g, STAGE.x + halfGap, CLAPPER.y - CLAPPER.h / 2, rightW, CLAPPER.h, CLAPPER.h / 2, THEME.bamboo, THEME.outline, 4);
      g.lineStyle(3, THEME.bambooDeep, 0.75);
      for (let x = CLAPPER.from + 46; x < STAGE.x - halfGap - 16; x += 52) {
        g.lineBetween(x, CLAPPER.y - CLAPPER.h / 2 + 3, x, CLAPPER.y + CLAPPER.h / 2 - 3);
      }
      for (let x = STAGE.x + halfGap + 46; x < CLAPPER.to - 16; x += 52) {
        g.lineBetween(x, CLAPPER.y - CLAPPER.h / 2 + 3, x, CLAPPER.y + CLAPPER.h / 2 - 3);
      }

      // 计时条：底色 → 目标窗口 → 指针
      const range = zoneRange(this.level);
      roundRect(g, BAR.x, BAR.y - BAR.h / 2, BAR.w, BAR.h, BAR.h / 2, THEME.paperDeep, THEME.outline, 4);
      const zoneX = BAR.x + range.from * BAR.w;
      const zoneW = (range.to - range.from) * BAR.w;
      roundRect(g, zoneX, BAR.y - BAR.h / 2, zoneW, BAR.h, BAR.h / 2, THEME.gold, null, 0, 0.9);
      g.lineStyle(4, THEME.goldDeep, 0.9);
      g.strokeRoundedRect(zoneX, BAR.y - BAR.h / 2, zoneW, BAR.h, BAR.h / 2);
      const px = BAR.x + pos * BAR.w;
      roundRect(g, px - 9, BAR.y - BAR.h / 2 - 12, 18, BAR.h + 24, 9, THEME.warmRed, THEME.outline, 4);
    }
  };
}