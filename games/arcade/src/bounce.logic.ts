/**
 * 弹一弹（Bounce）的纯逻辑。
 *
 * 这里没有 Phaser、没有 Math.random / Date.now / localStorage / fetch：
 * 随机来自种子，时间由调用方按毫秒推进，所有函数都返回新状态。
 * 场景只做三件事：把指针喂给 aimToward / fireBall、每帧 advanceBounce、把结果画出来。
 *
 * 儿童向约束：
 * - 没有失败：方块贴到底部时"开出小花"飞走并计入收集，本轮直接完成；
 * - 没有数字血量：任何方块 1 击碎；
 * - 同时最多 3 颗球，反弹 8 次或飞出边界后回发射器，装弹 0.9 秒；
 * - 每发射 6 次方块整体下沉一格（越玩越紧，但不惩罚）。
 */
import { seededRandom, shuffled } from './rng';

/** 棋盘几何：逻辑与场景共用同一组数字，避免"判定在一处、画面在另一处" */
export const BOUNCE_BOARD = {
  left: 40,
  right: 710,
  top: 260,
  floor: 1120,
  launchX: 375,
  launchY: 1044,
  ballRadius: 16,
  maxBalls: 3,
  maxBounces: 8,
  reloadMs: 900,
  /** 球速：8ms 一步走 12px，正好小于球半径，不会穿块 */
  shotSpeed: 1500,
  /** 弹弹方块：命中后球更快一点，作为"变化"而不是压力 */
  bouncyBoost: 1.18,
  maxSpeedScale: 1.7,
} as const;

/** 方块网格：4 列，按内容数量均衡成 3/3/3 或 4/4/4 排 */
export const BOUNCE_GRID = {
  columns: 4,
  rowTop: 400,
  rowStep: 100,
  blockWidth: 142,
  blockHeight: 84,
  /** 每下沉一格，所有方块 +100 */
  dropStep: 100,
  /** 方块中心掉到这条线以下 = 贴底：本轮全部开花结束（不失败） */
  flowerLine: 950,
} as const;

/** 固定步长（毫秒）：测试与 autoplay 都按它推进，慢手机和 CI 结果一致 */
export const BOUNCE_STEP_MS = 8;
/** 一轮结束后停留多久再开下一轮（画面上的"完成啦"反馈） */
export const BOUNCE_ROUND_PAUSE_MS = 1400;
/** 瞄准离竖直向上的最大角度：球永远往上打 */
export const BOUNCE_AIM_LIMIT_DEG = 75;
export const BOUNCE_STARS_PER_BLOCK = 3;
export const BOUNCE_DROP_EVERY_SHOTS = 6;
/** 同一发里击碎第 2、3… 块时，每多一块额外 +5 分（连击奖励） */
export const BOUNCE_COMBO_BONUS = 5;

export interface BounceRoundConfig {
  readonly blocks: number;
  readonly bouncy: number;
}

/** 一局 3 轮：6 / 9 / 12 个方块，每轮混 2 个弹弹方块 */
export const BOUNCE_ROUNDS: readonly BounceRoundConfig[] = [
  { blocks: 6, bouncy: 2 },
  { blocks: 9, bouncy: 2 },
  { blocks: 12, bouncy: 2 },
];

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface BounceAim {
  /** 单位方向向量，y 向上为负 */
  readonly x: number;
  readonly y: number;
  /** 与竖直向上的夹角（度，右正左负），给 HUD / 测试看 */
  readonly angleDeg: number;
}

/** 竖直向上的默认瞄准：一进场就有方向 */
export const DEFAULT_AIM: BounceAim = { x: 0, y: -1, angleDeg: 0 };

export type BounceBlockKind = 'brick' | 'bouncy';

export interface BounceBlock {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly kind: BounceBlockKind;
  readonly alive: boolean;
}

export interface BounceBall {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** 已经反弹了几次（撞墙 + 撞块），到 8 就回家 */
  readonly bounces: number;
  /** 这一发已经击碎了几块：第 2 块起算连击，换一发就归零 */
  readonly hits: number;
}

export interface BounceState {
  readonly seed: number;
  /** 1..BOUNCE_ROUNDS.length */
  readonly round: number;
  readonly blocks: readonly BounceBlock[];
  readonly balls: readonly BounceBall[];
  /** 已收集的星星（每块 3 颗，开花也算） */
  readonly stars: number;
  /** 连击奖励累计：同一发击碎第 2、3… 块时每块 +5 */
  readonly comboBonus: number;
  readonly shotsThisRound: number;
  readonly shotsTotal: number;
  readonly drops: number;
  /** 装弹剩余（毫秒）；0 表示可以再发射 */
  readonly reloadLeftMs: number;
  /** 本轮结束后的停留倒计时 */
  readonly roundPauseLeftMs: number;
  /** 物理累加器：不足一步的毫秒留到下一帧，保证定步长 */
  readonly accumMs: number;
  readonly nextBallId: number;
  readonly roundDone: boolean;
  readonly finished: boolean;
}

export interface BounceEvents {
  /** 被打碎的方块（本轮内） */
  readonly broken: readonly BounceBlock[];
  /** 贴底开花飞走的方块（也算收集） */
  readonly flowered: readonly BounceBlock[];
  readonly reloaded: boolean;
  readonly roundCompleted: number | null;
  readonly roundStarted: number | null;
  readonly finished: boolean;
}

export interface BounceAdvanceResult {
  readonly state: BounceState;
  readonly events: BounceEvents;
}

export interface BounceFireResult {
  readonly state: BounceState;
  readonly fired: boolean;
  readonly events: BounceEvents;
}

export interface BouncePrediction {
  /** 从发射点开始的折线；最后一个点是打中方块 / 飞出边界 / 第二反弹点后的尾线端点 */
  readonly points: readonly Vec2[];
  /** 真正发生反弹的位置，最多 maxBounces 个 */
  readonly bouncePoints: readonly Vec2[];
  /** 这次预测会先命中的方块 */
  readonly hitBlockId: string | null;
}

export interface BounceAnticipate {
  /** 离发射器最近的活方块（没有则 null） */
  readonly block: BounceBlock | null;
  readonly aim: BounceAim;
}

export interface BounceAutoplayOptions {
  readonly maxSteps?: number;
  readonly stepMs?: number;
}

export interface BounceRoundSnapshot {
  readonly round: number;
  readonly blocks: number;
  readonly bouncy: number;
}

export interface BounceAutoplayResult {
  readonly state: BounceState;
  readonly steps: number;
  readonly finished: boolean;
  readonly score: number;
  readonly rounds: readonly BounceRoundSnapshot[];
}

interface MutableEvents {
  broken: BounceBlock[];
  flowered: BounceBlock[];
  reloaded: boolean;
  roundCompleted: number | null;
  roundStarted: number | null;
  finished: boolean;
}

const MAX_STEPS_PER_ADVANCE = 128;
const PREDICT_TAIL = 180;

function emptyEvents(): MutableEvents {
  return {
    broken: [],
    flowered: [],
    reloaded: false,
    roundCompleted: null,
    roundStarted: null,
    finished: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function aliveCount(blocks: readonly BounceBlock[]): number {
  let count = 0;
  for (const block of blocks) if (block.alive) count += 1;
  return count;
}

/** 发球点：从发射口沿瞄准方向抬高一点，球不会从挡板里出生 */
export function launchPointFor(aim: BounceAim): Vec2 {
  const distance = 44;
  return {
    x: BOUNCE_BOARD.launchX + aim.x * distance,
    y: BOUNCE_BOARD.launchY + aim.y * distance,
  };
}

/**
 * 把任意一个指针位置换算成向上的瞄准方向。
 * 按在发射器上方 = 指向哪里打哪里；按在两侧/下方时夹到 ±75°，球永远往上走。
 */
export function aimToward(point: Vec2): BounceAim {
  const dx = point.x - BOUNCE_BOARD.launchX;
  const up = BOUNCE_BOARD.launchY - point.y;
  const limit = (BOUNCE_AIM_LIMIT_DEG * Math.PI) / 180;
  let angle: number;
  if (up <= 0) {
    const side = Math.sign(dx);
    angle = side === 0 ? 0 : side * limit;
  } else {
    angle = clamp(Math.atan2(dx, up), -limit, limit);
  }
  return {
    x: Math.sin(angle),
    y: -Math.cos(angle),
    angleDeg: (angle * 180) / Math.PI,
  };
}

/** 这一帧能不能再发一颗球（自动通关也走这个判定） */
export function canFire(state: BounceState): boolean {
  return (
    !state.roundDone &&
    !state.finished &&
    state.reloadLeftMs <= 0 &&
    state.balls.length < BOUNCE_BOARD.maxBalls
  );
}

/** 当前还活着的方块数（HUD 的"再打碎 n 个"） */
export function remainingBlocks(state: BounceState): number {
  return aliveCount(state.blocks);
}

/** 一局的分数 = 收集到的星星（每块 3 颗，开花也算）+ 连击奖励 */
export function scoreOf(state: BounceState): number {
  return state.stars + state.comboBonus;
}

/** 离发射器最近的活方块：autoplay 就瞄它的中心 */
export function autoplayTarget(state: BounceState): BounceBlock | null {
  let best: BounceBlock | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const block of state.blocks) {
    if (!block.alive) continue;
    const distance = Math.hypot(block.x - BOUNCE_BOARD.launchX, block.y - BOUNCE_BOARD.launchY);
    if (distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }
  return best;
}

/** autoplay 的"看"：瞄准最近的方块中心（与真实拖拽共用 aimToward / fireBall） */
export function anticipate(state: BounceState): BounceAnticipate {
  const block = autoplayTarget(state);
  if (!block) return { block: null, aim: DEFAULT_AIM };
  return { block, aim: aimToward({ x: block.x, y: block.y }) };
}

export function createBounceGame(seed: number): BounceState {
  return startRound(
    {
      seed: seed >>> 0,
      round: 1,
      blocks: [],
      balls: [],
      stars: 0,
      comboBonus: 0,
      shotsThisRound: 0,
      shotsTotal: 0,
      drops: 0,
      reloadLeftMs: 0,
      roundPauseLeftMs: 0,
      accumMs: 0,
      nextBallId: 1,
      roundDone: false,
      finished: false,
    },
    1,
  );
}

/** 发射一颗球；第 6 / 12 / 18… 发会触发整体下沉（可能直接开花结束本轮） */
export function fireBall(state: BounceState, aim: BounceAim): BounceFireResult {
  const events = emptyEvents();
  if (!canFire(state)) return { state, fired: false, events };

  const origin = launchPointFor(aim);
  const speed = BOUNCE_BOARD.shotSpeed;
  const ball: BounceBall = {
    id: state.nextBallId,
    x: origin.x,
    y: origin.y,
    vx: aim.x * speed,
    vy: aim.y * speed,
    bounces: 0,
    hits: 0,
  };

  let next: BounceState = {
    ...state,
    balls: [...state.balls, ball],
    nextBallId: state.nextBallId + 1,
    shotsThisRound: state.shotsThisRound + 1,
    shotsTotal: state.shotsTotal + 1,
    reloadLeftMs: BOUNCE_BOARD.reloadMs,
  };

  if (next.shotsThisRound % BOUNCE_DROP_EVERY_SHOTS === 0) next = sinkBlocks(next, events);

  return { state: next, fired: true, events };
}

/**
 * 按固定步长推进一帧。dtMs 可以不是 8 的倍数，余数留在 accumMs 里。
 * 返回新的 state 与这一帧发生的事件（碎块 / 开花 / 换轮 / 结束）。
 */
export function advanceBounce(state: BounceState, dtMs: number): BounceAdvanceResult {
  const events = emptyEvents();
  if (state.finished) return { state, events };

  const delta = Math.max(0, dtMs);

  if (state.roundDone) {
    const left = state.roundPauseLeftMs - delta;
    if (left > 0) return { state: { ...state, roundPauseLeftMs: left }, events };
    if (state.round >= BOUNCE_ROUNDS.length) {
      events.finished = true;
      return { state: { ...state, roundDone: false, finished: true, roundPauseLeftMs: 0 }, events };
    }
    const next = startRound(state, state.round + 1);
    events.roundStarted = next.round;
    return { state: next, events };
  }

  let reloadLeftMs = state.reloadLeftMs;
  if (reloadLeftMs > 0) {
    reloadLeftMs = Math.max(0, reloadLeftMs - delta);
    if (reloadLeftMs === 0) events.reloaded = true;
  }

  let accumMs = state.accumMs + delta;
  let next = state;
  let steps = 0;
  while (accumMs >= BOUNCE_STEP_MS && steps < MAX_STEPS_PER_ADVANCE) {
    next = stepPhysics(next, events);
    accumMs -= BOUNCE_STEP_MS;
    steps += 1;
    if (next.roundDone || next.finished) {
      accumMs = 0;
      break;
    }
  }

  if (next.roundDone || next.finished) return { state: { ...next, accumMs }, events };
  return { state: { ...next, reloadLeftMs, accumMs }, events };
}

/**
 * 瞄准预测：从发射点出发，最多找两个反弹点；撞到方块就停在方块上（它就是要打的目标）。
 * 场景把 points 画成虚线、把 bouncePoints 画成小圆点。
 */
export function predictAim(
  state: BounceState,
  aim: BounceAim,
  maxBounces = 2,
): BouncePrediction {
  const limit = Math.max(1, Math.floor(maxBounces));
  const radius = BOUNCE_BOARD.ballRadius;
  const minX = BOUNCE_BOARD.left + radius;
  const maxX = BOUNCE_BOARD.right - radius;
  const topY = BOUNCE_BOARD.top - radius;

  const start = launchPointFor(aim);
  let originX = start.x;
  let originY = start.y;
  let dirX = aim.x;
  const dirY = aim.y;

  const points: Vec2[] = [{ x: originX, y: originY }];
  const bouncePoints: Vec2[] = [];
  let hitBlockId: string | null = null;

  for (let bounce = 0; bounce <= limit; bounce += 1) {
    let bestT = Number.POSITIVE_INFINITY;
    let kind: 'block' | 'wall' | 'top' = 'top';
    let blockHit: BounceBlock | null = null;
    let wallX = 0;

    for (const block of state.blocks) {
      if (!block.alive) continue;
      const t = rayAabb(
        originX,
        originY,
        dirX,
        dirY,
        block.x - block.w / 2 - radius,
        block.y - block.h / 2 - radius,
        block.x + block.w / 2 + radius,
        block.y + block.h / 2 + radius,
      );
      if (t !== null && t < bestT) {
        bestT = t;
        kind = 'block';
        blockHit = block;
      }
    }

    if (dirX > 0) {
      const t = (maxX - originX) / dirX;
      if (t > 1e-6 && t < bestT) {
        bestT = t;
        kind = 'wall';
        wallX = maxX;
      }
    } else if (dirX < 0) {
      const t = (minX - originX) / dirX;
      if (t > 1e-6 && t < bestT) {
        bestT = t;
        kind = 'wall';
        wallX = minX;
      }
    }

    if (dirY < 0) {
      const t = (topY - originY) / dirY;
      if (t > 1e-6 && t < bestT) {
        bestT = t;
        kind = 'top';
      }
    }

    if (!Number.isFinite(bestT)) break;

    const hitX = originX + dirX * bestT;
    const hitY = originY + dirY * bestT;
    points.push({ x: hitX, y: hitY });

    if (kind === 'block') {
      hitBlockId = blockHit === null ? null : blockHit.id;
      break;
    }
    if (kind === 'top') break;

    bouncePoints.push({ x: wallX, y: hitY });
    originX = hitX;
    originY = hitY;
    dirX = -dirX;

    if (bouncePoints.length >= limit) {
      // 两个反弹点已经给足信息，再补一小段尾线让虚线"看得出方向"
      points.push({ x: originX + dirX * PREDICT_TAIL, y: originY + dirY * PREDICT_TAIL });
      break;
    }
  }

  return { points, bouncePoints, hitBlockId };
}

/** 自动通关：瞄准最近的方块 → 发射 → 定步长推进，直到一局结束（测试与诊断用） */
export function playAutoplay(seed: number, options: BounceAutoplayOptions = {}): BounceAutoplayResult {
  const stepMs = Math.max(1, options.stepMs ?? BOUNCE_STEP_MS);
  const maxSteps = Math.max(1, options.maxSteps ?? 20_000);
  let state = createBounceGame(seed);
  const rounds: BounceRoundSnapshot[] = [snapshotRound(state)];
  let steps = 0;

  while (!state.finished && steps < maxSteps) {
    if (canFire(state)) {
      state = fireBall(state, anticipate(state).aim).state;
    }
    const advanced = advanceBounce(state, stepMs);
    state = advanced.state;
    if (advanced.events.roundStarted !== null) rounds.push(snapshotRound(state));
    steps += 1;
  }

  return { state, steps, finished: state.finished, score: scoreOf(state), rounds };
}

/* ------------------------------ 内部实现 ------------------------------ */

function startRound(state: BounceState, round: number): BounceState {
  return {
    ...state,
    round,
    blocks: buildRoundBlocks(state.seed, round),
    balls: [],
    shotsThisRound: 0,
    drops: 0,
    reloadLeftMs: 0,
    roundPauseLeftMs: 0,
    accumMs: 0,
    roundDone: false,
    finished: false,
  };
}

function buildRoundBlocks(seed: number, round: number): BounceBlock[] {
  const config = BOUNCE_ROUNDS[round - 1];
  if (config === undefined) return [];

  // 每轮一个独立的确定性种子：同一局里每轮布局不同，重开能复现
  const random = seededRandom((seed ^ Math.imul(round, 0x9e3779b1)) >>> 0);
  const rows = Math.ceil(config.blocks / BOUNCE_GRID.columns);
  const base = Math.floor(config.blocks / rows);
  const extra = config.blocks % rows;
  const cellWidth = (BOUNCE_BOARD.right - BOUNCE_BOARD.left) / BOUNCE_GRID.columns;
  const centerX = (BOUNCE_BOARD.left + BOUNCE_BOARD.right) / 2;

  const blocks: BounceBlock[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = base + (row < extra ? 1 : 0);
    for (let slot = 0; slot < count; slot += 1) {
      blocks.push({
        id: `b${round}-${index}`,
        col: slot,
        row,
        x: centerX + (slot - (count - 1) / 2) * cellWidth,
        y: BOUNCE_GRID.rowTop + row * BOUNCE_GRID.rowStep,
        w: BOUNCE_GRID.blockWidth,
        h: BOUNCE_GRID.blockHeight,
        kind: 'brick',
        alive: true,
      });
      index += 1;
    }
  }

  const bouncy = shuffled(
    blocks.map((_, position) => position),
    random,
  ).slice(0, config.bouncy);
  for (const position of bouncy) {
    const block = blocks[position];
    if (block !== undefined) blocks[position] = { ...block, kind: 'bouncy' };
  }
  return blocks;
}

function stepPhysics(state: BounceState, events: MutableEvents): BounceState {
  const dtSec = BOUNCE_STEP_MS / 1000;
  const radius = BOUNCE_BOARD.ballRadius;
  const minX = BOUNCE_BOARD.left + radius;
  const maxX = BOUNCE_BOARD.right - radius;

  const balls: BounceBall[] = [];
  let blocks = state.blocks;
  let stars = state.stars;
  let comboBonus = state.comboBonus;

  for (const ball of state.balls) {
    let next: BounceBall = {
      ...ball,
      x: ball.x + ball.vx * dtSec,
      y: ball.y + ball.vy * dtSec,
    };
    let bounces = next.bounces;

    // 左右墙：位置夹回场内，速度按镜面反射（y 不变）
    if (next.x < minX) {
      next = { ...next, x: minX, vx: Math.abs(next.vx) };
      bounces += 1;
    } else if (next.x > maxX) {
      next = { ...next, x: maxX, vx: -Math.abs(next.vx) };
      bounces += 1;
    }
    next = { ...next, bounces };

    // 上下都不是墙：从上方/下方飞出去 = 这颗球回家（不失败）
    if (next.y + radius < BOUNCE_BOARD.top || next.y - radius > BOUNCE_BOARD.floor) continue;

    const hit = findBlockHit(next, blocks);
    if (hit !== null) {
      next = reflectOffBlock(next, hit);
      blocks = blocks.map((block) => (block.id === hit.id ? { ...block, alive: false } : block));
      stars += BOUNCE_STARS_PER_BLOCK;
      // 同一发第 2 块起才是连击：每多一块 +5（不是按同帧不同球，也不是开花）
      const hits = next.hits + 1;
      if (hits >= 2) comboBonus += BOUNCE_COMBO_BONUS;
      events.broken.push({ ...hit, alive: false });
      next = { ...next, bounces: next.bounces + 1, hits };
    }

    // 反弹满 8 次就回发射器（第 8 次撞碎的方块仍然算数）
    if (next.bounces >= BOUNCE_BOARD.maxBounces) continue;
    balls.push(next);
  }

  let next: BounceState = { ...state, balls, blocks, stars, comboBonus };
  if (next.blocks.length > 0 && next.blocks.every((block) => !block.alive)) {
    next = completeRound(next, events);
  }
  return next;
}

function findBlockHit(ball: BounceBall, blocks: readonly BounceBlock[]): BounceBlock | null {
  const radius = BOUNCE_BOARD.ballRadius;
  let best: BounceBlock | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (!block.alive) continue;
    const closestX = clamp(ball.x, block.x - block.w / 2, block.x + block.w / 2);
    const closestY = clamp(ball.y, block.y - block.h / 2, block.y + block.h / 2);
    const distance = Math.hypot(ball.x - closestX, ball.y - closestY);
    if (distance < radius && distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }
  return best;
}

function reflectOffBlock(ball: BounceBall, block: BounceBlock): BounceBall {
  const radius = BOUNCE_BOARD.ballRadius;
  const halfW = block.w / 2;
  const halfH = block.h / 2;
  const insideX = Math.abs(ball.x - block.x) < halfW;
  const insideY = Math.abs(ball.y - block.y) < halfH;

  let nx: number;
  let ny: number;
  let px = ball.x;
  let py = ball.y;

  if (insideX && insideY) {
    // 球心已经进到方块里：朝最浅的那条边推出去
    const overlapX = halfW + radius - Math.abs(ball.x - block.x);
    const overlapY = halfH + radius - Math.abs(ball.y - block.y);
    if (overlapX < overlapY) {
      nx = Math.sign(ball.x - block.x) || 1;
      ny = 0;
      px = block.x + nx * (halfW + radius);
    } else {
      nx = 0;
      ny = Math.sign(ball.y - block.y) || -1;
      py = block.y + ny * (halfH + radius);
    }
  } else {
    const closestX = clamp(ball.x, block.x - halfW, block.x + halfW);
    const closestY = clamp(ball.y, block.y - halfH, block.y + halfH);
    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) {
      nx = 0;
      ny = -1;
    } else {
      nx = dx / distance;
      ny = dy / distance;
    }
    px = closestX + nx * radius;
    py = closestY + ny * radius;
  }

  const dot = ball.vx * nx + ball.vy * ny;
  let vx = ball.vx;
  let vy = ball.vy;
  if (dot < 0) {
    vx -= 2 * dot * nx;
    vy -= 2 * dot * ny;
  }

  if (block.kind === 'bouncy') {
    // 弹弹方块：反弹完更快一点，但封顶，避免越弹越失控
    const speed = Math.hypot(vx, vy);
    if (speed > 0) {
      const target = Math.min(
        speed * BOUNCE_BOARD.bouncyBoost,
        BOUNCE_BOARD.shotSpeed * BOUNCE_BOARD.maxSpeedScale,
      );
      const scale = target / speed;
      vx *= scale;
      vy *= scale;
    }
  }

  return { ...ball, x: px, y: py, vx, vy };
}

function sinkBlocks(state: BounceState, events: MutableEvents): BounceState {
  if (aliveCount(state.blocks) === 0) return state;

  const blocks = state.blocks.map((block) =>
    block.alive ? { ...block, y: block.y + BOUNCE_GRID.dropStep } : block,
  );
  let next: BounceState = { ...state, blocks, drops: state.drops + 1 };
  const touching = blocks.some((block) => block.alive && block.y >= BOUNCE_GRID.flowerLine);
  if (touching) next = completeRound(next, events);
  return next;
}

function completeRound(state: BounceState, events: MutableEvents): BounceState {
  const alive = state.blocks.filter((block) => block.alive);
  const blocks = state.blocks.map((block) => (block.alive ? { ...block, alive: false } : block));
  const stars = state.stars + alive.length * BOUNCE_STARS_PER_BLOCK;
  for (const block of alive) events.flowered.push({ ...block, alive: false });
  events.roundCompleted = state.round;

  return {
    ...state,
    blocks,
    stars,
    balls: [],
    roundDone: true,
    reloadLeftMs: 0,
    accumMs: 0,
    roundPauseLeftMs: BOUNCE_ROUND_PAUSE_MS,
  };
}

function rayAabb(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number | null {
  let tMin = Number.NEGATIVE_INFINITY;
  let tMax = Number.POSITIVE_INFINITY;

  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const t1 = (minX - ox) / dx;
    const t2 = (maxX - ox) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const t1 = (minY - oy) / dy;
    const t2 = (maxY - oy) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (tMax < 0 || tMin > tMax) return null;
  if (tMin > 1e-6) return tMin;
  return tMax > 1e-6 ? tMax : null;
}

function snapshotRound(state: BounceState): BounceRoundSnapshot {
  let bouncy = 0;
  for (const block of state.blocks) if (block.kind === 'bouncy') bouncy += 1;
  return { round: state.round, blocks: state.blocks.length, bouncy };
}
