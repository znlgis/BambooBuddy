import Phaser from 'phaser';
import type { ArcadeContext, SfxKey } from '@bamboo/game-kit';
import { createTranslator } from '@bamboo/i18n';
import type { MessageKey, MessageParams, Translator } from '@bamboo/i18n';
import { CSS, THEME, pandaCheer, popIn, roundRect, shade, starPath, textStyle } from '@bamboo/phaser-kit';

/** 逻辑分辨率与日常玩法一致（750×1334 竖屏），Scale.FIT 负责适配真机 */
export const ARCADE_DESIGN = { width: 750, height: 1334 } as const;

export interface ArcadeButtonOptions {
  width?: number;
  height?: number;
  color?: number;
  textColor?: string;
  fontSize?: number;
  disabled?: boolean;
}

export interface BannerOptions {
  y?: number;
  holdMs?: number;
  color?: number;
  textColor?: string;
  fontSize?: number;
}

/**
 * 三款隐藏小游戏的公共底座（与日常玩法的 BaseScene 同构，但不发 task:complete、不给星星）：
 * - 儿童向交互基线：可点区域不小于 96×96 逻辑像素、按钮有厚底与按压反馈；
 * - 完成结算只有一份实现：发 arcade:complete（外壳据此写存档）、竹竹撒花、一个出口；
 * - 自动通关（?autoplay=1）与真实操作走同一条逻辑，只是由场景自己模拟输入。
 */
export abstract class ArcadeScene extends Phaser.Scene {
  protected readonly ctx: ArcadeContext;
  protected readonly t: Translator;
  private readonly startedAt: number;
  private finished = false;
  private celebrationOpen = false;
  private exited = false;
  /** 同一时刻只留一条表扬条：轮次提示与「这一轮完成啦」不会叠在一起 */
  private banner: Phaser.GameObjects.Container | null = null;

  protected constructor(key: string, ctx: ArcadeContext) {
    super(key);
    this.ctx = ctx;
    this.t = createTranslator(ctx.locale);
    this.startedAt = ctx.services.now();
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

  protected now(): number {
    return this.ctx.services.now();
  }

  protected sfx(key: SfxKey): void {
    this.ctx.services.audio.play(key);
  }

  /** 短句语音引导（静音由平台层统一处理；instant 模式直接跳过，截图不会被声音拖住） */
  protected say(key: MessageKey, params?: MessageParams): void {
    if (this.instant) return;
    void this.ctx.services.audio.speak(this.t(key, params), this.ctx.locale).done;
  }

  /** 居中的一行字（origin 0.5），场景里的文字统一走这里，字号/配色才不会各写一套 */
  protected addText(
    x: number,
    y: number,
    content: string,
    size = 36,
    color: string = CSS.ink,
    bold = false,
  ): Phaser.GameObjects.Text {
    return this.add.text(x, y, content, textStyle(size, color, bold)).setOrigin(0.5);
  }

  /** 顶部柔和标题条（场景里唯一常驻的大字） */
  protected drawHeader(title: string, subtitle?: string): void {
    const g = this.add.graphics().setDepth(20);
    roundRect(g, -40, -40, this.W + 80, 190, 48, THEME.bambooDeep, THEME.outline, 0);
    this.add
      .text(this.W / 2, 52, title, textStyle(44, CSS.paper, true))
      .setOrigin(0.5)
      .setDepth(21);
    if (subtitle !== undefined) {
      this.add
        .text(this.W / 2, 108, subtitle, textStyle(26, '#d9e8c8'))
        .setOrigin(0.5)
        .setDepth(21);
    }
  }

  /** 一枚圆角药丸（HUD 数字、轮次、连消提示都用它） */
  protected addPill(
    x: number,
    y: number,
    text: string,
    opts: { color?: number; textColor?: string; fontSize?: number; depth?: number } = {},
  ): Phaser.GameObjects.Container {
    const label = this.add
      .text(0, 0, text, textStyle(opts.fontSize ?? 34, opts.textColor ?? CSS.ink, true))
      .setOrigin(0.5);
    const w = label.width + 64;
    const h = label.height + 30;
    const bg = this.add.graphics();
    roundRect(bg, -w / 2, -h / 2, w, h, h / 2, opts.color ?? THEME.card, THEME.outline, 5);
    const pill = this.add.container(x, y, [bg, label]).setDepth(opts.depth ?? 20);
    return pill;
  }

  /** 大按钮：厚底 + 按压反馈；可点区域永远不小于 96 逻辑像素 */
  protected addBigButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts: ArcadeButtonOptions = {},
  ): Phaser.GameObjects.Container {
    const w = Math.max(96, opts.width ?? 380);
    const h = Math.max(96, opts.height ?? 112);
    const color = opts.color ?? THEME.warmRed;
    const container = this.add.container(x, y);

    const lip = this.add.graphics();
    roundRect(lip, -w / 2, -h / 2 + 8, w, h, h / 2, shade(color, 0.72), THEME.outline, 5);
    const face = this.add.graphics();
    roundRect(face, -w / 2, -h / 2, w, h, h / 2, color, THEME.outline, 5);
    const text = this.add
      .text(0, -2, label, {
        ...textStyle(opts.fontSize ?? 40, opts.textColor ?? CSS.card, true),
        align: 'center',
        wordWrap: { width: w - 48, useAdvancedWrap: true },
      })
      .setOrigin(0.5);

    container.add([lip, face, text]);
    container.setSize(w, h);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on('pointerdown', () => {
      if (opts.disabled === true) return;
      this.sfx('tap');
      this.tweens.add({ targets: [face, text], y: 8, duration: 60, yoyo: true });
      onClick();
    });
    return container;
  }

  /** 一闪而过的表扬条（连消 / 打完一轮），4 岁孩子不需要读长句 */
  protected showBanner(text: string, opts: BannerOptions = {}): void {
    // 新的一条顶掉旧的：三条游戏都会在轮次切换时连续发两条，叠在一起会挡住 HUD
    this.banner?.destroy(true);
    this.banner = null;
    const c = this.addPill(this.W / 2, opts.y ?? 330, text, {
      color: opts.color ?? THEME.gold,
      textColor: opts.textColor ?? CSS.ink,
      fontSize: opts.fontSize ?? 40,
      depth: 30,
    });
    this.banner = c;
    c.setScale(0.7);
    this.tweens.add({ targets: c, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.time.delayedCall(opts.holdMs ?? 1300, () => {
      if (this.banner === c) this.banner = null;
      this.tweens.add({ targets: c, alpha: 0, duration: 260, onComplete: () => c.destroy(true) });
    });
  }

  /** 新一轮开始：发事件（e2e 可观测）+ 顶部一条轮次提示 */
  protected announceRound(round: number, totalRounds: number): void {
    this.ctx.emit('arcade:round', { gameId: this.ctx.manifest.id, round, totalRounds });
    this.showBanner(this.t('arcade.roundOf', { n: round, total: totalRounds }), { holdMs: 900, y: 330 });
  }

  /**
   * 一局的唯一收尾：发 arcade:complete（外壳写存档）、撒花、显示成绩与唯一出口。
   * 三款游戏都调它 —— 不会有人忘了发事件或忘了写分。
   */
  protected finish(score: number): void {
    if (this.finished) return;
    this.finished = true;
    const safeScore = Math.max(0, Math.floor(score));
    this.ctx.emit('arcade:complete', {
      gameId: this.ctx.manifest.id,
      score: safeScore,
      durationMs: this.now() - this.startedAt,
    });
    this.sfx('complete');
    this.say('arcade.doneVoice');
    this.time.delayedCall(this.instant ? 0 : 420, () => this.showCelebration(safeScore));
  }

  /** 离开这一局（完成卡片上的按钮 / autoplay 自动走） */
  protected leave(): void {
    if (this.exited) return;
    this.exited = true;
    this.ctx.emit('arcade:exit', { reason: 'complete' });
    this.ctx.requestExit();
  }

  private showCelebration(score: number): void {
    if (this.celebrationOpen) return;
    this.celebrationOpen = true;

    const dim = this.add.graphics().setDepth(2000);
    dim.fillStyle(THEME.ink, 0.55);
    dim.fillRect(-40, -40, this.W + 80, this.H + 80);

    const card = this.add.container(this.W / 2, this.H / 2).setDepth(2001);
    const bg = this.add.graphics();
    roundRect(bg, -290, -320, 580, 640, 52, THEME.card, THEME.outline, 6);

    const stars = this.add.graphics();
    pandaCheer(stars, 0, -120, 0.9);
    starPath(stars, -190, -250, 30, 13, 5, THEME.gold, THEME.goldDeep, 3);
    starPath(stars, 190, -250, 30, 13, 5, THEME.gold, THEME.goldDeep, 3);

    const title = this.add
      .text(0, -230, this.t('arcade.done'), textStyle(52, CSS.bamboo, true))
      .setOrigin(0.5);
    const scoreText = this.add
      .text(0, 40, this.t('arcade.doneScore', { n: score }), textStyle(40, CSS.ink, true))
      .setOrigin(0.5);

    const button = this.addBigButton(0, 210, this.t('arcade.doneBack'), () => this.leave(), {
      width: 460,
      height: 120,
      color: THEME.bamboo,
    });

    card.add([bg, stars, title, scoreText, button]);
    popIn(this, card);

    // autoplay 不等人点：给 e2e 一个确定的节拍（真实孩子永远自己按）
    if (this.autoplay) this.time.delayedCall(900, () => this.leave());
  }
}
