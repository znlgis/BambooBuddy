/**
 * 俄罗斯方块（8 × 14，儿童向）的纯逻辑。
 *
 * 这里没有 Phaser、没有 Math.random / Date.now / localStorage / fetch：
 * 方块序列由种子决定，时间由调用方按 delta 推进，所有函数只返回新状态。
 * 场景层负责把按钮 / 滑动 / autoplay AI 都接到同一组 move / rotate / hardDrop 上。
 */
import { hashString, seededRandom, shuffled } from './rng';

export const TETRIS_COLS = 8;
export const TETRIS_ROWS = 14;
/** 一局消掉 3 行就完成（彩虹救援也计入进度） */
export const TETRIS_GOAL_LINES = 3;
/** 堆到顶时最下面 4 行变彩虹消掉 */
export const TETRIS_RESCUE_ROWS = 4;
export const TETRIS_START_FALL_MS = 1100;
export const TETRIS_MIN_FALL_MS = 550;
/** 每消一行加快一点，3 行时正好 560ms（不会出现“眨眼就没了”） */
export const TETRIS_FALL_STEP_MS = 180;
export const TETRIS_SCORE_PER_LINE = 10;
/** 每锁定一块 +1：即使一局总是 3 行，成绩也会随落子数变化 */
export const TETRIS_SCORE_PER_PIECE = 1;

export const PIECE_KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export type Rotation = 0 | 1 | 2 | 3;
export type BoardCell = PieceKind | null;
export type Board = BoardCell[][];

export interface ActivePiece {
  readonly kind: PieceKind;
  readonly rotation: Rotation;
  readonly x: number;
  readonly y: number;
}

export interface TetrisState {
  readonly seed: number;
  /** 已经抽过几个 7-bag（决定下一袋的种子） */
  readonly bagsDrawn: number;
  /** 当前方块之后的队列，前两个就是右侧预览 */
  readonly queue: readonly PieceKind[];
  readonly board: Board;
  readonly active: ActivePiece;
  /** 累计消掉的行数（含彩虹救援） */
  readonly lines: number;
  /** 累计锁定的方块数（每锁定一块 +1，参与计分） */
  readonly lockedPieces: number;
  /** 分数 = 消行数 × 10 + 落子块数 */
  readonly score: number;
  /** 彩虹救援次数（只在测试/诊断里看） */
  readonly rescues: number;
  /** 重力累计时间：场景每帧把 delta 交给 advance */
  readonly fallAccMs: number;
  readonly finished: boolean;
}

export interface TetrisMoveResult {
  readonly state: TetrisState;
  readonly moved: boolean;
}

export interface TetrisLockResult {
  readonly state: TetrisState;
  readonly locked: boolean;
  /** 本次消掉的行号（消行前的坐标，给场景做闪光用） */
  readonly clearedRows: readonly number[];
  /** 本次消掉几行（普通消行，不含彩虹救援） */
  readonly cleared: number;
  /** 本次触发了多少次彩虹救援 */
  readonly rescues: number;
  readonly finished: boolean;
}

export interface TetrisPlacement {
  readonly kind: PieceKind;
  readonly rotation: Rotation;
  readonly x: number;
  /** 自由落体后的 y（合法落点，测试会检查格子都在棋盘内） */
  readonly y: number;
  /** AI 的内部评分，越大越好 */
  readonly score: number;
  readonly cleared: number;
}

type Shape = readonly boolean[][];

/** 7 种方块的基础朝向：X 是实心格，. 是空格。旋转由下面的 rotateCW 生成，不手写第二份。 */
const BASE_SHAPES: Record<PieceKind, readonly string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
};

const SPAWN_X: Record<PieceKind, number> = { I: 2, O: 3, T: 2, S: 2, Z: 2, J: 2, L: 2 };
/** I 的实心行在下标 1，往上提一格，出生时正好贴着顶端 */
const SPAWN_Y: Record<PieceKind, number> = { I: -1, O: 0, T: 0, S: 0, Z: 0, J: 0, L: 0 };

function toMatrix(rows: readonly string[]): boolean[][] {
  return rows.map((row) => [...row].map((char) => char === 'X'));
}

function rotateCW(matrix: boolean[][]): boolean[][] {
  const size = matrix.length;
  return matrix.map((_, y) => matrix.map((_, x) => matrix[size - 1 - x]![y]!));
}

function buildShapes(): Record<PieceKind, readonly Shape[]> {
  const result = {} as Record<PieceKind, Shape[]>;
  for (const kind of PIECE_KINDS) {
    const rotations: boolean[][][] = [toMatrix(BASE_SHAPES[kind])];
    for (let index = 1; index < 4; index += 1) {
      rotations.push(rotateCW(rotations[index - 1]!));
    }
    result[kind] = rotations;
  }
  return result;
}

const SHAPES = buildShapes();
const SHAPE_BY_KIND = SHAPES;

/** 单格坐标（相对方块左上角），旋转 0 是预览用的基础朝向 */
export function shapeCells(kind: PieceKind, rotation: Rotation = 0): Array<{ x: number; y: number }> {
  const matrix = SHAPE_BY_KIND[kind][rotation]!;
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y]!.length; x += 1) {
      if (matrix[y]![x] === true) cells.push({ x, y });
    }
  }
  return cells;
}

/** 棋面上的绝对坐标（可用来画影子 / 落子，也方便测试校验合法性） */
export function activeCells(piece: ActivePiece): Array<{ x: number; y: number }> {
  return shapeCells(piece.kind, piece.rotation).map((cell) => ({
    x: piece.x + cell.x,
    y: piece.y + cell.y,
  }));
}

function emptyRow(): BoardCell[] {
  return Array.from({ length: TETRIS_COLS }, () => null);
}

export function emptyBoard(): Board {
  return Array.from({ length: TETRIS_ROWS }, () => emptyRow());
}

/** 一袋 7 种各一次；同一 seed + 同一袋号永远得到同一个顺序 */
export function createTetrisBag(seed: number, index: number): PieceKind[] {
  const random = seededRandom(hashString(seed + ':' + index));
  return shuffled(PIECE_KINDS, random);
}

function makePiece(kind: PieceKind): ActivePiece {
  return { kind, rotation: 0, x: SPAWN_X[kind], y: SPAWN_Y[kind] };
}

function takeFromQueue(
  seed: number,
  queue: readonly PieceKind[],
  bagsDrawn: number,
): { kind: PieceKind; queue: PieceKind[]; bagsDrawn: number } {
  const next = [...queue];
  let bags = bagsDrawn;
  while (next.length === 0) {
    next.push(...createTetrisBag(seed, bags));
    bags += 1;
  }
  const kind = next.shift()!;
  // 右侧永远有两个预览；不够就从下一袋补
  while (next.length < 2) {
    next.push(...createTetrisBag(seed, bags));
    bags += 1;
  }
  return { kind, queue: next, bagsDrawn: bags };
}

export function createTetrisState(seed: number): TetrisState {
  const first = takeFromQueue(seed, [], 0);
  return {
    seed,
    bagsDrawn: first.bagsDrawn,
    queue: first.queue,
    board: emptyBoard(),
    active: makePiece(first.kind),
    lines: 0,
    lockedPieces: 0,
    score: 0,
    rescues: 0,
    fallAccMs: 0,
    finished: false,
  };
}

/** 时间与随机都从参数进来：这个函数是重力加速的唯一实现 */
export function fallIntervalForLines(lines: number): number {
  return Math.max(TETRIS_MIN_FALL_MS, TETRIS_START_FALL_MS - Math.max(0, lines) * TETRIS_FALL_STEP_MS);
}

/** 方块是否和墙 / 地板 / 已有方块重叠；棋盘上方的空行允许（出生与旋转时会有半格在外） */
function collides(
  board: Board,
  kind: PieceKind,
  rotation: Rotation,
  x: number,
  y: number,
): boolean {
  for (const cell of shapeCells(kind, rotation)) {
    const boardX = x + cell.x;
    const boardY = y + cell.y;
    if (boardX < 0 || boardX >= TETRIS_COLS || boardY >= TETRIS_ROWS) return true;
    if (boardY >= 0 && board[boardY]![boardX] !== null) return true;
  }
  return false;
}

function noLock(state: TetrisState): TetrisLockResult {
  return { state, locked: false, clearedRows: [], cleared: 0, rescues: 0, finished: state.finished };
}

export function tryMove(state: TetrisState, dx: number): TetrisMoveResult {
  if (state.finished || dx === 0) return { state, moved: false };
  const active = state.active;
  if (collides(state.board, active.kind, active.rotation, active.x + dx, active.y)) {
    return { state, moved: false };
  }
  return { state: { ...state, active: { ...active, x: active.x + dx } }, moved: true };
}

/** 简单踢墙：先原地转，再左右各试 1~2 格，最后往上顶一格 */
const KICKS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -2, dy: 0 },
  { dx: 2, dy: 0 },
  { dx: 0, dy: -1 },
];

export function tryRotate(state: TetrisState, direction: 1 | -1 = 1): TetrisMoveResult {
  if (state.finished) return { state, moved: false };
  const active = state.active;
  const rotation = (((active.rotation + direction) % 4) + 4) % 4 as Rotation;
  for (const kick of KICKS) {
    if (!collides(state.board, active.kind, rotation, active.x + kick.dx, active.y + kick.dy)) {
      return {
        state: {
          ...state,
          active: {
            ...active,
            rotation,
            x: active.x + kick.dx,
            y: active.y + kick.dy,
          },
        },
        moved: true,
      };
    }
  }
  return { state, moved: false };
}

/** 影子落点：落点以上的格子只用于预览，不写进棋盘 */
export function ghostY(state: TetrisState): number {
  const active = state.active;
  let y = active.y;
  while (!collides(state.board, active.kind, active.rotation, active.x, y + 1)) y += 1;
  return y;
}

export function ghostPiece(state: TetrisState): ActivePiece {
  return { ...state.active, y: ghostY(state) };
}

function rescueBottomRows(board: Board): Board {
  // 最下面 4 行消掉，上面的行整体下落 4 格
  return [
    ...Array.from({ length: TETRIS_RESCUE_ROWS }, () => emptyRow()),
    ...board.slice(0, TETRIS_ROWS - TETRIS_RESCUE_ROWS),
  ];
}

/**
 * 落子（真实按钮 / autoplay AI 共用的唯一收尾）：
 * 写盘 → 消行 → 计分 → 抽下一块 → 出生点被占就彩虹救援 → 到 3 行结束。
 */
export function lockPiece(state: TetrisState): TetrisLockResult {
  if (state.finished) return noLock(state);
  const active = state.active;
  const board = state.board.map((row) => [...row]);
  for (const cell of activeCells(active)) {
    if (cell.y >= 0 && cell.y < TETRIS_ROWS && cell.x >= 0 && cell.x < TETRIS_COLS) {
      board[cell.y]![cell.x] = active.kind;
    }
  }

  const clearedRows: number[] = [];
  for (let y = 0; y < TETRIS_ROWS; y += 1) {
    if (board[y]!.every((cell) => cell !== null)) clearedRows.push(y);
  }

  let nextBoard = board;
  if (clearedRows.length > 0) {
    const emptyRows = Array.from({ length: clearedRows.length }, () => emptyRow());
    nextBoard = [...emptyRows, ...board.filter((_, index) => !clearedRows.includes(index))];
  }

  let lines = state.lines + clearedRows.length;
  const lockedPieces = state.lockedPieces + 1;
  let rescues = state.rescues;
  let queue = state.queue;
  let bagsDrawn = state.bagsDrawn;
  let nextActive = active;
  let finished = lines >= TETRIS_GOAL_LINES;
  let rescuedNow = 0;

  if (!finished) {
    const taken = takeFromQueue(state.seed, queue, bagsDrawn);
    queue = taken.queue;
    bagsDrawn = taken.bagsDrawn;
    nextActive = makePiece(taken.kind);

    // 堆到顶不失败：最下面 4 行变彩虹，等价于消掉 1 行，然后继续
    while (collides(nextBoard, nextActive.kind, nextActive.rotation, nextActive.x, nextActive.y)) {
      nextBoard = rescueBottomRows(nextBoard);
      lines += 1;
      rescues += 1;
      rescuedNow += 1;
      if (lines >= TETRIS_GOAL_LINES) {
        finished = true;
        break;
      }
    }
  }

  return {
    state: {
      ...state,
      board: nextBoard,
      active: nextActive,
      queue,
      bagsDrawn,
      lines,
      lockedPieces,
      score: lines * TETRIS_SCORE_PER_LINE + lockedPieces * TETRIS_SCORE_PER_PIECE,
      rescues,
      fallAccMs: 0,
      finished,
    },
    locked: true,
    clearedRows,
    cleared: clearedRows.length,
    rescues: rescuedNow,
    finished,
  };
}

/** 指令下落一格（↓ 按钮 / 滑动）：落不下去就锁 */
export function stepDown(state: TetrisState): TetrisLockResult {
  if (state.finished) return noLock(state);
  const active = state.active;
  if (collides(state.board, active.kind, active.rotation, active.x, active.y + 1)) {
    return lockPiece(state);
  }
  return {
    state: { ...state, active: { ...active, y: active.y + 1 }, fallAccMs: 0 },
    locked: false,
    clearedRows: [],
    cleared: 0,
    rescues: 0,
    finished: false,
  };
}

/** 掉下去（硬降）：先落到底，再走同一个 lockPiece */
export function hardDrop(state: TetrisState): TetrisLockResult {
  if (state.finished) return noLock(state);
  const active = state.active;
  let y = active.y;
  while (!collides(state.board, active.kind, active.rotation, active.x, y + 1)) y += 1;
  return lockPiece({ ...state, active: { ...active, y } });
}

/**
 * 重力：累计 delta，够一个间隔就下落一格；落不下去就锁。
 * 一帧里最多处理 12 步，避免后台切回时一次掉到底。
 */
export function advance(state: TetrisState, deltaMs: number): TetrisLockResult {
  if (state.finished || deltaMs <= 0) return noLock(state);
  let accumulator = state.fallAccMs + deltaMs;
  let current = state;
  let steps = 0;

  while (steps < 12) {
    const interval = fallIntervalForLines(current.lines);
    if (accumulator < interval) break;
    accumulator -= interval;
    steps += 1;
    const active = current.active;
    if (collides(current.board, active.kind, active.rotation, active.x, active.y + 1)) {
      return lockPiece(current);
    }
    current = { ...current, active: { ...active, y: active.y + 1 } };
  }

  return {
    state: { ...current, fallAccMs: accumulator },
    locked: false,
    clearedRows: [],
    cleared: 0,
    rescues: 0,
    finished: current.finished,
  };
}

/* ------------------------------------------------------------------ *
 * AI（autoplay 用）：枚举 旋转 × 列，按 高度 / 空洞 / 消行 评分。
 * 它只产出落点，真正落子仍然由场景调用与按钮一样的 rotate / move / hardDrop。
 * ------------------------------------------------------------------ */

function landingY(
  board: Board,
  kind: PieceKind,
  rotation: Rotation,
  x: number,
): number | null {
  let y = -4;
  if (collides(board, kind, rotation, x, y)) return null;
  while (!collides(board, kind, rotation, x, y + 1)) y += 1;
  for (const cell of shapeCells(kind, rotation)) {
    const boardX = x + cell.x;
    const boardY = y + cell.y;
    if (boardX < 0 || boardX >= TETRIS_COLS || boardY < 0 || boardY >= TETRIS_ROWS) return null;
  }
  return y;
}

function evaluatePlacement(
  board: Board,
  kind: PieceKind,
  rotation: Rotation,
  x: number,
  y: number,
): { score: number; cleared: number } {
  const next = board.map((row) => [...row]);
  for (const cell of shapeCells(kind, rotation)) next[y + cell.y]![x + cell.x] = kind;

  const fullRows: number[] = [];
  for (let row = 0; row < TETRIS_ROWS; row += 1) {
    if (next[row]!.every((cell) => cell !== null)) fullRows.push(row);
  }
  const cleared = fullRows.length;
  const grid =
    cleared > 0
      ? [...Array.from({ length: cleared }, () => emptyRow()), ...next.filter((_, index) => !fullRows.includes(index))]
      : next;

  const heights = Array.from({ length: TETRIS_COLS }, () => 0);
  let holes = 0;
  for (let column = 0; column < TETRIS_COLS; column += 1) {
    let top = -1;
    for (let row = 0; row < TETRIS_ROWS; row += 1) {
      if (grid[row]![column] !== null) {
        if (top < 0) top = row;
      } else if (top >= 0) {
        holes += 1;
      }
    }
    heights[column] = top < 0 ? 0 : TETRIS_ROWS - top;
  }

  const aggregateHeight = heights.reduce((sum, value) => sum + value, 0);
  const maxHeight = heights.reduce((max, value) => Math.max(max, value), 0);
  let bumpiness = 0;
  for (let column = 0; column < TETRIS_COLS - 1; column += 1) {
    bumpiness += Math.abs(heights[column]! - heights[column + 1]!);
  }

  const score =
    cleared * 1000 -
    aggregateHeight * 1.6 -
    holes * 27 -
    bumpiness * 1.2 -
    maxHeight * 3;
  return { score, cleared };
}

/** 给当前方块挑一个落点；棋盘已经被堵死时返回 null，场景会直接硬降由逻辑触发救援 */
export function planPlacement(state: TetrisState): TetrisPlacement | null {
  if (state.finished) return null;
  const kind = state.active.kind;
  let best: TetrisPlacement | null = null;
  for (let rotation = 0 as Rotation; rotation < 4; rotation = (rotation + 1) as Rotation) {
    for (let x = -3; x <= TETRIS_COLS + 1; x += 1) {
      const y = landingY(state.board, kind, rotation, x);
      if (y === null) continue;
      const evaluation = evaluatePlacement(state.board, kind, rotation, x, y);
      if (!best || evaluation.score > best.score) {
        best = { kind, rotation, x, y, score: evaluation.score, cleared: evaluation.cleared };
      }
    }
  }
  return best;
}
