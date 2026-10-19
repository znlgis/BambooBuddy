import type Phaser from 'phaser';
import { circle, ellipse, heartPath, roundRect, shade, starPath } from './cartoon';
import { THEME } from './theme';

export type PandaMood =
  | 'happy'
  | 'neutral'
  | 'sleepy'
  | 'hungry'
  | 'dirty'
  | 'fresh'
  | 'sad'
  | 'angry'
  | 'excited';

/** 与 @bamboo/progress 的装扮 id 对齐；颜色表在这里，是为了渲染层不依赖存档层 */
export interface PandaAccessories {
  hat?: string;
  bib?: string;
  outfit?: string;
  backpack?: string;
  shoes?: string;
}

export interface PandaOptions {
  mood?: PandaMood;
  accessories?: PandaAccessories;
  blush?: boolean;
  /** 一只手举起来挥（打招呼 / 击掌） */
  wave?: boolean;
  /** 头顶冒小爱心（抱抱之后） */
  hearts?: boolean;
}

const WHITE = THEME.pandaWhite;
const BLACK = THEME.pandaBlack;

function accessoryColor(id: string | undefined, fallback: number): number {
  if (!id) return fallback;
  if (id.startsWith('hat-bamboo') || id.startsWith('bib-bamboo') || id.startsWith('backpack-leaf')) return THEME.bamboo;
  if (id.startsWith('hat-straw')) return THEME.sun;
  if (id.startsWith('hat-crown')) return THEME.gold;
  if (id.startsWith('bib-star')) return THEME.sun;
  if (id.startsWith('bib-flower')) return THEME.pink;
  if (id.startsWith('outfit-pjs')) return THEME.lavender;
  if (id.startsWith('outfit-rain')) return THEME.gold;
  if (id.startsWith('backpack-red') || id.startsWith('shoes-red')) return THEME.warmRed;
  if (id.startsWith('shoes-green')) return THEME.bamboo;
  return fallback;
}

function drawEyes(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, mood: PandaMood): void {
  const closed = mood === 'sleepy' || mood === 'fresh';
  for (const side of [-1, 1] as const) {
    const ex = x + side * 48 * s;
    const ey = y - 146 * s;
    if (closed) {
      g.lineStyle(7 * s, BLACK, 1);
      g.beginPath();
      g.arc(ex, ey, 18 * s, Math.PI * 1.15, Math.PI * 1.85);
      g.strokePath();
    } else {
      circle(g, ex, ey, 19 * s, WHITE, null, 0);
      const look = mood === 'angry' ? side * 1.5 : mood === 'sad' ? -side * 3 : 0;
      circle(g, ex + look * s, ey + 2 * s, 10 * s, BLACK, null, 0);
      circle(g, ex + look * s + 4 * s, ey - 3 * s, 3.4 * s, WHITE, null, 0);
    }
  }
}

function drawMouth(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s: number,
  mood: PandaMood,
): void {
  const my = y - 72 * s;
  g.lineStyle(6 * s, BLACK, 1);
  if (mood === 'happy' || mood === 'excited' || mood === 'fresh') {
    g.beginPath();
    g.arc(x, my, 26 * s, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
    if (mood === 'excited') {
      g.fillStyle(THEME.warmRed, 1);
      g.fillEllipse(x, my + 12 * s, 30 * s, 22 * s);
      g.lineStyle(4 * s, BLACK, 1);
      g.strokeEllipse(x, my + 12 * s, 30 * s, 22 * s);
    }
  } else if (mood === 'sad') {
    g.beginPath();
    g.arc(x, my + 26 * s, 24 * s, Math.PI * 1.2, Math.PI * 1.8);
    g.strokePath();
  } else if (mood === 'angry') {
    g.beginPath();
    g.moveTo(x - 20 * s, my + 8 * s);
    g.lineTo(x + 20 * s, my + 8 * s);
    g.strokePath();
  } else if (mood === 'hungry') {
    g.fillStyle(THEME.warmRedDeep, 1);
    g.fillEllipse(x, my + 8 * s, 34 * s, 28 * s);
    g.lineStyle(4 * s, BLACK, 1);
    g.strokeEllipse(x, my + 8 * s, 34 * s, 28 * s);
  } else {
    g.beginPath();
    g.moveTo(x - 16 * s, my);
    g.lineTo(x + 16 * s, my);
    g.strokePath();
  }
}

function drawHead(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s: number,
  mood: PandaMood,
  blush: boolean,
): void {
  // 耳朵在头后面，先画
  for (const side of [-1, 1] as const) {
    circle(g, x + side * 98 * s, y - 226 * s, 48 * s, BLACK);
    circle(g, x + side * 98 * s, y - 226 * s, 22 * s, shade(BLACK, 1.5), null, 0);
  }
  circle(g, x, y - 128 * s, 132 * s, WHITE);
  // 眼周黑斑
  for (const side of [-1, 1] as const) {
    g.fillStyle(BLACK, 1);
    g.fillEllipse(x + side * 48 * s, y - 143 * s, 66 * s, 88 * s);
  }
  drawEyes(g, x, y, s, mood);
  // 鼻子 + 嘴
  g.fillStyle(BLACK, 1);
  g.fillEllipse(x, y - 101 * s, 34 * s, 25 * s);
  g.lineStyle(5 * s, BLACK, 1);
  g.beginPath();
  g.moveTo(x, y - 88 * s);
  g.lineTo(x, y - 78 * s);
  g.strokePath();
  drawMouth(g, x, y, s, mood);
  if (blush) {
    for (const side of [-1, 1] as const) {
      g.fillStyle(THEME.blush, 0.75);
      g.fillEllipse(x + side * 92 * s, y - 96 * s, 40 * s, 26 * s);
    }
  }
  if (mood === 'sad') {
    g.fillStyle(THEME.water, 1);
    g.fillEllipse(x - 54 * s, y - 122 * s, 14 * s, 22 * s);
  }
}

/**
 * 竹竹本体：圆脸、短手短脚、背小书包、围兜可换。
 * 原点取身体中心，正上方是头 —— 模板按"脚踩地面"的位置换算即可。
 */
export function drawPanda(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  opts: PandaOptions = {},
): void {
  const mood = opts.mood ?? 'happy';
  const accessories = opts.accessories ?? {};
  const blush = opts.blush ?? true;

  // 影子
  g.fillStyle(THEME.shadow, 0.13);
  g.fillEllipse(x, y + 128 * s, 250 * s, 46 * s);

  // 小书包背在身后
  if (accessories.backpack) {
    const color = accessoryColor(accessories.backpack, THEME.warmRed);
    roundRect(g, x - 86 * s, y - 46 * s, 172 * s, 150 * s, 34 * s, shade(color, 0.86), THEME.outline, 6 * s);
    roundRect(g, x - 56 * s, y - 16 * s, 112 * s, 64 * s, 20 * s, color, THEME.outline, 5 * s);
    roundRect(g, x - 20 * s, y + 4 * s, 40 * s, 18 * s, 9 * s, THEME.gold, THEME.outline, 4 * s);
  }

  // 腿与鞋
  for (const side of [-1, 1] as const) {
    g.fillStyle(BLACK, 1);
    g.fillEllipse(x + side * 55 * s, y + 112 * s, 76 * s, 66 * s);
    if (accessories.shoes) {
      const color = accessoryColor(accessories.shoes, THEME.warmRed);
      g.fillStyle(color, 1);
      g.fillEllipse(x + side * 58 * s, y + 126 * s, 78 * s, 40 * s);
      g.lineStyle(5 * s, THEME.outline, 1);
      g.strokeEllipse(x + side * 58 * s, y + 126 * s, 78 * s, 40 * s);
    }
  }

  // 身体
  ellipse(g, x, y + 8 * s, 200 * s, 232 * s, WHITE);
  ellipse(g, x, y + 22 * s, 130 * s, 156 * s, shade(WHITE, 0.98), null, 0);

  // 睡衣 / 雨衣
  if (accessories.outfit) {
    const color = accessoryColor(accessories.outfit, THEME.lavender);
    g.fillStyle(color, 1);
    g.fillEllipse(x, y + 22 * s, 200 * s, 220 * s);
    g.lineStyle(6 * s, THEME.outline, 1);
    g.strokeEllipse(x, y + 22 * s, 200 * s, 220 * s);
    // 扣子
    for (let i = 0; i < 3; i += 1) circle(g, x, y - 20 * s + i * 42 * s, 6 * s, THEME.gold, null, 0);
    // 睡衣上的小星星
    for (const [dx, dy] of [[-52, -34], [48, 6], [-40, 66], [42, 84]] as const) {
      starPath(g, x + dx * s, y + dy * s, 9 * s, 4 * s, 5, THEME.gold, null, 0);
    }
  }

  // 手臂
  for (const side of [-1, 1] as const) {
    const raised = opts.wave === true && side === 1;
    const ay = raised ? y - 54 * s : y + 16 * s;
    const ax = raised ? x + 118 * s : x + side * 96 * s;
    g.fillStyle(BLACK, 1);
    g.fillEllipse(ax, ay, 66 * s, 118 * s);
    circle(g, ax, ay - (raised ? 42 : 42) * s, 27 * s, BLACK);
  }

  // 围兜
  if (accessories.bib) {
    const color = accessoryColor(accessories.bib, THEME.sun);
    g.fillStyle(color, 1);
    g.fillEllipse(x, y - 8 * s, 118 * s, 90 * s);
    g.lineStyle(5 * s, THEME.outline, 1);
    g.strokeEllipse(x, y - 8 * s, 118 * s, 90 * s);
    starPath(g, x, y - 6 * s, 15 * s, 7 * s, 5, shade(color, 1.3), null, 0);
  }

  // 头
  drawHead(g, x, y, s, mood, blush);

  // 帽子
  if (accessories.hat) {
    const color = accessoryColor(accessories.hat, THEME.bamboo);
    if (accessories.hat.startsWith('hat-straw')) {
      g.fillStyle(color, 1);
      g.fillEllipse(x, y - 246 * s, 250 * s, 66 * s);
      g.lineStyle(5 * s, THEME.outline, 1);
      g.strokeEllipse(x, y - 246 * s, 250 * s, 66 * s);
      g.fillStyle(shade(color, 0.92), 1);
      g.fillEllipse(x, y - 276 * s, 150 * s, 80 * s);
      g.strokeEllipse(x, y - 276 * s, 150 * s, 80 * s);
    } else if (accessories.hat.startsWith('hat-crown')) {
      g.fillStyle(color, 1);
      g.fillTriangle(x - 60 * s, y - 268 * s, x - 30 * s, y - 330 * s, x, y - 268 * s);
      g.fillTriangle(x - 10 * s, y - 268 * s, x + 20 * s, y - 336 * s, x + 50 * s, y - 268 * s);
      g.fillRect(x - 62 * s, y - 272 * s, 128 * s, 26 * s);
      g.lineStyle(5 * s, THEME.outline, 1);
      g.strokeRect(x - 62 * s, y - 272 * s, 128 * s, 26 * s);
    } else {
      // 竹叶帽：两片叶子 + 帽檐
      g.fillStyle(color, 1);
      g.fillEllipse(x, y - 256 * s, 190 * s, 46 * s);
      g.lineStyle(5 * s, THEME.outline, 1);
      g.strokeEllipse(x, y - 256 * s, 190 * s, 46 * s);
      g.fillStyle(shade(color, 0.92), 1);
      g.fillEllipse(x - 20 * s, y - 290 * s, 90 * s, 40 * s);
      g.fillEllipse(x + 30 * s, y - 300 * s, 76 * s, 36 * s);
    }
  }

  // 情绪装饰
  if (mood === 'dirty') {
    for (const [dx, dy] of [[-70, -170], [60, -190], [-40, 70], [70, 40]] as const) {
      g.fillStyle(THEME.woodDeep, 0.7);
      g.fillCircle(x + dx * s, y + dy * s, 8 * s);
    }
  }
  if (opts.hearts) {
    for (const [dx, dy, size] of [[-96, -290, 22], [0, -330, 30], [96, -286, 20]] as const) {
      heartPath(g, x + dx * s, y + dy * s, size * s, THEME.pink);
    }
  }
}

/** 近景大头（刷牙/洗脸用）：只画头，嘴张开时能看见牙齿，贴纸/污点由模板画在牙齿区 */
export function drawPandaHead(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  opts: { mood?: PandaMood; mouthOpen?: boolean; blush?: boolean } = {},
): void {
  const mood = opts.mood ?? 'happy';
  const blush = opts.blush ?? true;
  for (const side of [-1, 1] as const) {
    circle(g, x + side * 148 * s, y - 156 * s, 72 * s, BLACK);
    circle(g, x + side * 148 * s, y - 156 * s, 34 * s, shade(BLACK, 1.5), null, 0);
  }
  circle(g, x, y, 202 * s, WHITE);
  for (const side of [-1, 1] as const) {
    g.fillStyle(BLACK, 1);
    g.fillEllipse(x + side * 74 * s, y - 26 * s, 98 * s, 134 * s);
  }
  // 眼睛（大头版）
  const closed = mood === 'sleepy';
  for (const side of [-1, 1] as const) {
    const ex = x + side * 74 * s;
    const ey = y - 32 * s;
    if (closed) {
      g.lineStyle(10 * s, BLACK, 1);
      g.beginPath();
      g.arc(ex, ey, 27 * s, Math.PI * 1.15, Math.PI * 1.85);
      g.strokePath();
    } else {
      circle(g, ex, ey, 30 * s, WHITE, null, 0);
      circle(g, ex, ey + 3 * s, 16 * s, BLACK, null, 0);
      circle(g, ex + 6 * s, ey - 5 * s, 6 * s, WHITE, null, 0);
    }
  }
  // 鼻子
  g.fillStyle(BLACK, 1);
  g.fillEllipse(x, y + 54 * s, 56 * s, 42 * s);
  g.lineStyle(7 * s, BLACK, 1);
  g.beginPath();
  g.moveTo(x, y + 76 * s);
  g.lineTo(x, y + 94 * s);
  g.strokePath();

  if (opts.mouthOpen) {
    // 张开的嘴 + 上排牙齿：刷牙贴纸/细菌就画在牙齿这块区域
    g.fillStyle(THEME.warmRedDeep, 1);
    g.fillEllipse(x, y + 158 * s, 184 * s, 128 * s);
    g.lineStyle(7 * s, THEME.outline, 1);
    g.strokeEllipse(x, y + 158 * s, 184 * s, 128 * s);
    for (let i = 0; i < 6; i += 1) {
      const tx = x - 70 * s + i * 28 * s;
      roundRect(g, tx, y + 102 * s, 24 * s, 30 * s, 7 * s, THEME.white, THEME.outline, 3 * s);
    }
    g.fillStyle(THEME.pink, 1);
    g.fillEllipse(x, y + 214 * s, 92 * s, 30 * s);
  } else {
    g.lineStyle(7 * s, BLACK, 1);
    g.beginPath();
    g.arc(x, y + 96 * s, 42 * s, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
  }
  if (blush) {
    for (const side of [-1, 1] as const) {
      g.fillStyle(THEME.blush, 0.72);
      g.fillEllipse(x + side * 140 * s, y + 82 * s, 62 * s, 38 * s);
    }
  }
}

/** 小人物的"开心星星"（完成时用，不依赖场景） */
export function pandaCheer(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 1): void {
  for (const [dx, dy, size] of [[-170, -240, 26], [170, -260, 34], [-200, -60, 20], [200, -80, 24]] as const) {
    starPath(g, x + dx * s, y + dy * s, size * s, size * 0.45 * s, 5, THEME.gold, THEME.goldDeep, 3);
  }
}

/** 给道具/按钮用的一枚小头像（不画身体） */
export function drawPandaBadge(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  mood: PandaMood = 'happy',
): void {
  circle(g, x, y, r, WHITE);
  for (const side of [-1, 1] as const) circle(g, x + side * r * 0.72, y - r * 0.72, r * 0.34, BLACK);
  for (const side of [-1, 1] as const) {
    g.fillStyle(BLACK, 1);
    g.fillEllipse(x + side * r * 0.36, y - r * 0.12, r * 0.46, r * 0.62);
  }
  const closed = mood === 'sleepy';
  for (const side of [-1, 1] as const) {
    const ex = x + side * r * 0.36;
    const ey = y - r * 0.14;
    if (closed) {
      g.lineStyle(4, BLACK, 1);
      g.beginPath();
      g.arc(ex, ey, r * 0.14, Math.PI * 1.15, Math.PI * 1.85);
      g.strokePath();
    } else {
      circle(g, ex, ey, r * 0.14, WHITE, null, 0);
      circle(g, ex, ey + r * 0.02, r * 0.08, BLACK, null, 0);
    }
  }
  g.fillStyle(BLACK, 1);
  g.fillEllipse(x, y + r * 0.3, r * 0.26, r * 0.2);
}