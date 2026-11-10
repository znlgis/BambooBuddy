import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { createHand, heartPath } from './cartoon';
import { THEME } from './theme';

/**
 * phaser-kit 的绘制工具没有场景依赖，只用 Graphics 的绘制命令，
 * 所以可以在 Node 里用「记录调用的假 Graphics」直接验证画出来的路径：
 * 这一步锁住的是「视觉正确性」而不是截图（截图评审在 e2e 之外）。
 */

interface GraphicsCall {
  name: string;
  args: unknown[];
}

interface FakeGraphics {
  calls: GraphicsCall[];
  graphics: Phaser.GameObjects.Graphics;
}

/** 记录所有绘制命令；方法返回自身以兼容 Phaser 的链式调用（add.graphics().setDepth()） */
function fakeGraphics(): FakeGraphics {
  const calls: GraphicsCall[] = [];
  const proxy = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'calls') return calls;
        if (typeof property !== 'string') return undefined;
        return (...args: unknown[]) => {
          calls.push({ name: property, args });
          return proxy;
        };
      },
    },
  ) as unknown as Phaser.GameObjects.Graphics;
  return { calls, graphics: proxy };
}

/** 取出第 pathIndex 段 beginPath…closePath 路径上的点（moveTo/lineTo 的坐标） */
function pathPoints(calls: GraphicsCall[], pathIndex = 0): { x: number; y: number }[] {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] | null = null;
  for (const call of calls) {
    if (call.name === 'beginPath') {
      current = [];
      segments.push(current);
      continue;
    }
    if (current === null) continue;
    if (call.name === 'moveTo' || call.name === 'lineTo') {
      current.push({ x: Number(call.args[0]), y: Number(call.args[1]) });
    }
  }
  return segments[pathIndex] ?? [];
}

const CX = 100;
const CY = 200;
const SIZE = 100;
/** 与 heartPath 的参数曲线一致：x ∈ [-16,16] → ±16*sx；y ∈ [-17,12] → cy + 19.5*sy */
const SX = (SIZE * 1.14) / 32;
const SY = (SIZE * 1.06) / 29;

describe('heartPath：一颗心只有一条连续轮廓', () => {
  it('描边与填充共用同一条闭合曲线（不再是两个圆 + 一个无描边三角）', () => {
    const { calls, graphics } = fakeGraphics();
    heartPath(graphics, CX, CY, SIZE);

    // 旧实现用 fillCircle/strokeCircle + fillTriangle 拼心：描边只描两个圆，底部尖角没有轮廓。
    expect(calls.filter((call) => /Circle|Triangle/.test(call.name))).toEqual([]);

    const stroke = pathPoints(calls, 0);
    const fill = pathPoints(calls, 1);
    expect(stroke).toHaveLength(48);
    expect(fill).toEqual(stroke);
    expect(calls.filter((call) => call.name === 'strokePath')).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'closePath')).toHaveLength(2);
    expect(calls.filter((call) => call.name === 'fillPath')).toHaveLength(1);

    // 描边颜色/粗细与其它卡通形状一致；填充用主题粉
    const strokeStyle = calls.find((call) => call.name === 'lineStyle');
    expect(strokeStyle?.args).toEqual([4, THEME.outline, 0.9]);
    const fillStyle = calls.find((call) => call.name === 'fillStyle');
    expect(fillStyle?.args).toEqual([THEME.pink, 1]);
  });

  it('心形左右对称、底部尖角正好在正下方（旧实现缺的那一段）', () => {
    const { calls, graphics } = fakeGraphics();
    heartPath(graphics, CX, CY, SIZE);
    const points = pathPoints(calls, 0);

    // 对称：每个点都能找到关于 cx 镜像的另一个点
    for (const point of points) {
      const mirrored = points.some(
        (other) => Math.abs(other.x - (CX * 2 - point.x)) < 1e-9 && Math.abs(other.y - point.y) < 1e-9,
      );
      expect(mirrored).toBe(true);
    }

    // 最宽处：参数曲线 x = 16·sin³t，宽度的一半就是 16*sx
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(CX + 16 * SX, 6);
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(CX - 16 * SX, 6);

    // 底部尖角：t=π 时 y=-17 → 屏幕坐标在圆心下方约 19.5*sy，且 x 居中
    const lowest = points.reduce((a, b) => (b.y > a.y ? b : a));
    expect(lowest.y).toBeCloseTo(CY + 19.5 * SY, 6);
    expect(lowest.x).toBeCloseTo(CX, 6);

    // 顶部两瓣：t≈0 处的凹口比两瓣低，最高的点在圆心上方约 9.2*sy
    const highest = points.reduce((a, b) => (b.y < a.y ? b : a));
    expect(highest.y).toBeLessThan(CY - 25);
    expect(highest.y).toBeGreaterThan(CY - 45);
  });

  it('outline 为 null 时只填充，不产生描边命令', () => {
    const { calls, graphics } = fakeGraphics();
    heartPath(graphics, CX, CY, SIZE, THEME.gold, null);
    expect(calls.some((call) => call.name === 'lineStyle')).toBe(false);
    expect(calls.some((call) => call.name === 'strokePath')).toBe(false);
    expect(calls.filter((call) => call.name === 'beginPath')).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'fillPath')).toHaveLength(1);
    expect(pathPoints(calls, 0)).toHaveLength(48);
  });
});

describe('createHand：reduced-motion 下不摆', () => {
  function fakeScene(): {
    scene: Phaser.Scene;
    tweens: { repeat?: number; yoyo?: boolean }[];
    graphics: FakeGraphics[];
  } {
    const tweens: { repeat?: number; yoyo?: boolean }[] = [];
    const graphics: FakeGraphics[] = [];
    const scene = {
      add: {
        graphics: () => {
          const fake = fakeGraphics();
          graphics.push(fake);
          return fake.graphics;
        },
      },
      tweens: {
        add: (config: { repeat?: number; yoyo?: boolean }) => {
          tweens.push(config);
          return config;
        },
      },
    } as unknown as Phaser.Scene;
    return { scene, tweens, graphics };
  }

  it('animate=false 时只画手、不加无限摆动补间（供 prefers-reduced-motion 使用）', () => {
    const { scene, tweens, graphics } = fakeScene();
    createHand(scene, 10, 20, 1.15, false);
    expect(tweens).toHaveLength(0);
    // 位置仍然画出来：孩子要能看到"从这里拖"，只是不晃
    const positions = graphics[0]?.calls.filter((call) => call.name === 'setPosition') ?? [];
    expect(positions.at(-1)?.args).toEqual([10, 20]);
  });

  it('默认仍然循环摆动（由调用方按 reducedMotion 决定是否传入 false）', () => {
    const { scene, tweens } = fakeScene();
    createHand(scene, 10, 20, 1.15);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]?.repeat).toBe(-1);
    expect(tweens[0]?.yoyo).toBe(true);
  });
});
