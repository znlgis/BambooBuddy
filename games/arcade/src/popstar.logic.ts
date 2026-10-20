/**
 * 消灭星星的纯逻辑：棋盘 / 连通组 / 消除与补星 / 三轮目标 / 无解兜底。
 *
 * 这一层不碰 Phaser、不读时钟、不取随机数：
 * - 棋盘与补星都由 seed 决定（同种子同结果，可复现、可单测）；
 * - 场景只把「种子」和「玩家点了哪一组」传进来，再把结果画出来。
 */
import { hashString, seededRandom } from './rng';

export const POPSTAR_COLS = 8;
export const POPSTAR_ROWS = 10;
export const POPSTAR_CELLS = POPSTAR_COLS * POPSTAR_ROWS;
export const POPSTAR_FAMILY_COUNT = 4;
/** 至少 2 颗连在一起才消；单颗点了什么也不会发生（不是失败） */
export const POPSTAR_MIN_GROUP = 2;
export const POPSTAR_ROUNDS = 3;
/** 三轮各要收集的星星数；一局最多 96 颗 */
export const POPSTAR_GOALS = [24, 32, 40] as const;
/** autoplay 每 120ms 替你点一次「当前最大的组」 */
export const POPSTAR_AUTO_STEP_MS = 120;
/** 8 秒没操作，就轻轻闪一下当前最大的组（不强制、不扣分） */
export const POPSTAR_HINT_AFTER_MS = 8000;

/** 四种「星星家族」：颜色之外还要有形状花纹，色盲也能分（画法在场景层） */
export type StarFamily = 0 | 1 | 2 | 3;
export type PopstarCell = StarFamily | null;
/** 行优先的一维棋盘，下标 = row * COLS + col；null = 空格 */
export type PopstarBoard = readonly PopstarCell[];
export type PopstarStatus = 'playing' | 'roundDone' | 'done';

export interface PopstarState {
  readonly seed: number;
  /** 0-based 轮次 */
  readonly round: number;
  readonly board: PopstarBoard;
  /** 本轮已收集 */
  readonly collected: number;
  /** 整局累计（就是场景最后 finish 的分数） */
  readonly score: number;
  readonly status: PopstarStatus;
  /** 成功消过几次：给补星种子加盐，让每次补出来的序列不同 */
  readonly pops: number;
  /** 整局因无解而「飞回天上」收走的星星数 */
  readonly autoCollectedTotal: number;
}

/** 正常开局只传 seed；固定棋盘只在测试 / 调试里用 */
export interface PopstarStateOptions {
  readonly board?: PopstarBoard;
  readonly round?: number;
  readonly collected?: number;
  readonly score?: number;
  readonly status?: PopstarStatus;
  readonly pops?: number;
  readonly autoCollectedTotal?: number;
}

export interface PopResult {
  /** 这一下消掉的星星数（0 = 这一下没有可消的组，状态原样返回） */
  readonly popped: number;
  /** 因为棋盘无解而自动飞回天上的星星数 */
  readonly autoCollected: number;
  readonly state: PopstarState;
  /** 本轮是否完成（场景据此放「完成啦」并进入下一轮） */
  readonly roundDone: boolean;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createEmptyBoard(): PopstarCell[] {
  return new Array<PopstarCell>(POPSTAR_CELLS).fill(null);
}

function assertBoard(board: PopstarBoard): PopstarBoard {
  if (board.length !== POPSTAR_CELLS) {
    throw new Error(`popstar: 棋盘应有 ${POPSTAR_CELLS} 格，实际 ${board.length} 格`);
  }
  for (const cell of board) {
    if (cell !== null && (!Number.isInteger(cell) || cell < 0 || cell >= POPSTAR_FAMILY_COUNT)) {
      throw new Error('popstar: 棋盘里混进了未知的星星家族');
    }
  }
  return board;
}

function randomFamily(random: () => number): StarFamily {
  const roll = Math.floor(random() * POPSTAR_FAMILY_COUNT);
  return Math.max(0, Math.min(POPSTAR_FAMILY_COUNT - 1, roll)) as StarFamily;
}

/** 同一格的 4 个邻居（上下左右；不包含斜角，也不能跨行绕回） */
export function neighborIndices(index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= POPSTAR_CELLS) return [];
  const row = Math.floor(index / POPSTAR_COLS);
  const col = index % POPSTAR_COLS;
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(index - POPSTAR_COLS);
  if (row < POPSTAR_ROWS - 1) neighbors.push(index + POPSTAR_COLS);
  if (col > 0) neighbors.push(index - 1);
  if (col < POPSTAR_COLS - 1) neighbors.push(index + 1);
  return neighbors;
}

/** 从某一格出发，沿 4 邻接找同家族的整组（空格的组是空数组） */
export function findGroup(board: PopstarBoard, index: number): readonly number[] {
  if (!Number.isInteger(index) || index < 0 || index >= POPSTAR_CELLS) return [];
  const family = board[index];
  if (family === null) return [];
  const seen = new Set<number>([index]);
  const stack: number[] = [index];
  const group: number[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    group.push(current);
    for (const neighbor of neighborIndices(current)) {
      if (seen.has(neighbor)) continue;
      if (board[neighbor] !== family) continue;
      seen.add(neighbor);
      stack.push(neighbor);
    }
  }
  return group.sort((a, b) => a - b);
}

/** 当前最大的组（不到 2 颗就不算「可消」，返回空数组）；同大小时取靠前的那组 */
export function largestGroup(board: PopstarBoard): readonly number[] {
  const visited = new Set<number>();
  let best: readonly number[] = [];
  for (let index = 0; index < board.length; index += 1) {
    if (visited.has(index) || board[index] === null) continue;
    const group = findGroup(board, index);
    for (const member of group) visited.add(member);
    if (group.length > best.length) best = group;
  }
  return best.length >= POPSTAR_MIN_GROUP ? best : [];
}

function canonicalGroup(board: PopstarBoard, group: readonly number[]): readonly number[] | null {
  if (group.length < POPSTAR_MIN_GROUP) return null;
  const unique = [...new Set(group)];
  if (unique.length !== group.length) return null;
  const first = unique[0];
  if (first === undefined || !Number.isInteger(first) || first < 0 || first >= POPSTAR_CELLS) return null;
  const family = board[first];
  if (family === null) return null;
  for (const index of unique) {
    if (!Number.isInteger(index) || index < 0 || index >= POPSTAR_CELLS) return null;
    if (board[index] !== family) return null;
  }
  const members = new Set(unique);
  const seen = new Set<number>([first]);
  const stack: number[] = [first];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const neighbor of neighborIndices(current)) {
      if (!members.has(neighbor) || seen.has(neighbor)) continue;
      seen.add(neighbor);
      stack.push(neighbor);
    }
  }
  if (seen.size !== members.size) return null;
  // 只接受「整组」：点一颗就把连着的全消掉，不许只交半组
  if (findGroup(board, first).length !== unique.length) return null;
  return unique.sort((a, b) => a - b);
}

/** 这一组是否真的能消：同家族、4 邻接、至少 2 颗、不重复，而且必须是完整的一组 */
export function isValidGroup(board: PopstarBoard, group: readonly number[]): boolean {
  return canonicalGroup(board, group) !== null;
}

export function filledCount(board: PopstarBoard): number {
  let count = 0;
  for (const cell of board) {
    if (cell !== null) count += 1;
  }
  return count;
}

/**
 * 补星时如果随机出了「一盘死棋」，把左上角两颗改成同家族兜底。
 * 保证棋盘永远有下一步可走，autoplay 与真实玩家都不会空转。
 */
function makeSolvable(board: PopstarBoard, random: () => number): PopstarBoard {
  if (largestGroup(board).length >= POPSTAR_MIN_GROUP) return board;
  const next = [...board];
  const family = randomFamily(random);
  next[0] = family;
  next[1] = family;
  return next;
}

/** 按种子发一副可以玩的棋盘（同 seed + salt 永远同一副） */
export function dealBoard(seed: number, salt = ''): PopstarBoard {
  const random = seededRandom(hashString(`${seed >>> 0}:${salt}`));
  const board = createEmptyBoard();
  for (let index = 0; index < POPSTAR_CELLS; index += 1) board[index] = randomFamily(random);
  return makeSolvable(board, random);
}

/**
 * 消除与补星：被消掉的格子挖空，每列剩下的星星落到底部，顶部补新星。
 * 新星完全由 seed + 轮次 + 第几次消决定 —— 同种子同输入，棋盘必然一样。
 */
function collapseAndRefill(
  board: PopstarBoard,
  removed: ReadonlySet<number>,
  random: () => number,
): PopstarBoard {
  const next = createEmptyBoard();
  for (let col = 0; col < POPSTAR_COLS; col += 1) {
    let writeRow = POPSTAR_ROWS - 1;
    for (let row = POPSTAR_ROWS - 1; row >= 0; row -= 1) {
      const index = row * POPSTAR_COLS + col;
      if (removed.has(index)) continue;
      const cell = board[index];
      if (cell === null) continue;
      next[writeRow * POPSTAR_COLS + col] = cell;
      writeRow -= 1;
    }
    for (let row = writeRow; row >= 0; row -= 1) {
      next[row * POPSTAR_COLS + col] = randomFamily(random);
    }
  }
  return makeSolvable(next, random);
}

export function goalForRound(round: number): number {
  const index = clampInt(round, 0, POPSTAR_ROUNDS - 1);
  return POPSTAR_GOALS[index] ?? POPSTAR_GOALS[0];
}

export function remainingToGoal(state: PopstarState): number {
  return Math.max(0, goalForRound(state.round) - state.collected);
}

/** 0–1，竹筐里的填充比例 */
export function roundProgress(state: PopstarState): number {
  return clampInt(state.collected, 0, goalForRound(state.round)) / goalForRound(state.round);
}

/** 组越大音调越高（场景用来放「叮」的一声） */
export function popTone(size: number): number {
  const safeSize = Math.max(POPSTAR_MIN_GROUP, Math.floor(size));
  return Math.min(1180, 420 + safeSize * 42);
}

/** 空棋盘没有任何组时：剩下的星星飞回天上计入收集，然后补一副新棋盘（绝不失败） */
function settleNoMove(state: PopstarState): { state: PopstarState; autoCollected: number } {
  if (state.status !== 'playing' || largestGroup(state.board).length >= POPSTAR_MIN_GROUP) {
    return { state, autoCollected: 0 };
  }
  const remaining = filledCount(state.board);
  if (remaining === 0) {
    const board = dealBoard(state.seed, `round:${state.round}:empty:${state.pops}`);
    return { state: { ...state, board }, autoCollected: 0 };
  }
  const collected = state.collected + remaining;
  const next: PopstarState = {
    ...state,
    collected,
    score: state.score + remaining,
    autoCollectedTotal: state.autoCollectedTotal + remaining,
    status: collected >= goalForRound(state.round) ? 'roundDone' : 'playing',
  };
  if (next.status === 'roundDone') {
    return { state: { ...next, board: createEmptyBoard() }, autoCollected: remaining };
  }
  const board = dealBoard(state.seed, `round:${state.round}:auto:${state.pops}`);
  return { state: { ...next, board }, autoCollected: remaining };
}

export function createPopstarState(seed: number, options: PopstarStateOptions = {}): PopstarState {
  const round = clampInt(options.round ?? 0, 0, POPSTAR_ROUNDS - 1);
  const board = options.board === undefined ? dealBoard(seed, `round:${round}`) : assertBoard(options.board);
  const collected = Math.max(0, Math.floor(options.collected ?? 0));
  return {
    seed: seed >>> 0,
    round,
    board,
    collected,
    score: Math.max(collected, Math.floor(options.score ?? collected)),
    status: options.status ?? 'playing',
    pops: Math.max(0, Math.floor(options.pops ?? 0)),
    autoCollectedTotal: Math.max(0, Math.floor(options.autoCollectedTotal ?? 0)),
  };
}

/**
 * 唯一的消除入口：真实点击与 autoplay 都走这里。
 * 传进来的组会重新校验；无效 / 单颗只交给「无解兜底」看一眼，什么都不扣。
 */
export function tryPop(state: PopstarState, group: readonly number[]): PopResult {
  if (state.status !== 'playing') {
    return { popped: 0, autoCollected: 0, state, roundDone: state.status === 'roundDone' };
  }
  const valid = canonicalGroup(state.board, group);
  if (valid === null) {
    const settled = settleNoMove(state);
    return {
      popped: 0,
      autoCollected: settled.autoCollected,
      state: settled.state,
      roundDone: settled.state.status === 'roundDone',
    };
  }

  const removed = new Set(valid);
  const popped = valid.length;
  const random = seededRandom(hashString(`${state.seed}:refill:${state.round}:${state.pops + 1}`));
  const collected = state.collected + popped;
  let next: PopstarState = {
    ...state,
    board: collapseAndRefill(state.board, removed, random),
    collected,
    score: state.score + popped,
    status: collected >= goalForRound(state.round) ? 'roundDone' : 'playing',
    pops: state.pops + 1,
  };

  let autoCollected = 0;
  if (next.status === 'playing') {
    const settled = settleNoMove(next);
    next = settled.state;
    autoCollected = settled.autoCollected;
  }
  return { popped, autoCollected, state: next, roundDone: next.status === 'roundDone' };
}

/** 本轮完成后进入下一轮；第三轮完成 → done（场景随后 finish(score)） */
export function advanceRound(state: PopstarState): PopstarState {
  if (state.status !== 'roundDone') return state;
  const nextRound = state.round + 1;
  if (nextRound >= POPSTAR_ROUNDS) {
    return { ...state, status: 'done', board: createEmptyBoard() };
  }
  return {
    ...state,
    round: nextRound,
    board: dealBoard(state.seed, `round:${nextRound}`),
    collected: 0,
    pops: 0,
    status: 'playing',
  };
}
