import type Phaser from 'phaser';
import { circle, cloud, ellipse, heartPath, roundRect, shade, starPath, wavyBand } from './cartoon';
import { THEME } from './theme';

export type RoomTheme =
  | 'bathroom'
  | 'bedroom'
  | 'kitchen'
  | 'playroom'
  | 'yard'
  | 'closet'
  | 'classroom'
  | 'sink';

export type FoodKind = 'bamboo' | 'veg' | 'fruit' | 'grain' | 'protein' | 'snack';
export type ToyKind = 'ball' | 'block' | 'book' | 'car';
export type ClothingKind = 'hat' | 'bib' | 'outfit' | 'backpack' | 'shoes';
export type OrderIcon = 'curtain' | 'lamp' | 'blanket' | 'pat' | 'clock' | 'moon' | 'teddy';
export type EmotionFace = 'happy' | 'sad' | 'angry' | 'scared' | 'sleepy';
export type ShapeKind = 'circle' | 'square' | 'triangle' | 'star' | 'heart';

const FLOOR_TOP = 980;

/** 背景只负责"这是哪个房间"，交互物件与竹竹由模板按关卡坐标摆放 */
export function drawRoom(
  g: Phaser.GameObjects.Graphics,
  theme: RoomTheme,
  w: number,
  h: number,
): void {
  if (theme === 'yard') {
    g.fillStyle(THEME.sky, 1);
    g.fillRect(0, 0, w, h);
    circle(g, w - 130, 150, 70, THEME.sun, null, 0);
    cloud(g, 90, 170, 200);
    cloud(g, 420, 250, 160);
    g.fillStyle(THEME.bambooLight, 1);
    g.fillRect(0, FLOOR_TOP - 90, w, h - FLOOR_TOP + 90);
    g.fillStyle(THEME.bamboo, 1);
    g.fillRect(0, FLOOR_TOP - 20, w, h - FLOOR_TOP + 20);
    for (const [bx, bh] of [[70, 520], [150, 440], [w - 90, 560], [w - 170, 460]] as const) {
      drawBambooStalk(g, bx, FLOOR_TOP - 10, bh, 20);
    }
    return;
  }

  const wall =
    theme === 'bathroom' || theme === 'sink'
      ? 0xe6f1ef
      : theme === 'bedroom'
        ? 0xe8e2f0
        : theme === 'kitchen'
          ? 0xf7ead6
          : theme === 'playroom'
            ? 0xe4efdc
            : theme === 'closet'
              ? 0xf2e6d8
              : 0xe7eef4;
  const floor =
    theme === 'bathroom' || theme === 'sink'
      ? 0xcfe0dd
      : theme === 'bedroom'
        ? 0xd9cbb8
        : theme === 'kitchen'
          ? 0xd8c1a4
          : theme === 'playroom'
            ? 0xe3d3b4
            : 0xd8cbb8;

  g.fillStyle(wall, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(shade(wall, 0.96), 1);
  for (let x = 60; x < w; x += 110) {
    for (let y = 90; y < FLOOR_TOP - 90; y += 110) {
      if ((x + y) % 220 === 0) g.fillCircle(x, y, 5);
    }
  }
  g.fillStyle(shade(floor, 1), 1);
  g.fillRect(0, FLOOR_TOP, w, h - FLOOR_TOP);
  g.fillStyle(shade(floor, 0.9), 1);
  for (let x = -20; x < w; x += 90) {
    g.fillTriangle(x, FLOOR_TOP, x + 40, FLOOR_TOP, x - 30, h);
  }
  g.fillStyle(THEME.woodDeep, 1);
  g.fillRect(0, FLOOR_TOP - 14, w, 18);
  g.fillStyle(shade(wall, 0.88), 1);
  g.fillRect(0, 0, w, 150);

  if (theme === 'bedroom') {
    drawWindow(g, 70, 190, 200, 180, 'night');
    drawMoon(g, 210, 250, 26);
    starPath(g, 120, 230, 9, 4, 5, THEME.gold, null, 0);
    starPath(g, 165, 300, 7, 3, 5, THEME.gold, null, 0);
  } else if (theme === 'bathroom' || theme === 'sink') {
    drawWindow(g, 70, 190, 180, 160, 'day');
    // 小瓷砖
    g.lineStyle(3, shade(wall, 0.9), 0.8);
    for (let x = 60; x < w - 40; x += 84) g.lineBetween(x, 400, x, FLOOR_TOP - 20);
    for (let y = 420; y < FLOOR_TOP; y += 84) g.lineBetween(40, y, w - 40, y);
  } else if (theme === 'kitchen') {
    drawWindow(g, 90, 190, 170, 150, 'day');
    drawShelf(g, w - 280, 480, 210, 24, [THEME.warmRed, THEME.bamboo, THEME.gold]);
  } else if (theme === 'playroom') {
    drawWindow(g, w - 270, 190, 190, 170, 'day');
    drawShelf(g, 70, 470, 220, 26, [THEME.warmRed, THEME.bamboo, THEME.gold]);
  } else if (theme === 'closet') {
    // 衣柜
    roundRect(g, 70, 300, 250, 600, 22, THEME.wood, THEME.outline, 6);
    roundRect(g, 88, 322, 214, 260, 14, shade(THEME.wood, 1.1), THEME.outline, 4);
    roundRect(g, 88, 604, 214, 274, 14, shade(THEME.wood, 1.1), THEME.outline, 4);
    circle(g, 285, 460, 6, THEME.gold, null, 0);
    circle(g, 285, 740, 6, THEME.gold, null, 0);
    drawRug(g, w / 2, FLOOR_TOP + 130, w - 160, 180, THEME.bambooLight);
  } else if (theme === 'classroom') {
    drawWindow(g, 70, 190, 200, 180, 'night');
    drawMoon(g, 210, 250, 26);
    starPath(g, 120, 230, 9, 4, 5, THEME.gold, null, 0);
    starPath(g, 165, 300, 7, 3, 5, THEME.gold, null, 0);
    // 小黑板
    roundRect(g, 90, 420, 300, 210, 20, THEME.bambooDeep, THEME.outline, 6);
    roundRect(g, 108, 438, 264, 174, 12, 0x5f7f56, null, 0);
    starPath(g, 190, 510, 20, 8, 5, THEME.gold, null, 0);
    circle(g, 290, 530, 20, THEME.warmRed, null, 0);
  }
}

export function drawWindow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: 'day' | 'night' = 'day',
): void {
  roundRect(g, x - 10, y - 10, w + 20, h + 20, 18, THEME.wood, THEME.outline, 6);
  roundRect(g, x, y, w, h, 10, mode === 'night' ? 0x4b5a78 : THEME.sky, null, 0);
  if (mode === 'day') {
    circle(g, x + w * 0.72, y + h * 0.28, 26, THEME.sun, null, 0);
    cloud(g, x + w * 0.12, y + h * 0.62, w * 0.5);
  }
  g.lineStyle(6, THEME.wood, 1);
  g.lineBetween(x + w / 2, y, x + w / 2, y + h);
  g.lineBetween(x, y + h / 2, x + w, y + h / 2);
  // 窗帘
  g.fillStyle(THEME.blush, 0.9);
  g.fillRect(x - 26, y - 16, 26, h + 50);
  g.fillRect(x + w, y - 16, 26, h + 50);
}

export function drawMoon(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  circle(g, x, y, r, THEME.sun, null, 0);
  circle(g, x + r * 0.45, y - r * 0.2, r * 0.82, 0x4b5a78, null, 0);
}

export function drawBambooStalk(
  g: Phaser.GameObjects.Graphics,
  x: number,
  bottom: number,
  height: number,
  thickness = 18,
): void {
  g.fillStyle(THEME.bamboo, 1);
  g.fillRect(x - thickness / 2, bottom - height, thickness, height);
  g.lineStyle(3, THEME.bambooDeep, 0.9);
  for (let i = 1; i < 6; i += 1) {
    const y = bottom - (height * i) / 6;
    g.lineBetween(x - thickness / 2, y, x + thickness / 2, y);
  }
  // 叶子
  for (const [dx, dy, angle] of [[-24, 60, -0.5], [26, 110, 0.45], [-18, 170, -0.35]] as const) {
    const lx = x + dx;
    const ly = bottom - height + dy;
    g.fillStyle(THEME.bambooLight, 1);
    g.fillEllipse(lx + Math.cos(angle) * 22, ly, 64, 20);
    g.lineStyle(3, THEME.bambooDeep, 0.6);
    g.strokeEllipse(lx + Math.cos(angle) * 22, ly, 64, 20);
  }
}

export function drawRug(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: number = THEME.bambooLight,
): void {
  ellipse(g, cx, cy, w, h, color, THEME.outline, 5);
  ellipse(g, cx, cy, w * 0.74, h * 0.66, shade(color, 1.06), null, 0);
}

export function drawShelf(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  bookColors: number[] = [],
): void {
  roundRect(g, x, y, w, h, 8, THEME.wood, THEME.outline, 4);
  roundRect(g, x + 8, y - 74, w - 16, 74, 8, THEME.wood, THEME.outline, 4);
  const colors = bookColors.length > 0 ? bookColors : [THEME.warmRed, THEME.bamboo, THEME.gold];
  for (let i = 0; i < 4; i += 1) {
    const bw = 22;
    const bh = 44 + ((i * 13) % 22);
    g.fillStyle(colors[i % colors.length]!, 1);
    g.fillRect(x + 26 + i * 34, y - 74 + (74 - bh), bw, bh);
    g.lineStyle(3, THEME.outline, 0.8);
    g.strokeRect(x + 26 + i * 34, y - 74 + (74 - bh), bw, bh);
  }
}

export function drawBed(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  blanket = THEME.lavender,
): void {
  roundRect(g, x, y, w, h, 26, THEME.wood, THEME.outline, 6);
  roundRect(g, x + 16, y + 18, w - 32, h * 0.5, 20, THEME.white, THEME.outline, 4);
  roundRect(g, x + 16, y + h * 0.38, w - 32, h * 0.56, 22, blanket, THEME.outline, 5);
  roundRect(g, x + 34, y + 12, w * 0.36, h * 0.22, 14, THEME.white, THEME.outline, 4);
  // 床头
  roundRect(g, x - 18, y - 46, 34, h + 46, 16, THEME.woodDeep, THEME.outline, 5);
  roundRect(g, x + w - 16, y - 46, 34, h + 46, 16, THEME.woodDeep, THEME.outline, 5);
}

export function drawTable(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  roundRect(g, x - w / 2, y - h / 2, w, h * 0.36, 18, THEME.wood, THEME.outline, 6);
  g.fillStyle(THEME.woodDeep, 1);
  g.fillRect(x - w / 2 + 28, y - h * 0.1, 22, h * 0.6);
  g.fillRect(x + w / 2 - 50, y - h * 0.1, 22, h * 0.6);
}

export function drawPlate(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  ellipse(g, x, y, r * 2, r * 1.1, THEME.white, THEME.outline, 4);
  ellipse(g, x, y, r * 1.5, r * 0.78, THEME.card, null, 0);
}

export function drawSink(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 1): void {
  roundRect(g, x - 150 * s, y - 40 * s, 300 * s, 150 * s, 26 * s, THEME.white, THEME.outline, 6);
  roundRect(g, x - 118 * s, y - 18 * s, 236 * s, 96 * s, 18 * s, THEME.sky, THEME.outline, 4);
  g.fillStyle(THEME.water, 1);
  g.fillEllipse(x, y + 28 * s, 200 * s, 58 * s);
  // 龙头
  g.fillStyle(THEME.grey, 1);
  g.fillRect(x - 12 * s, y - 150 * s, 24 * s, 90 * s);
  g.fillRect(x - 12 * s, y - 160 * s, 92 * s, 24 * s);
  g.fillRect(x + 68 * s, y - 160 * s, 24 * s, 44 * s);
  g.lineStyle(5 * s, THEME.outline, 1);
  g.strokeRect(x - 12 * s, y - 160 * s, 92 * s, 24 * s);
}

export function drawTub(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  g.fillStyle(THEME.white, 1);
  g.fillEllipse(x, y, w, h * 0.5);
  roundRect(g, x - w / 2, y, w, h * 0.62, { tl: 20, tr: 20, bl: 64, br: 64 }, THEME.white, THEME.outline, 7);
  g.fillStyle(THEME.water, 1);
  g.fillEllipse(x, y + 4, w * 0.86, h * 0.38);
  wavyBand(g, x - w * 0.44, y - 4, w * 0.88, 20, THEME.skyDeep, 0.55, 6, 3, 28);
  for (let i = 0; i < 7; i += 1) {
    circle(g, x - w * 0.3 + i * 38, y - 10 - (i % 3) * 18, 16 + (i % 3) * 5, THEME.card, THEME.skyDeep, 3);
  }
}

export function drawLamp(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  on = true,
): void {
  g.lineStyle(5 * s, THEME.outline, 1);
  g.lineBetween(x, y - 300 * s, x, y - 120 * s);
  g.fillStyle(on ? THEME.gold : THEME.paperDeep, 1);
  g.fillTriangle(x - 70 * s, y - 120 * s, x + 70 * s, y - 120 * s, x, y - 210 * s);
  g.lineStyle(5 * s, THEME.outline, 1);
  g.strokeTriangle(x - 70 * s, y - 120 * s, x + 70 * s, y - 120 * s, x, y - 210 * s);
  g.fillStyle(THEME.woodDeep, 1);
  g.fillEllipse(x, y + 26 * s, 90 * s, 24 * s);
  g.fillRect(x - 8 * s, y, 16 * s, 30 * s);
}

export function drawCurtain(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  open = false,
): void {
  g.lineStyle(8, THEME.woodDeep, 1);
  g.lineBetween(x - w / 2 - 20, y, x + w / 2 + 20, y);
  if (open) {
    g.fillStyle(THEME.blush, 1);
    g.fillRect(x - w / 2 - 20, y, 40, h);
    g.fillRect(x + w / 2 - 20, y, 40, h);
    g.fillStyle(THEME.sky, 1);
    g.fillRect(x - w / 2 + 20, y, w - 40, h);
  } else {
    g.fillStyle(THEME.blush, 1);
    g.fillRect(x - w / 2 - 20, y, w + 40, h);
    g.lineStyle(4, shade(THEME.blush, 0.85), 1);
    for (let i = 1; i < 5; i += 1) {
      g.lineBetween(x - w / 2 - 20 + (w + 40) * (i / 5), y, x - w / 2 - 20 + (w + 40) * (i / 5), y + h);
    }
  }
}

export function drawBlanket(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color = THEME.lavender,
): void {
  wavyBand(g, x - w / 2, y, w, h, color, 1, 12, 2, 28);
  g.lineStyle(5, THEME.outline, 1);
  g.beginPath();
  g.moveTo(x - w / 2, y);
  for (let i = 0; i <= 28; i += 1) {
    const px = x - w / 2 + (w * i) / 28;
    const py = y + Math.sin((i / 28) * Math.PI * 4) * 12;
    g.lineTo(px, py);
  }
  g.strokePath();
}

export function drawFood(
  g: Phaser.GameObjects.Graphics,
  kind: FoodKind,
  x: number,
  y: number,
  s = 1,
  color?: number,
): void {
  if (kind === 'bamboo') {
    g.fillStyle(color ?? THEME.bamboo, 1);
    g.fillRect(x - 12 * s, y - 54 * s, 24 * s, 108 * s);
    g.lineStyle(3 * s, THEME.bambooDeep, 1);
    for (let i = -1; i <= 1; i += 1) g.lineBetween(x - 12 * s, y + i * 30 * s, x + 12 * s, y + i * 30 * s);
    g.fillStyle(THEME.bambooLight, 1);
    g.fillEllipse(x - 22 * s, y - 38 * s, 44 * s, 18 * s);
    g.fillEllipse(x + 20 * s, y - 20 * s, 40 * s, 16 * s);
  } else if (kind === 'veg') {
    // 胡萝卜
    g.fillStyle(color ?? 0xe8925f, 1);
    g.fillTriangle(x - 24 * s, y - 28 * s, x + 24 * s, y - 28 * s, x, y + 56 * s);
    g.lineStyle(4 * s, THEME.outline, 1);
    g.strokeTriangle(x - 24 * s, y - 28 * s, x + 24 * s, y - 28 * s, x, y + 56 * s);
    g.fillStyle(THEME.bamboo, 1);
    g.fillEllipse(x - 10 * s, y - 48 * s, 34 * s, 20 * s);
    g.fillEllipse(x + 10 * s, y - 50 * s, 30 * s, 18 * s);
  } else if (kind === 'fruit') {
    circle(g, x, y + 6 * s, 42 * s, color ?? THEME.warmRed);
    g.fillStyle(THEME.bamboo, 1);
    g.fillEllipse(x + 16 * s, y - 40 * s, 30 * s, 16 * s);
    g.fillStyle(THEME.woodDeep, 1);
    g.fillRect(x - 4 * s, y - 48 * s, 8 * s, 22 * s);
  } else if (kind === 'grain') {
    g.fillStyle(THEME.white, 1);
    g.fillEllipse(x, y - 8 * s, 96 * s, 54 * s);
    g.fillStyle(THEME.warmRed, 1);
    g.fillEllipse(x, y + 22 * s, 104 * s, 54 * s);
    g.lineStyle(4 * s, THEME.outline, 1);
    g.strokeEllipse(x, y + 22 * s, 104 * s, 54 * s);
    g.fillStyle(THEME.white, 1);
    g.fillRect(x - 52 * s, y + 8 * s, 104 * s, 16 * s);
  } else if (kind === 'protein') {
    // 小鱼
    g.fillStyle(color ?? 0x9fc4d8, 1);
    g.fillEllipse(x, y, 92 * s, 52 * s);
    g.fillTriangle(x + 40 * s, y, x + 74 * s, y - 30 * s, x + 74 * s, y + 30 * s);
    g.lineStyle(4 * s, THEME.outline, 1);
    g.strokeEllipse(x, y, 92 * s, 52 * s);
    circle(g, x - 28 * s, y - 4 * s, 5 * s, THEME.outline, null, 0);
  } else {
    // 小饼干
    circle(g, x, y, 36 * s, color ?? 0xd9a86c);
    for (const [dx, dy] of [[-12, -8], [10, -12], [4, 12], [-16, 12]] as const) {
      circle(g, x + dx * s, y + dy * s, 4 * s, THEME.woodDeep, null, 0);
    }
  }
}

export function drawClothing(
  g: Phaser.GameObjects.Graphics,
  kind: ClothingKind,
  color: number,
  x: number,
  y: number,
  s = 1,
): void {
  if (kind === 'hat') {
    g.fillStyle(color, 1);
    g.fillEllipse(x, y + 16 * s, 120 * s, 34 * s);
    g.fillEllipse(x, y - 12 * s, 78 * s, 60 * s);
    g.lineStyle(4 * s, THEME.outline, 1);
    g.strokeEllipse(x, y + 16 * s, 120 * s, 34 * s);
    g.strokeEllipse(x, y - 12 * s, 78 * s, 60 * s);
    circle(g, x, y - 42 * s, 8 * s, THEME.gold, THEME.outline, 3);
  } else if (kind === 'bib') {
    g.fillStyle(color, 1);
    g.fillEllipse(x, y + 8 * s, 92 * s, 84 * s);
    g.lineStyle(4 * s, THEME.outline, 1);
    g.strokeEllipse(x, y + 8 * s, 92 * s, 84 * s);
    g.fillStyle(shade(color, 0.8), 1);
    g.fillRect(x - 10 * s, y - 48 * s, 20 * s, 24 * s);
    starPath(g, x, y + 6 * s, 15 * s, 7 * s, 5, THEME.gold, null, 0);
  } else if (kind === 'outfit') {
    g.fillStyle(color, 1);
    roundRect(g, x - 52 * s, y - 34 * s, 104 * s, 90 * s, 20 * s, color, THEME.outline, 4 * s);
    ellipse(g, x - 58 * s, y - 14 * s, 32 * s, 44 * s, color, THEME.outline, 4 * s);
    ellipse(g, x + 58 * s, y - 14 * s, 32 * s, 44 * s, color, THEME.outline, 4 * s);
    for (let i = 0; i < 3; i += 1) circle(g, x, y - 12 * s + i * 26 * s, 5 * s, THEME.gold, null, 0);
  } else if (kind === 'backpack') {
    roundRect(g, x - 38 * s, y - 40 * s, 76 * s, 92 * s, 20 * s, color, THEME.outline, 4 * s);
    roundRect(g, x - 24 * s, y + 6 * s, 48 * s, 28 * s, 10 * s, shade(color, 0.8), THEME.outline, 3 * s);
    g.lineStyle(7 * s, THEME.woodDeep, 1);
    g.beginPath();
    g.arc(x, y - 40 * s, 26 * s, Math.PI, Math.PI * 2);
    g.strokePath();
  } else {
    // 一双鞋
    for (const side of [-1, 1] as const) {
      g.fillStyle(color, 1);
      g.fillEllipse(x + side * 22 * s, y + 8 * s, 46 * s, 30 * s);
      g.lineStyle(4 * s, THEME.outline, 1);
      g.strokeEllipse(x + side * 22 * s, y + 8 * s, 46 * s, 30 * s);
    }
  }
}

export function drawToy(
  g: Phaser.GameObjects.Graphics,
  kind: ToyKind,
  color: number,
  x: number,
  y: number,
  s = 1,
): void {
  if (kind === 'ball') {
    circle(g, x, y, 36 * s, color);
    g.lineStyle(5 * s, THEME.white, 0.8);
    g.beginPath();
    g.arc(x, y, 22 * s, -0.6, 0.9);
    g.strokePath();
  } else if (kind === 'block') {
    roundRect(g, x - 32 * s, y - 32 * s, 64 * s, 64 * s, 10 * s, color, THEME.outline, 4 * s);
    starPath(g, x, y, 15 * s, 7 * s, 5, THEME.white, null, 0);
  } else if (kind === 'book') {
    roundRect(g, x - 30 * s, y - 38 * s, 60 * s, 76 * s, 6 * s, color, THEME.outline, 4 * s);
    g.fillStyle(THEME.card, 1);
    g.fillRect(x + 6 * s, y - 30 * s, 18 * s, 60 * s);
    g.lineStyle(3 * s, THEME.grey, 1);
    for (let i = 0; i < 4; i += 1) {
      g.lineBetween(x - 22 * s, y - 18 * s + i * 14 * s, x + 2 * s, y - 18 * s + i * 14 * s);
    }
  } else {
    roundRect(g, x - 40 * s, y - 16 * s, 80 * s, 36 * s, 12 * s, color, THEME.outline, 4 * s);
    roundRect(g, x - 20 * s, y - 34 * s, 44 * s, 26 * s, 10 * s, shade(color, 1.15), THEME.outline, 3 * s);
    circle(g, x - 22 * s, y + 22 * s, 12 * s, THEME.outline, null, 0);
    circle(g, x + 22 * s, y + 22 * s, 12 * s, THEME.outline, null, 0);
  }
}

/** 收纳箱：箱口 + 类别图标，颜色与箱子里的东西一致 */
export function drawBin(
  g: Phaser.GameObjects.Graphics,
  kind: ToyKind,
  color: number,
  x: number,
  y: number,
  w = 190,
  h = 150,
): void {
  roundRect(g, x - w / 2, y - h / 2, w, h, 18, shade(color, 1.05), THEME.outline, 5);
  roundRect(g, x - w / 2 + 12, y - h / 2 + 12, w - 24, 34, 12, shade(color, 0.82), THEME.outline, 3);
  circle(g, x, y + 6, 34, THEME.card, THEME.outline, 3);
  drawToy(g, kind, color, x, y + 6, 0.55);
}

export function drawOrderIcon(
  g: Phaser.GameObjects.Graphics,
  icon: OrderIcon,
  x: number,
  y: number,
  s = 1,
  active = true,
): void {
  if (icon === 'curtain') {
    drawCurtain(g, x, y - 60 * s, 120 * s, 140 * s, false);
  } else if (icon === 'lamp') {
    drawLamp(g, x, y + 40 * s, s, true);
  } else if (icon === 'blanket') {
    drawBlanket(g, x, y - 20 * s, 150 * s, 100 * s, THEME.lavender);
    ellipse(g, x, y + 70 * s, 40 * s, 24 * s, THEME.white, THEME.outline, 3);
  } else if (icon === 'pat') {
    // 一只轻轻拍的小手
    roundRect(g, x - 34 * s, y - 10 * s, 68 * s, 58 * s, 22 * s, 0xf7d9bb, THEME.outline, 4);
    roundRect(g, x - 20 * s, y - 54 * s, 16 * s, 52 * s, 8 * s, 0xf7d9bb, THEME.outline, 4);
    roundRect(g, x + 2 * s, y - 58 * s, 16 * s, 56 * s, 8 * s, 0xf7d9bb, THEME.outline, 4);
  } else if (icon === 'clock') {
    circle(g, x, y, 52 * s, THEME.card);
    g.lineStyle(5 * s, THEME.outline, 1);
    g.lineBetween(x, y, x, y - 30 * s);
    g.lineBetween(x, y, x + 22 * s, y + 8 * s);
  } else if (icon === 'moon') {
    drawMoon(g, x, y, 46 * s);
  } else {
    // 小熊玩偶
    circle(g, x - 30 * s, y - 34 * s, 18 * s, THEME.wood);
    circle(g, x + 30 * s, y - 34 * s, 18 * s, THEME.wood);
    circle(g, x, y, 46 * s, THEME.wood);
    circle(g, x - 16 * s, y - 6 * s, 5 * s, THEME.outline, null, 0);
    circle(g, x + 16 * s, y - 6 * s, 5 * s, THEME.outline, null, 0);
    circle(g, x, y + 16 * s, 8 * s, THEME.outline, null, 0);
  }
  if (!active) {
    g.fillStyle(THEME.grey, 0.22);
    g.fillCircle(x, y, 70 * s);
  }
}

export function drawEmotionFace(
  g: Phaser.GameObjects.Graphics,
  emotion: EmotionFace,
  x: number,
  y: number,
  r: number,
): void {
  const colors: Record<EmotionFace, number> = {
    happy: THEME.sun,
    sad: 0xa8c4dd,
    angry: 0xe59a86,
    scared: THEME.lavender,
    sleepy: THEME.mint,
  };
  circle(g, x, y, r, colors[emotion]);
  const ex = r * 0.36;
  const ey = y - r * 0.18;
  if (emotion === 'sleepy') {
    for (const side of [-1, 1] as const) {
      g.lineStyle(5, THEME.outline, 1);
      g.beginPath();
      g.arc(x + side * ex, ey, r * 0.16, Math.PI * 1.1, Math.PI * 1.9);
      g.strokePath();
    }
    g.lineStyle(4, THEME.outline, 1);
    g.strokeCircle(x, y + r * 0.3, r * 0.12);
  } else {
    for (const side of [-1, 1] as const) {
      circle(g, x + side * ex, ey, r * 0.1, THEME.outline, null, 0);
    }
  }
  if (emotion === 'happy') {
    g.lineStyle(5, THEME.outline, 1);
    g.beginPath();
    g.arc(x, y + r * 0.12, r * 0.3, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
  } else if (emotion === 'sad') {
    g.lineStyle(5, THEME.outline, 1);
    g.beginPath();
    g.arc(x, y + r * 0.5, r * 0.26, Math.PI * 1.2, Math.PI * 1.8);
    g.strokePath();
    g.fillStyle(THEME.waterDeep, 1);
    g.fillEllipse(x - r * 0.36, y + r * 0.2, r * 0.12, r * 0.2);
  } else if (emotion === 'angry') {
    g.lineStyle(5, THEME.outline, 1);
    for (const side of [-1, 1] as const) {
      g.lineBetween(x + side * ex - r * 0.14, ey - r * 0.26, x + side * ex + r * 0.14, ey - r * 0.12);
    }
    g.lineStyle(5, THEME.outline, 1);
    g.beginPath();
    g.arc(x, y + r * 0.5, r * 0.26, Math.PI * 1.2, Math.PI * 1.8);
    g.strokePath();
  } else if (emotion === 'scared') {
    g.lineStyle(4, THEME.outline, 1);
    g.strokeCircle(x, y + r * 0.34, r * 0.2);
    g.lineStyle(5, THEME.outline, 1);
    for (const side of [-1, 1] as const) {
      g.lineBetween(x + side * ex - r * 0.12, ey - r * 0.3, x + side * ex + r * 0.12, ey - r * 0.3);
    }
  }
}

export function drawShape(
  g: Phaser.GameObjects.Graphics,
  shape: ShapeKind,
  x: number,
  y: number,
  r: number,
  color: number,
): void {
  if (shape === 'circle') {
    circle(g, x, y, r, color);
  } else if (shape === 'square') {
    roundRect(g, x - r, y - r, r * 2, r * 2, r * 0.24, color, THEME.outline, 5);
  } else if (shape === 'triangle') {
    g.fillStyle(color, 1);
    g.fillTriangle(x, y - r, x + r, y + r * 0.8, x - r, y + r * 0.8);
    g.lineStyle(5, THEME.outline, 1);
    g.strokeTriangle(x, y - r, x + r, y + r * 0.8, x - r, y + r * 0.8);
  } else if (shape === 'star') {
    starPath(g, x, y, r, r * 0.46, 5, color);
  } else {
    heartPath(g, x, y - r * 0.2, r * 1.5, color);
  }
}

export function drawToothbrush(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  color = THEME.warmRed,
): void {
  roundRect(g, x - 10 * s, y - 20 * s, 20 * s, 110 * s, 10 * s, color, THEME.outline, 4 * s);
  roundRect(g, x - 22 * s, y - 54 * s, 44 * s, 40 * s, 14 * s, THEME.white, THEME.outline, 4 * s);
  g.fillStyle(THEME.skyDeep, 1);
  for (let i = 0; i < 4; i += 1) {
    g.fillRect(x - 18 * s + i * 10 * s, y - 68 * s, 6 * s, 18 * s);
  }
}

export function drawSponge(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  color = THEME.sun,
): void {
  roundRect(g, x - 34 * s, y - 26 * s, 68 * s, 52 * s, 16 * s, color, THEME.outline, 4 * s);
  g.fillStyle(THEME.white, 0.5);
  for (const [dx, dy] of [[-14, -8], [10, -4], [0, 10], [16, 8]] as const) {
    g.fillCircle(x + dx * s, y + dy * s, 5 * s);
  }
}

export function drawTowel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
  color = THEME.blush,
): void {
  roundRect(g, x - 42 * s, y - 26 * s, 84 * s, 52 * s, 14 * s, color, THEME.outline, 4 * s);
  g.lineStyle(3 * s, shade(color, 0.85), 1);
  for (let i = -2; i <= 2; i += 1) g.lineBetween(x + i * 14 * s, y - 20 * s, x + i * 14 * s, y + 20 * s);
}

/** 固定图案的泡泡：不用随机数（纯绘制也要可复现） */
export function drawBubbles(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
  count = 6,
): void {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + 0.4;
    const dist = radius * (0.5 + ((i * 37) % 50) / 100);
    const r = 12 + ((i * 17) % 14);
    const bx = x + Math.cos(angle) * dist;
    const by = y + Math.sin(angle) * dist;
    g.fillStyle(THEME.white, 0.7);
    g.fillCircle(bx, by, r);
    g.lineStyle(2, THEME.skyDeep, 0.6);
    g.strokeCircle(bx, by, r);
  }
}

export function drawWaterStream(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  g.fillStyle(THEME.water, 0.8);
  g.fillRect(x - w / 2, y, w, h);
  g.fillStyle(THEME.white, 0.5);
  for (let i = 0; i < 6; i += 1) {
    g.fillCircle(x - w / 2 + ((i * 23) % w), y + h * (0.2 + ((i * 13) % 60) / 100), 4);
  }
}

export function drawTooth(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
): void {
  g.fillStyle(THEME.white, 1);
  roundRect(g, x - 22 * s, y - 28 * s, 44 * s, 44 * s, 16 * s, THEME.white, THEME.outline, 4 * s);
  g.fillRect(x - 20 * s, y + 8 * s, 16 * s, 22 * s);
  g.fillRect(x + 4 * s, y + 8 * s, 16 * s, 22 * s);
}

/** 小云朵按钮底（"提示"气泡用） */
export function drawCloudPill(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color = THEME.card,
): void {
  roundRect(g, x - w / 2, y - h / 2, w, h, h / 2, color, THEME.outline, 4);
  ellipse(g, x, y + h * 0.2, w * 0.9, h * 0.7, color, null, 0);
}