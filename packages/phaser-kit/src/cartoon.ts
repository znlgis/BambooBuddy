import type Phaser from 'phaser';
import { THEME } from './theme';

const OUTLINE_WIDTH = 6;

type Radius = number | Phaser.Types.GameObjects.Graphics.RoundedRectRadius;
export type Fadeable = Phaser.GameObjects.GameObject & {
  alpha: number;
  setAlpha(value: number): unknown;
};

/** 圆角矩形：卡通风格一律"有底有边" */
export function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: Radius,
  fill: number,
  outline: number | null = THEME.outline,
  outlineWidth = OUTLINE_WIDTH,
  alpha = 1,
): void {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  if (outline !== null && outlineWidth > 0) {
    g.lineStyle(outlineWidth, outline, 1);
    g.strokeRoundedRect(x, y, w, h, radius);
  }
}

export function circle(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  fill: number,
  outline: number | null = THEME.outline,
  outlineWidth = 5,
  alpha = 1,
): void {
  g.fillStyle(fill, alpha);
  g.fillCircle(x, y, r);
  if (outline !== null && outlineWidth > 0) {
    g.lineStyle(outlineWidth, outline, 1);
    g.strokeCircle(x, y, r);
  }
}

export function ellipse(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  outline: number | null = THEME.outline,
  outlineWidth = 5,
  alpha = 1,
): void {
  g.fillStyle(fill, alpha);
  g.fillEllipse(x, y, w, h);
  if (outline !== null && outlineWidth > 0) {
    g.lineStyle(outlineWidth, outline, 1);
    g.strokeEllipse(x, y, w, h);
  }
}

/** 物体底下的柔和阴影，圆润卡通的关键"落地感" */
export function groundShadow(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  alpha = 0.14,
): void {
  g.fillStyle(THEME.outline, alpha);
  g.fillEllipse(cx, cy, w, h);
}

/** 波浪（水面 / 被子边缘），用折线逼近，避免依赖曲线 API */
export function wavyBand(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha = 1,
  amplitude = 10,
  waves = 2.5,
  segments = 40,
): void {
  g.fillStyle(color, alpha);
  g.beginPath();
  g.moveTo(x, y);
  for (let i = 0; i <= segments; i += 1) {
    const px = x + (w * i) / segments;
    const py = y + Math.sin((i / segments) * Math.PI * 2 * waves) * amplitude;
    g.lineTo(px, py);
  }
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.closePath();
  g.fillPath();
}

/** 挤压回弹：给拖放一个"有重量"的手感 */
export function squash(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  base = 1,
  strength = 0.14,
): void {
  scene.tweens.add({
    targets: target,
    scaleX: base * (1 + strength),
    scaleY: base * (1 - strength),
    duration: 90,
    yoyo: true,
    ease: 'Quad.easeOut',
  });
}

export function popIn(scene: Phaser.Scene, target: Fadeable, delay = 0): void {
  target.setAlpha(0);
  scene.tweens.add({
    targets: target,
    alpha: 1,
    duration: 240,
    delay,
    ease: 'Quad.easeOut',
  });
}

/** 颜色加深/变浅：做按钮厚底与物体亮暗面 */
export function shade(color: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

/** 星光反馈，替代"答对了"这类文字 */
export function sparkleAt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number = THEME.gold,
  count = 5,
): void {
  for (let i = 0; i < count; i += 1) {
    const g = scene.add.graphics().setDepth(900);
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, 8);
    g.lineStyle(4, color, 1);
    g.lineBetween(-20, 0, 20, 0);
    g.lineBetween(0, -20, 0, 20);
    const angle = (Math.PI * 2 * i) / count;
    g.setPosition(x + Math.cos(angle) * 30, y + Math.sin(angle) * 30);
    scene.tweens.add({
      targets: g,
      x: x + Math.cos(angle) * 120,
      y: y + Math.sin(angle) * 120,
      scale: 0.2,
      alpha: 0,
      duration: 560,
      delay: i * 36,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
  }
}

/** "点这里"的扩散涟漪，代替提示文字 */
export function tapRipple(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius = 44,
  color: number = THEME.warmRed,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(80);
  let acc = 0;
  const draw = (phaseBase: number): void => {
    g.clear();
    for (let i = 0; i < 2; i += 1) {
      const phase = (phaseBase + i * 0.5) % 1;
      g.lineStyle(5, color, (1 - phase) * 0.9);
      g.strokeCircle(x, y, radius * (0.5 + phase * 0.9));
    }
  };
  const onUpdate = (_time: number, delta: number): void => {
    acc += delta;
    draw((acc % 1600) / 1600);
  };
  scene.events.on('update', onUpdate);
  g.once('destroy', () => {
    scene.events.off('update', onUpdate);
  });
  draw(0);
  return g;
}

/** 卡通小手，表示"可以拖我 / 点这里" */
export function drawHand(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s = 1,
): void {
  const skin = 0xf7d9bb;
  roundRect(g, x - 22 * s, y - 4 * s, 44 * s, 44 * s, 16 * s, skin, THEME.outline, 5 * s);
  roundRect(g, x - 15 * s, y - 36 * s, 13 * s, 36 * s, 6 * s, skin, THEME.outline, 5 * s);
  roundRect(g, x - 1 * s, y - 42 * s, 13 * s, 42 * s, 6 * s, skin, THEME.outline, 5 * s);
  roundRect(g, x + 13 * s, y - 32 * s, 12 * s, 32 * s, 6 * s, skin, THEME.outline, 5 * s);
  roundRect(g, x - 36 * s, y + 2 * s, 20 * s, 28 * s, 11 * s, skin, THEME.outline, 5 * s);
}

export function createHand(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s = 1,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(850);
  drawHand(g, 0, 0, s);
  g.setPosition(x, y);
  scene.tweens.add({
    targets: g,
    y: y + 16,
    duration: 560,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return g;
}

/* ---------------- 形状工具（模板与道具共用） ---------------- */

export function starPath(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  outer: number,
  inner = outer * 0.46,
  points = 5,
  fill: number = THEME.gold,
  outline: number | null = THEME.outline,
  outlineWidth = 4,
): void {
  const coords: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (Math.PI * i) / points;
    coords.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  if (outline !== null) {
    g.lineStyle(outlineWidth, outline, 1);
    g.beginPath();
    g.moveTo(coords[0]!.x, coords[0]!.y);
    for (const point of coords.slice(1)) g.lineTo(point.x, point.y);
    g.closePath();
    g.strokePath();
  }
  g.fillStyle(fill, 1);
  g.beginPath();
  g.moveTo(coords[0]!.x, coords[0]!.y);
  for (const point of coords.slice(1)) g.lineTo(point.x, point.y);
  g.closePath();
  g.fillPath();
}

export function heartPath(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  fill: number = THEME.pink,
  outline: number | null = THEME.outline,
): void {
  g.fillStyle(fill, 1);
  g.fillCircle(cx - size * 0.28, cy - size * 0.12, size * 0.34);
  g.fillCircle(cx + size * 0.28, cy - size * 0.12, size * 0.34);
  g.fillTriangle(
    cx - size * 0.57,
    cy - size * 0.02,
    cx + size * 0.57,
    cy - size * 0.02,
    cx,
    cy + size * 0.6,
  );
  if (outline !== null) {
    g.lineStyle(4, outline, 0.9);
    g.strokeCircle(cx - size * 0.28, cy - size * 0.12, size * 0.34);
    g.strokeCircle(cx + size * 0.28, cy - size * 0.12, size * 0.34);
  }
}

export function cloud(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  color: number = THEME.white,
  alpha = 0.9,
): void {
  g.fillStyle(color, alpha);
  g.fillCircle(x, y, w * 0.26);
  g.fillCircle(x + w * 0.3, y - w * 0.1, w * 0.32);
  g.fillCircle(x + w * 0.62, y, w * 0.24);
  g.fillEllipse(x + w * 0.32, y + w * 0.08, w * 0.9, w * 0.42);
}
