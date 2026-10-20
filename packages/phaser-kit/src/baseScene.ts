import Phaser from 'phaser';
import type { GameContext, SfxKey, Stars } from '@bamboo/game-kit';
import { createTranslator } from '@bamboo/i18n';
import type { MessageKey, MessageParams, Translator } from '@bamboo/i18n';
import { createHand, groundShadow, popIn, roundRect, shade, sparkleAt, starPath } from './cartoon';
import { setContainerHitArea } from './hitArea';
import { drawPanda } from './panda';
import { isTapArmed } from './tapGuard';
import { noteCorrect, noteMistake, starsForSession } from './session';
import type { SessionState } from './session';
import { CSS, THEME, textStyle } from './theme';

export interface ButtonOptions {
  width?: number;
  height?: number;
  color?: number;
  textColor?: string;
  fontSize?: number;
  disabled?: boolean;
  wrap?: boolean;
}

export interface CompletionOptions {
  stars?: Stars;
  praise?: string;
  /** 自动通关时，卡片停留多久再回任务页 */
  autoExitMs?: number;
}

/**
 * 所有小游戏的公共底座（同 CHAGS 的 BaseScene）：
 * - 儿童向交互基线：可点区域不小于 88×88 逻辑像素，按钮有厚底与按压反馈；
 * - 完成结算只有一份实现：发 task:complete、显示星星与夸奖、两个出口；
 * - 自动通关（?autoplay=1）与真实操作走同一条逻辑，只是由场景自己模拟输入。
 */
export abstract class BaseScene extends Phaser.Scene {
  protected readonly ctx: GameContext;
  protected readonly session: SessionState;
  private hintPill: Phaser.GameObjects.Container | null = null;
  private translator: Translator | null = null;
  private lastAdvanceAt = Number.NEGATIVE_INFINITY;
  /** 完成结算只做一次（名字避开子场景自己的 finished 守卫，private 同名会撞类型） */
  private completionShown = false;

  protected constructor(key: string, ctx: GameContext) {
    super(key);
    this.ctx = ctx;
    this.session = { mistakes: 0, correct: 0, total: 0, startedAt: ctx.services.now() };
  }

  protected get W(): number {
    return this.ctx.manifest.designSize.width;
  }

  protected get H(): number {
    return this.ctx.manifest.designSize.height;
  }

  protected get autoplay(): boolean {
    return this.ctx.debug?.autoplay === true;
  }

  protected get instant(): boolean {
    return this.ctx.debug?.instant === true;
  }

  protected get reducedMotion(): boolean {
    return this.ctx.reducedMotion;
  }

  /** 顶部一条柔和标题（任务名），声音才是主要引导，文字只是备份 */
  protected drawHeader(label: string): void {
    const g = this.add.graphics().setDepth(20);
    roundRect(g, -40, -30, this.W + 80, 158, 40, THEME.bambooDeep, THEME.outline, 0);
    this.add
      .text(this.W / 2, 62, label, textStyle(46, CSS.paper, true))
      .setOrigin(0.5)
      .setDepth(21);
  }

  protected addButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ): Phaser.GameObjects.Container {
    const w = opts.width ?? 380;
    const h = opts.height ?? 112;
    const color = opts.color ?? THEME.warmRed;
    const container = this.add.container(x, y);

    const lip = this.add.graphics();
    roundRect(lip, -w / 2, -h / 2 + 8, w, h, h / 2, shade(color, 0.72), THEME.outline, 5);
    const face = this.add.graphics();
    roundRect(face, -w / 2, -h / 2, w, h, h / 2, color, THEME.outline, 5);
    const text = this.add
      .text(0, -2, label, {
        ...textStyle(opts.fontSize ?? 42, opts.textColor ?? CSS.card, true),
        align: 'center',
        wordWrap: opts.wrap === false ? undefined : { width: w - 56, useAdvancedWrap: true },
      })
      .setOrigin(0.5);

    container.add([lip, face, text]);
    // 命中区必须是「左上角原点」的整颗按钮，不能传居中矩形：
    // Container 的 displayOrigin 会被命中测试再加一次，居中矩形会让可点区域缩到左上 1/4。
    setContainerHitArea(container, w, h);
    container.on('pointerdown', () => {
      if (opts.disabled) return;
      this.sfx('tap');
      this.tweens.add({ targets: [face, text], y: 8, duration: 60, yoyo: true });
      onClick();
    });
    return container;
  }

  protected addBody(
    x: number,
    y: number,
    content: string,
    size = 38,
    color: string = CSS.ink,
    wrapWidth = this.W - 140,
    bold = false,
  ): Phaser.GameObjects.Text {
    return this.add.text(x, y, content, {
      ...textStyle(size, color, bold),
      align: 'center',
      wordWrap: { width: wrapWidth, useAdvancedWrap: true },
      lineSpacing: 10,
    });
  }

  /** 卡住时才出现的提示气泡（尽量短、带语音） */
  protected showHint(message: string, durationMs = 2600, y = 250): void {
    this.hintPill?.destroy(true);
    const label = this.add
      .text(0, 0, message, {
        ...textStyle(34, CSS.ink, true),
        align: 'center',
        wordWrap: { width: this.W - 190, useAdvancedWrap: true },
      })
      .setOrigin(0.5);
    const w = label.width + 64;
    const h = label.height + 40;
    const bg = this.add.graphics();
    roundRect(bg, -w / 2, -h / 2, w, h, h / 2, THEME.card, THEME.outline, 5);
    const pill = this.add.container(this.W / 2, y, [bg, label]).setDepth(950);
    this.hintPill = pill;
    popIn(this, pill);
    this.time.delayedCall(durationMs, () => {
      if (this.hintPill !== pill) return;
      this.tweens.add({ targets: pill, alpha: 0, duration: 300, onComplete: () => pill.destroy(true) });
    });
  }

  protected createHandAt(x: number, y: number, scale = 1.1): Phaser.GameObjects.Graphics {
    return createHand(this, x, y, scale);
  }

  /** 点哪都行（大点击区 + 连点保护） */
  protected tapAnywhere(onDone: () => void): void {
    const zone = this.add.zone(this.W / 2, this.H / 2, this.W, this.H).setInteractive();
    let done = false;
    zone.on('pointerdown', () => {
      const now = this.ctx.services.now();
      if (!isTapArmed(now, this.lastAdvanceAt)) return;
      if (done) return;
      done = true;
      this.lastAdvanceAt = now;
      this.sfx('tap');
      zone.destroy();
      onDone();
    });
  }

  protected noteCorrect(count = 1): void {
    noteCorrect(this.session, count);
  }

  protected noteMistake(step: string): void {
    noteMistake(this.session);
    this.ctx.emit('task:retry', { taskId: this.ctx.manifest.id, step });
    this.sfx('retry');
  }

  /**
   * 一局的唯一收尾：发 task:complete（外壳据此写存档）、发星星、显示夸奖与两个出口。
   * 所有模板都调它 —— 不会有某个模板忘了发事件或忘了奖励。
   */
  protected finishTask(opts: CompletionOptions = {}): void {
    if (this.completionShown) return;
    this.completionShown = true;
    const stars = opts.stars ?? starsForSession(this.session);
    const durationMs = this.ctx.services.now() - this.session.startedAt;
    this.ctx.emit('task:complete', {
      taskId: this.ctx.manifest.id,
      stars,
      mistakes: this.session.mistakes,
      correct: this.session.correct,
      total: Math.max(this.session.total, 1),
      durationMs,
    });
    this.sfx('complete');
    if (!this.reducedMotion) this.cameras.main.flash(260, 255, 250, 220);
    this.showCompletionOverlay(stars, opts.praise ?? this.ctx.task.done);
    if (this.autoplay) {
      this.time.delayedCall(opts.autoExitMs ?? 450, () => this.exit('complete'));
    }
  }

  private showCompletionOverlay(stars: Stars, praise: string): void {
    const layer = this.add.container(0, 0).setDepth(1000);
    const dim = this.add.graphics();
    dim.fillStyle(THEME.outline, 0.55);
    dim.fillRect(0, 0, this.W, this.H);
    layer.add(dim);

    const cardW = 600;
    const cardH = 720;
    const top = (this.H - cardH) / 2 - 30;
    const card = this.add.graphics();
    roundRect(card, (this.W - cardW) / 2, top, cardW, cardH, 48, THEME.card, THEME.outline, 7);
    roundRect(card, (this.W - cardW) / 2 + 14, top + 14, cardW - 28, cardH - 28, 38, THEME.card, THEME.gold, 4);
    layer.add(card);

    const panda = this.add.graphics();
    drawPanda(panda, this.W / 2, top + 260, 0.62, { mood: 'excited', wave: true, hearts: true });
    layer.add(panda);

    const title = this.add
      .text(this.W / 2, top + 52, this.tr('complete.title'), textStyle(54, CSS.bambooDeep, true))
      .setOrigin(0.5);
    layer.add(title);

    const starsG = this.add.graphics();
    for (let i = 0; i < 3; i += 1) {
      const filled = i < stars;
      starPath(
        starsG,
        this.W / 2 - 100 + i * 100,
        top + 440,
        44,
        20,
        5,
        filled ? THEME.gold : THEME.paperDeep,
        filled ? THEME.goldDeep : THEME.grey,
        4,
      );
    }
    layer.add(starsG);

    const praiseText = this.add
      .text(this.W / 2, top + 500, praise, {
        ...textStyle(36, CSS.ink, true),
        align: 'center',
        wordWrap: { width: cardW - 90, useAdvancedWrap: true },
        lineSpacing: 8,
      })
      .setOrigin(0.5, 0);
    layer.add(praiseText);

    const starLine = this.add
      .text(this.W / 2, top + 610, this.tr('complete.stars', { n: stars }), textStyle(30, CSS.gold, true))
      .setOrigin(0.5);
    layer.add(starLine);

    // 按钮坐标与 @bamboo/templates/layout 的 COMPLETE_LAYOUT 保持一致（e2e 用那份点「收下」）。
    // 两个按钮中心相距 300、自身宽 270：留 30px 间隙，不重叠 ——
    // 重叠时上层按钮会抢走下层按钮右半边的点击（点了「再来一局」却回到任务页）。
    const again = this.addButton(
      this.W / 2 - 150,
      top + cardH + 96,
      this.tr('complete.replay'),
      () => this.exit('replay'),
      { width: 270, height: 108, fontSize: 36, color: THEME.bamboo },
    );
    const accept = this.addButton(
      this.W / 2 + 150,
      top + cardH + 96,
      this.tr('complete.accept'),
      () => this.exit('complete'),
      { width: 270, height: 108, fontSize: 36, color: THEME.warmRed },
    );
    again.setDepth(1100);
    accept.setDepth(1100);
    for (const button of [again, accept]) {
      popIn(this, button, 260);
    }
    popIn(this, layer, 80);
    sparkleAt(this, this.W / 2, top + 440, THEME.gold, 10);
    if (!this.instant) this.speak(praise);
  }

  private exit(reason: 'complete' | 'replay'): void {
    this.ctx.emit('session:exit', { reason, progress: 1 });
    this.ctx.requestExit(reason === 'replay' ? 'replay' : undefined);
  }

  protected sfx(key: SfxKey): void {
    this.ctx.services.audio.play(key);
  }

  protected speak(text: string): void {
    this.ctx.services.audio.speak(text, this.ctx.locale);
  }

  /** 念一句 + 屏幕上给一句同样的短提示（听不见的孩子也能读） */
  protected say(text: string, hintMs = 2600, hintY = 250): void {
    this.speak(text);
    this.showHint(text, hintMs, hintY);
  }

  protected tr(key: MessageKey, params?: MessageParams): string {
    this.translator ??= createTranslator(this.ctx.locale);
    return this.translator(key, params);
  }

  protected fadeIn(): void {
    if (this.reducedMotion) return;
    this.cameras.main.fadeIn(200, 20, 16, 32);
  }

  protected groundShadowAt(cx: number, cy: number, w: number, h: number, alpha = 0.14): void {
    const g = this.add.graphics();
    groundShadow(g, cx, cy, w, h, alpha);
  }

  protected onShutdownCleanup(fn: () => void): void {
    this.events.once('shutdown', fn);
  }
}