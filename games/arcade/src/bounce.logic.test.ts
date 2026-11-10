import { describe, expect, it } from 'vitest';
import {
  BOUNCE_AIM_LIMIT_DEG,
  BOUNCE_BOARD,
  BOUNCE_COMBO_BONUS,
  BOUNCE_DROP_EVERY_SHOTS,
  BOUNCE_GRID,
  BOUNCE_LEVEL_MAX,
  BOUNCE_LEVEL_MIN,
  BOUNCE_MAX_BLOCKS,
  BOUNCE_MAX_ROWS,
  BOUNCE_STARS_PER_BLOCK,
  BOUNCE_STEP_MS,
  DEFAULT_AIM,
  advanceBounce,
  aimToward,
  anticipate,
  bounceBlocksForLevel,
  bounceConfigForLevel,
  buildRoundBlocks,
  canFire,
  createBounceGame,
  fireBall,
  launchPointFor,
  normalizeBounceLevel,
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

  it('从上方或下方飞出去：球回到发射器（不失败，也不结束这一局）', () => {
    const top = onlyBall(createBounceGame(4), ballAt(375, BOUNCE_BOARD.top, 0, -1500));
    const afterTop = advanceSteps(top, 2);
    expect(afterTop.balls).toHaveLength(0);
    expect(afterTop.finished).toBe(false);

    const bottom = onlyBall(createBounceGame(5), ballAt(375, BOUNCE_BOARD.floor + 20, 0, 1500));
    const afterBottom = advanceBounce(bottom, BOUNCE_STEP_MS).state;
    expect(afterBottom.balls).toHaveLength(0);
  });

  it('反弹满 8 次就回发射器（第 8 次撞碎的方块仍然算数）', () => {
    const start = onlyBall(createBounceGame(6), ballAt(WALL_LEFT + 4, 700, -1500, 0, 7));
    const state = advanceBounce(start, BOUNCE_STEP_MS).state;
    expect(state.balls).toHaveLength(0);
  });

  it('大 dt 与逐帧推进等价：位置/方块/装弹进度/累加器都一致', () => {
    // 真机卡顿或切后台回来时 onFrame 可能一次给 200ms；accumMs 必须把不足一步的余量
    // 留到下一帧，不能丢也不能多走 —— 这里用一个已经发射的球做对照：
    // 一次 200ms = 25 次 8ms（装弹 900ms 同步扣减）。
    const base = fireBall(createBounceGame(21), DEFAULT_AIM).state;
    expect(base.reloadLeftMs).toBe(BOUNCE_BOARD.reloadMs);

    let small = base;
    for (let index = 0; index < 200 / BOUNCE_STEP_MS; index += 1) {
      small = advanceBounce(small, BOUNCE_STEP_MS).state;
    }
    const big = advanceBounce(base, 200).state;

    expect(big.balls).toEqual(small.balls);
    expect(big.blocks).toEqual(small.blocks);
    expect(big.accumMs).toBe(small.accumMs);
    expect(big.reloadLeftMs).toBe(small.reloadLeftMs);
    expect(big.reloadLeftMs).toBe(BOUNCE_BOARD.reloadMs - 200);
    expect(big.accumMs).toBe(0);

    // 非整数倍：余量留在 accumMs 里，下一次接着走
    const residual = advanceBounce(base, BOUNCE_STEP_MS + 3).state;
    expect(residual.accumMs).toBe(3);
    expect(residual.balls[0]!.y).toBeCloseTo(base.balls[0]!.y - 12, 6);
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
    expect(state.finished).toBe(true);
  });

  it('最后一块碎掉时这一局立即结算（finished），星星不会重复计', () => {
    const only = blockAt('last', 375, 700);
    const start = onlyBall(createBounceGame(9), ballAt(375, 760, 0, -1500), [only]);
    const result = advanceBounce(start, BOUNCE_STEP_MS);

    expect(result.events.finished).toBe(true);
    expect(result.state.finished).toBe(true);
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
    expect(state.shots).toBe(BOUNCE_DROP_EVERY_SHOTS - 1);
    expect(state.drops).toBe(0);
    expect(state.blocks.map((block) => block.y)).toEqual(before);

    const sixth = fireBall(state, DEFAULT_AIM);
    expect(sixth.state.drops).toBe(1);
    expect(sixth.state.blocks.map((block) => block.y)).toEqual(
      before.map((y) => y + BOUNCE_GRID.dropStep),
    );
  });

  it('方块贴到底部不失败：全部开出小花飞走、星星计入、这一局直接结算', () => {
    const base = createBounceGame(13);
    const nearBottom = base.blocks.map((block) => ({
      ...block,
      y: BOUNCE_GRID.flowerLine - BOUNCE_GRID.dropStep + 10,
    }));
    const state: BounceState = { ...base, blocks: nearBottom, shots: 5 };
    const shot = fireBall(state, DEFAULT_AIM);

    expect(shot.events.flowered).toHaveLength(6);
    expect(shot.events.finished).toBe(true);
    expect(shot.state.stars).toBe(6 * BOUNCE_STARS_PER_BLOCK);
    expect(shot.state.finished).toBe(true);
    expect(shot.state.balls).toHaveLength(0);
    expect(remainingBlocks(shot.state)).toBe(0);
  });

  it('一局只有一轮：finished 之后继续推进也不会开下一轮', () => {
    const only = blockAt('last', 375, 700);
    const start = onlyBall(createBounceGame(14), ballAt(375, 760, 0, -1500), [only]);
    const first = advanceBounce(start, BOUNCE_STEP_MS);
    expect(first.events.finished).toBe(true);
    expect(first.state.finished).toBe(true);

    // 就算再等很久也不会冒出第 2 轮的新棋盘：状态原样返回
    const later = advanceBounce(first.state, 10_000);
    expect(later.state).toBe(first.state);
    expect(later.events.finished).toBe(false);
    expect(later.state.blocks).toHaveLength(1);
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

describe('弹一弹：autoplay 无头直达（一局一轮）', () => {
  it('固定种子下 6 块全部收齐并在限定步数内结算，总分 = 6 块 × 3 颗星 + 连击分', () => {
    const result = playAutoplay(2026);
    expect(result.finished).toBe(true);
    expect(result.state.finished).toBe(true);
    expect(result.state.level).toBe(1);
    expect(result.state.blocks).toHaveLength(6);
    expect(result.state.stars).toBe(6 * BOUNCE_STARS_PER_BLOCK);
    expect(result.score).toBe(result.state.stars + result.state.comboBonus);
    expect(result.score).toBeGreaterThanOrEqual(6 * BOUNCE_STARS_PER_BLOCK);
    // 单轮 ~600 步（8ms 一步 ≈ 5 秒模拟）；留足余量，但必须真的有限
    expect(result.steps).toBeLessThan(2000);
  });

  it('换几个种子也都能在限定步数内结算（布局随机不影响打完）', () => {
    for (const seed of [1, 7, 99, 123456]) {
      const result = playAutoplay(seed);
      expect(result.finished).toBe(true);
      expect(result.state.stars).toBe(6 * BOUNCE_STARS_PER_BLOCK);
      expect(result.score).toBe(result.state.stars + result.state.comboBonus);
      expect(result.score).toBeGreaterThanOrEqual(6 * BOUNCE_STARS_PER_BLOCK);
      expect(result.steps).toBeLessThan(2000);
    }
  });
});

describe('弹一弹：难度等级（level）', () => {
  /** 旧版第 1 轮参数：一局一局改版后，level=1 的单轮参数必须与它完全一致 */
  const LEVEL_ONE_ROUND = { blocks: 6, bouncy: 2 };

  it('level=1 与旧版第 1 轮参数一致，且默认开局就是 level 1', () => {
    expect(bounceConfigForLevel(1)).toEqual(LEVEL_ONE_ROUND);
    expect(bounceConfigForLevel(BOUNCE_LEVEL_MIN)).toEqual(LEVEL_ONE_ROUND);
    expect(bounceBlocksForLevel(1)).toBe(LEVEL_ONE_ROUND.blocks);
    expect(createBounceGame(2026).level).toBe(1);
    expect(createBounceGame(2026, {}).level).toBe(1);
    const first = createBounceGame(2026);
    expect(first.blocks).toHaveLength(LEVEL_ONE_ROUND.blocks);
    expect(first.blocks.filter((block) => block.kind === 'bouncy')).toHaveLength(
      LEVEL_ONE_ROUND.bouncy,
    );
    // 同一种子棋盘完全可复现（level 只改数量，不破坏确定性）
    expect(createBounceGame(2026).blocks).toEqual(first.blocks);
  });

  it('方块数随等级单调不减（每级 +1），且始终不超棋盘容量', () => {
    const seen: number[] = [];
    for (let level = BOUNCE_LEVEL_MIN; level <= BOUNCE_LEVEL_MAX; level += 1) {
      const blocks = bounceBlocksForLevel(level);
      expect(blocks).toBeGreaterThanOrEqual(LEVEL_ONE_ROUND.blocks);
      expect(blocks).toBeLessThanOrEqual(BOUNCE_MAX_BLOCKS);
      expect(Math.ceil(blocks / BOUNCE_GRID.columns)).toBeLessThanOrEqual(BOUNCE_MAX_ROWS);
      if (seen.length > 0) {
        expect(blocks).toBeGreaterThanOrEqual(seen[seen.length - 1]!);
      }
      // 弹弹方块数量保持不变：难度只从方块数来，level=1 才能与旧版逐帧一致
      expect(bounceConfigForLevel(level)).toEqual({ blocks, bouncy: LEVEL_ONE_ROUND.bouncy });
      seen.push(blocks);
    }
    // 最高等级确实更难：比 level=1 多 11 块
    expect(bounceBlocksForLevel(BOUNCE_LEVEL_MAX)).toBe(
      LEVEL_ONE_ROUND.blocks + (BOUNCE_LEVEL_MAX - 1),
    );
  });

  it('等级越界兜底：0 / 负数 / NaN / 无穷 → 1，超过上限 → 12', () => {
    expect(normalizeBounceLevel(0)).toBe(1);
    expect(normalizeBounceLevel(-3)).toBe(1);
    expect(normalizeBounceLevel(Number.NaN)).toBe(1);
    expect(normalizeBounceLevel(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeBounceLevel(BOUNCE_LEVEL_MAX + 1)).toBe(BOUNCE_LEVEL_MAX);
    expect(normalizeBounceLevel(999)).toBe(BOUNCE_LEVEL_MAX);

    // 越界值传进 createBounceGame 也按兜底后的等级开局，不会卡在 0 或 13
    expect(createBounceGame(7, { level: 0 }).level).toBe(1);
    expect(createBounceGame(7, { level: -9 }).level).toBe(1);
    expect(createBounceGame(7, { level: Number.NaN }).level).toBe(1);
    expect(createBounceGame(7, { level: 999 }).level).toBe(BOUNCE_LEVEL_MAX);
    expect(createBounceGame(7, { level: 999 }).blocks).toHaveLength(
      bounceBlocksForLevel(BOUNCE_LEVEL_MAX),
    );
  });

  it('各等级的单轮棋盘都摆得进棋盘：5 行以内、不越界、开局不贴开花线', () => {
    for (const level of [1, 6, BOUNCE_LEVEL_MAX]) {
      const blocks = buildRoundBlocks(4242, level);
      expect(blocks).toHaveLength(bounceBlocksForLevel(level));
      expect(blocks.filter((block) => block.kind === 'bouncy')).toHaveLength(
        LEVEL_ONE_ROUND.bouncy,
      );
      // id 不能重复：同一局里布局位置唯一
      expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
      for (const block of blocks) {
        expect(block.row).toBeGreaterThanOrEqual(0);
        expect(block.row).toBeLessThan(BOUNCE_MAX_ROWS);
        expect(block.y).toBeGreaterThan(BOUNCE_BOARD.top);
        expect(block.y).toBeLessThan(BOUNCE_GRID.flowerLine);
        expect(block.x - block.w / 2).toBeGreaterThanOrEqual(BOUNCE_BOARD.left);
        expect(block.x + block.w / 2).toBeLessThanOrEqual(BOUNCE_BOARD.right);
      }
    }
  });

  it('level=12 时 autoplay 一局一轮也能快速跑完（不卡死、不失败、不会开第二轮）', () => {
    const expectStars = bounceBlocksForLevel(BOUNCE_LEVEL_MAX) * BOUNCE_STARS_PER_BLOCK;
    for (const seed of [2026, 7, 99]) {
      const result = playAutoplay(seed, { level: BOUNCE_LEVEL_MAX });
      expect(result.finished).toBe(true);
      expect(result.state.finished).toBe(true);
      expect(result.state.level).toBe(BOUNCE_LEVEL_MAX);
      expect(result.state.blocks).toHaveLength(bounceBlocksForLevel(BOUNCE_LEVEL_MAX));
      // 每块 3 颗星：碎掉或开花都会收走，一块不少
      expect(result.state.stars).toBe(expectStars);
      expect(result.steps).toBeLessThan(4000);

      // 结算后再推进时间也不会冒出第 2 轮新棋盘
      const later = advanceBounce(result.state, 10_000);
      expect(later.state).toBe(result.state);
    }
  });
});
