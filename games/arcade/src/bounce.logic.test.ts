import { describe, expect, it } from 'vitest';
import {
  BOUNCE_AIM_LIMIT_DEG,
  BOUNCE_BOARD,
  BOUNCE_COMBO_BONUS,
  BOUNCE_DROP_EVERY_SHOTS,
  BOUNCE_GRID,
  BOUNCE_ROUND_PAUSE_MS,
  BOUNCE_STARS_PER_BLOCK,
  BOUNCE_STEP_MS,
  DEFAULT_AIM,
  advanceBounce,
  aimToward,
  anticipate,
  canFire,
  createBounceGame,
  fireBall,
  launchPointFor,
  playAutoplay,
  predictAim,
  remainingBlocks,
  scoreOf,
} from './bounce.logic';
import type { BounceBall, BounceBlock, BounceState } from './bounce.logic';

const WALL_LEFT = BOUNCE_BOARD.left + BOUNCE_BOARD.ballRadius;
const WALL_RIGHT = BOUNCE_BOARD.right - BOUNCE_BOARD.ballRadius;

function blockAt(
  id: string,
  x: number,
  y: number,
  kind: BounceBlock['kind'] = 'brick',
): BounceBlock {
  return {
    id,
    col: 0,
    row: 0,
    x,
    y,
    w: BOUNCE_GRID.blockWidth,
    h: BOUNCE_GRID.blockHeight,
    kind,
    alive: true,
  };
}

function ballAt(x: number, y: number, vx: number, vy: number, bounces = 0): BounceBall {
  return { id: 900, x, y, vx, vy, bounces, hits: 0 };
}

/** 只留一颗手摆的球：测试墙壁 / 边界这种与方块无关的规则 */
function onlyBall(state: BounceState, ball: BounceBall, blocks: BounceBlock[] = []): BounceState {
  return { ...state, balls: [ball], blocks };
}

function advanceSteps(state: BounceState, steps: number): BounceState {
  let current = state;
  for (let index = 0; index < steps; index += 1) {
    current = advanceBounce(current, BOUNCE_STEP_MS).state;
  }
  return current;
}

describe('弹一弹：定步长与墙壁反弹', () => {
  it('一步正好走 12px（1500px/s × 8ms），方向不变', () => {
    const start = onlyBall(createBounceGame(1), ballAt(300, 700, 0, -1500));
    const result = advanceBounce(start, BOUNCE_STEP_MS);
    const ball = result.state.balls[0]!;
    expect(ball.x).toBeCloseTo(300, 6);
    expect(ball.y).toBeCloseTo(700 - 12, 6);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(-1500);
  });

  it('撞左墙：位置夹回墙内，vx 反向，vy 不变（镜面反射）', () => {
    const start = onlyBall(createBounceGame(2), ballAt(WALL_LEFT + 4, 800, -1500, -600));
    const ball = advanceBounce(start, BOUNCE_STEP_MS).state.balls[0]!;
    expect(ball.x).toBe(WALL_LEFT);
    expect(ball.vx).toBe(1500);
    expect(ball.vy).toBe(-600);
    expect(ball.bounces).toBe(1);
  });

  it('同样的输入推进 40 步，落点逐位相同；球永远留在两墙之间', () => {
    const start = onlyBall(createBounceGame(3), ballAt(200, 900, 1500, -900));
    let a = start;
    let b = start;
    for (let index = 0; index < 40; index += 1) {
      a = advanceBounce(a, BOUNCE_STEP_MS).state;
      b = advanceBounce(b, BOUNCE_STEP_MS).state;
      const ball = a.balls[0]!;
      expect(ball.x).toBeGreaterThanOrEqual(WALL_LEFT);
      expect(ball.x).toBeLessThanOrEqual(WALL_RIGHT);
    }
    expect(a.balls[0]).toEqual(b.balls[0]);
  });

  it('从上方或下方飞出去：球回到发射器（不失败，也不结束一轮）', () => {
    const top = onlyBall(createBounceGame(4), ballAt(375, BOUNCE_BOARD.top, 0, -1500));
    const afterTop = advanceSteps(top, 2);
    expect(afterTop.balls).toHaveLength(0);
    expect(afterTop.roundDone).toBe(false);

    const bottom = onlyBall(createBounceGame(5), ballAt(375, BOUNCE_BOARD.floor + 20, 0, 1500));
    const afterBottom = advanceBounce(bottom, BOUNCE_STEP_MS).state;
    expect(afterBottom.balls).toHaveLength(0);
  });

  it('反弹满 8 次就回发射器（第 8 次撞碎的方块仍然算数）', () => {
    const start = onlyBall(createBounceGame(6), ballAt(WALL_LEFT + 4, 700, -1500, 0, 7));
    const state = advanceBounce(start, BOUNCE_STEP_MS).state;
    expect(state.balls).toHaveLength(0);
  });
});

describe('弹一弹：击碎方块与星星', () => {
  it('球撞上方块：1 击碎、星星 +3、球被弹回去', () => {
    const target = blockAt('target', 375, 700);
    const other = blockAt('other', 375, 330);
    const start = onlyBall(createBounceGame(7), ballAt(375, 760, 0, -1500), [target, other]);
    const result = advanceBounce(start, BOUNCE_STEP_MS);

    expect(result.events.broken.map((block) => block.id)).toEqual(['target']);
    expect(result.state.blocks.find((block) => block.id === 'target')?.alive).toBe(false);
    expect(result.state.stars).toBe(BOUNCE_STARS_PER_BLOCK);
    const ball = result.state.balls[0]!;
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.bounces).toBe(1);
  });

  it('弹弹方块也是 1 击碎，但反弹后球更快（封顶）', () => {
    const target = blockAt('bouncy', 375, 700, 'bouncy');
    const other = blockAt('other', 375, 330);
    const start = onlyBall(createBounceGame(8), ballAt(375, 760, 0, -1500), [target, other]);
    const result = advanceBounce(start, BOUNCE_STEP_MS);
    const ball = result.state.balls[0]!;
    const speed = Math.hypot(ball.vx, ball.vy);
    expect(result.state.blocks.find((block) => block.id === 'bouncy')?.alive).toBe(false);
    expect(speed).toBeCloseTo(BOUNCE_BOARD.shotSpeed * BOUNCE_BOARD.bouncyBoost, 6);
  });

  it('同一发连续击碎 3 块：每多一块 +5 连击分，星星照收', () => {
    const blocks = [
      blockAt('first', 306, 700),
      blockAt('second', 448, 700),
      // 第三块在上一排，球被第二次推开后继续往上，正好撞到它
      blockAt('third', 361, 620),
    ];
    let state: BounceState = onlyBall(createBounceGame(19), ballAt(376, 700, 0, -1500), blocks);

    const shot1 = advanceBounce(state, BOUNCE_STEP_MS);
    state = shot1.state;
    expect(shot1.events.broken.map((block) => block.id)).toEqual(['first']);
    expect(state.stars).toBe(BOUNCE_STARS_PER_BLOCK);
    expect(state.comboBonus).toBe(0);

    const shot2 = advanceBounce(state, BOUNCE_STEP_MS);
    state = shot2.state;
    expect(shot2.events.broken.map((block) => block.id)).toEqual(['second']);
    expect(state.stars).toBe(BOUNCE_STARS_PER_BLOCK * 2);
    expect(state.comboBonus).toBe(BOUNCE_COMBO_BONUS);

    const shot3 = advanceBounce(state, BOUNCE_STEP_MS);
    state = shot3.state;
    expect(shot3.events.broken.map((block) => block.id)).toEqual(['third']);
    expect(state.stars).toBe(BOUNCE_STARS_PER_BLOCK * 3);
    expect(state.comboBonus).toBe(BOUNCE_COMBO_BONUS * 2);
    expect(scoreOf(state)).toBe(BOUNCE_STARS_PER_BLOCK * 3 + BOUNCE_COMBO_BONUS * 2);
    expect(state.roundDone).toBe(true);
  });

  it('最后一块碎掉时这一轮立即完成，星星不会重复计', () => {
    const only = blockAt('last', 375, 700);
    const start = onlyBall(createBounceGame(9), ballAt(375, 760, 0, -1500), [only]);
    const result = advanceBounce(start, BOUNCE_STEP_MS);

    expect(result.events.roundCompleted).toBe(1);
    expect(result.state.roundDone).toBe(true);
    expect(result.state.stars).toBe(BOUNCE_STARS_PER_BLOCK);
    expect(result.state.balls).toHaveLength(0);
    expect(remainingBlocks(result.state)).toBe(0);
  });
});

describe('弹一弹：装弹与同时最多 3 颗球', () => {
  it('发射后进入 0.9 秒装弹，时间到了才能再发', () => {
    const empty = { ...createBounceGame(10), blocks: [] };
    const fired = fireBall(empty, DEFAULT_AIM);
    expect(fired.fired).toBe(true);
    expect(fired.state.reloadLeftMs).toBe(BOUNCE_BOARD.reloadMs);
    expect(canFire(fired.state)).toBe(false);

    const almost = advanceBounce(fired.state, BOUNCE_BOARD.reloadMs - 1).state;
    expect(canFire(almost)).toBe(false);
    const ready = advanceBounce(almost, 1).state;
    expect(canFire(ready)).toBe(true);
  });

  it('同时最多 3 颗球，第 4 颗发不出去', () => {
    let state: BounceState = { ...createBounceGame(11), blocks: [] };
    for (let index = 0; index < BOUNCE_BOARD.maxBalls; index += 1) {
      state = { ...fireBall(state, DEFAULT_AIM).state, reloadLeftMs: 0 };
    }
    expect(state.balls).toHaveLength(BOUNCE_BOARD.maxBalls);
    expect(fireBall(state, DEFAULT_AIM).fired).toBe(false);
  });
});

describe('弹一弹：下沉节奏与贴底开花', () => {
  it('前 5 发不下沉，第 6 发整体下沉一格', () => {
    let state: BounceState = { ...createBounceGame(12), reloadLeftMs: 0 };
    const before = state.blocks.map((block) => block.y);

    for (let shot = 0; shot < BOUNCE_DROP_EVERY_SHOTS - 1; shot += 1) {
      state = { ...fireBall(state, DEFAULT_AIM).state, balls: [], reloadLeftMs: 0 };
    }
    expect(state.shotsThisRound).toBe(BOUNCE_DROP_EVERY_SHOTS - 1);
    expect(state.drops).toBe(0);
    expect(state.blocks.map((block) => block.y)).toEqual(before);

    const sixth = fireBall(state, DEFAULT_AIM);
    expect(sixth.state.drops).toBe(1);
    expect(sixth.state.blocks.map((block) => block.y)).toEqual(
      before.map((y) => y + BOUNCE_GRID.dropStep),
    );
  });

  it('方块贴到底部不失败：全部开出小花飞走、星星计入、本轮直接完成', () => {
    const base = createBounceGame(13);
    const nearBottom = base.blocks.map((block) => ({
      ...block,
      y: BOUNCE_GRID.flowerLine - BOUNCE_GRID.dropStep + 10,
    }));
    const state: BounceState = { ...base, blocks: nearBottom, shotsThisRound: 5 };
    const shot = fireBall(state, DEFAULT_AIM);

    expect(shot.events.flowered).toHaveLength(6);
    expect(shot.state.stars).toBe(6 * BOUNCE_STARS_PER_BLOCK);
    expect(shot.state.roundDone).toBe(true);
    expect(shot.state.balls).toHaveLength(0);
    expect(remainingBlocks(shot.state)).toBe(0);
  });

  it('一轮结束后停一下自动开下一轮；三轮走完才 finished', () => {
    const only = blockAt('last', 375, 700);
    let state = onlyBall(createBounceGame(14), ballAt(375, 760, 0, -1500), [only]);
    const first = advanceBounce(state, BOUNCE_STEP_MS);
    state = first.state;
    expect(state.roundDone).toBe(true);

    const waiting = advanceBounce(state, BOUNCE_ROUND_PAUSE_MS - 1).state;
    expect(waiting.roundDone).toBe(true);
    const nextRound = advanceBounce(waiting, 1);
    expect(nextRound.events.roundStarted).toBe(2);
    expect(nextRound.state.round).toBe(2);
    expect(nextRound.state.blocks).toHaveLength(9);
    expect(nextRound.state.finished).toBe(false);
  });
});

describe('弹一弹：瞄准预测', () => {
  it('竖直向上且没有方块：一条虚线到顶边，没有反弹点', () => {
    const state = { ...createBounceGame(15), blocks: [] };
    const prediction = predictAim(state, DEFAULT_AIM);
    expect(prediction.points).toHaveLength(2);
    expect(prediction.points[0]).toEqual(launchPointFor(DEFAULT_AIM));
    expect(prediction.points[1]!.x).toBeCloseTo(BOUNCE_BOARD.launchX, 6);
    expect(prediction.points[1]!.y).toBeCloseTo(BOUNCE_BOARD.top - BOUNCE_BOARD.ballRadius, 6);
    expect(prediction.bouncePoints).toHaveLength(0);
    expect(prediction.hitBlockId).toBeNull();
  });

  it('斜着打：左右各两个反弹点，位置正好落在墙内侧', () => {
    const state = { ...createBounceGame(16), blocks: [] };
    const aim = aimToward({ x: BOUNCE_BOARD.launchX + 1000, y: BOUNCE_BOARD.launchY - 577 });
    const prediction = predictAim(state, aim);
    expect(prediction.bouncePoints).toHaveLength(2);
    expect(prediction.bouncePoints[0]!.x).toBe(WALL_RIGHT);
    expect(prediction.bouncePoints[1]!.x).toBe(WALL_LEFT);
    expect(prediction.bouncePoints[0]!.y).toBeGreaterThan(BOUNCE_BOARD.top);
  });

  it('路径上第一个方块就是预测目标；竖直线停在方块下沿', () => {
    const target = blockAt('target', 375, 700);
    const state = { ...createBounceGame(17), blocks: [target] };
    const prediction = predictAim(state, DEFAULT_AIM);
    expect(prediction.hitBlockId).toBe(target.id);
    expect(prediction.points).toHaveLength(2);
    expect(prediction.points[1]!.x).toBeCloseTo(375, 6);
    expect(prediction.points[1]!.y).toBeCloseTo(700 + BOUNCE_GRID.blockHeight / 2 + BOUNCE_BOARD.ballRadius, 6);
  });

  it('瞄准角度夹在 ±75° 内，按下头永远朝上', () => {
    expect(aimToward({ x: BOUNCE_BOARD.launchX, y: 0 }).angleDeg).toBeCloseTo(0, 6);
    const right = aimToward({ x: BOUNCE_BOARD.launchX + 500, y: BOUNCE_BOARD.launchY });
    expect(right.angleDeg).toBeCloseTo(BOUNCE_AIM_LIMIT_DEG, 6);
    expect(right.y).toBeLessThan(0);
    const below = aimToward({ x: BOUNCE_BOARD.launchX, y: BOUNCE_BOARD.launchY + 300 });
    expect(below.angleDeg).toBeCloseTo(0, 6);
  });

  it('autoplay 瞄的是离发射器最近的方块中心', () => {
    const near = blockAt('near', 375, 600);
    const far = blockAt('far', 375, 380);
    const state = { ...createBounceGame(18), blocks: [far, near] };
    const plan = anticipate(state);
    expect(plan.block?.id).toBe('near');
    expect(plan.aim.x).toBeCloseTo(0, 6);
    expect(plan.aim.y).toBeCloseTo(-1, 6);
  });
});

describe('弹一弹：autoplay 无头直达', () => {
  it('固定种子下 3 轮在限定步数内清场，总分 = 27 块 × 3 颗星 + 连击分', () => {
    const result = playAutoplay(2026);
    expect(result.finished).toBe(true);
    expect(result.state.finished).toBe(true);
    expect(result.rounds.map((round) => round.round)).toEqual([1, 2, 3]);
    expect(result.rounds.map((round) => round.blocks)).toEqual([6, 9, 12]);
    expect(result.rounds.map((round) => round.bouncy)).toEqual([2, 2, 2]);
    expect(result.state.stars).toBe(27 * BOUNCE_STARS_PER_BLOCK);
    expect(result.score).toBe(result.state.stars + result.state.comboBonus);
    expect(result.score).toBeGreaterThanOrEqual(27 * BOUNCE_STARS_PER_BLOCK);
    expect(result.state.round).toBe(3);
    // 一局 ~10 秒模拟时间、8ms 一步；留足余量，但必须真的有限
    expect(result.steps).toBeLessThan(5000);
  });

  it('换几个种子也都能在限定步数内走完（布局随机不影响通关）', () => {
    for (const seed of [1, 7, 99, 123456]) {
      const result = playAutoplay(seed);
      expect(result.finished).toBe(true);
      expect(result.state.stars).toBe(27 * BOUNCE_STARS_PER_BLOCK);
      expect(result.score).toBe(result.state.stars + result.state.comboBonus);
      expect(result.score).toBeGreaterThanOrEqual(27 * BOUNCE_STARS_PER_BLOCK);
      expect(result.steps).toBeLessThan(5000);
    }
  });
});
