import { describe, expect, it } from 'vitest';
import {
  PIECE_KINDS,
  TETRIS_COLS,
  TETRIS_FALL_FLOOR_MS,
  TETRIS_GOAL_LINES,
  TETRIS_LEVEL_MAX,
  TETRIS_LEVEL_MIN,
  TETRIS_MIN_FALL_MS,
  TETRIS_ROWS,
  TETRIS_SCORE_PER_LINE,
  TETRIS_SCORE_PER_PIECE,
  activeCells,
  advance,
  createTetrisBag,
  createTetrisState,
  emptyBoard,
  fallIntervalForLines,
  ghostPiece,
  ghostY,
  hardDrop,
  lockPiece,
  normalizeTetrisLevel,
  planPlacement,
  shapeCells,
  stepDown,
  tryMove,
  tryRotate,
} from './tetris.logic';
import type { ActivePiece, Board, PieceKind, TetrisState } from './tetris.logic';

function fill(board: Board, row: number, kind: PieceKind, columns: readonly number[]): void {
  for (const column of columns) board[row]![column] = kind;
}

function withActive(state: TetrisState, active: ActivePiece): TetrisState {
  return { ...state, active };
}

describe('7-bag：种子决定方块序列', () => {
  it('每一袋 7 种各一次，同一 seed 永远相同', () => {
    const bag = createTetrisBag(2026, 0);
    expect([...bag].sort()).toEqual([...PIECE_KINDS].sort());
    expect(new Set(bag).size).toBe(7);
    expect(createTetrisBag(2026, 0)).toEqual(bag);
    expect(createTetrisBag(2026, 1)).not.toEqual(bag);
    expect(createTetrisBag(7, 0)).not.toEqual(bag);
  });

  it('开局第一块与右侧两个预览都来自第一袋', () => {
    const state = createTetrisState(2026);
    const bag = createTetrisBag(2026, 0);
    expect(state.active.kind).toBe(bag[0]);
    expect(state.queue.slice(0, 2)).toEqual(bag.slice(1, 3));
    expect(state.lines).toBe(0);
    expect(state.lockedPieces).toBe(0);
    expect(state.score).toBe(0);
    expect(state.finished).toBe(false);
  });

  it('同一 seed 模拟同一串硬降，棋盘完全一致', () => {
    const play = (): TetrisState => {
      let state = createTetrisState(4242);
      for (let piece = 0; piece < 6; piece += 1) state = hardDrop(state).state;
      return state;
    };
    expect(play().board).toEqual(play().board);
    expect(play().queue).toEqual(play().queue);
    // 6 次硬降 = 6 块，分数口径必须随落子数变化
    expect(play().lockedPieces).toBe(6);
    expect(play().score).toBe(
      play().lines * TETRIS_SCORE_PER_LINE + 6 * TETRIS_SCORE_PER_PIECE,
    );
  });
});

describe('旋转：含踢墙', () => {
  it('空地上旋转会改变朝向', () => {
    const state = withActive(createTetrisState(1), { kind: 'T', rotation: 0, x: 2, y: 5 });
    const result = tryRotate(state, 1);
    expect(result.moved).toBe(true);
    expect(result.state.active.rotation).toBe(1);
  });

  it('贴着左墙的竖条会向右踢回棋盘内', () => {
    const state = withActive(createTetrisState(2), { kind: 'I', rotation: 1, x: -2, y: 5 });
    const result = tryRotate(state, 1);
    expect(result.moved).toBe(true);
    expect(result.state.active.rotation).toBe(2);
    expect(result.state.active.x).toBe(0);
    for (const cell of activeCells(result.state.active)) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(TETRIS_COLS);
    }
  });

  it('转不动时保持原状态（不报错、不越界）', () => {
    const board = emptyBoard();
    // 四面围死的井：任何旋转都会重叠
    for (let row = 0; row < TETRIS_ROWS; row += 1) {
      if (row !== 7) fill(board, row, 'T', [0, 1, 2, 3, 4, 5, 6, 7]);
    }
    const state = withActive({ ...createTetrisState(3), board }, { kind: 'O', rotation: 0, x: 3, y: 7 });
    expect(tryRotate(state, 1).moved).toBe(false);
  });
});

describe('碰撞与锁定', () => {
  it('左右移动不会穿墙', () => {
    const state = withActive(createTetrisState(4), { kind: 'O', rotation: 0, x: 0, y: 0 });
    expect(tryMove(state, -1).moved).toBe(false);
    const right = tryMove(state, 1);
    expect(right.moved).toBe(true);
    expect(right.state.active.x).toBe(1);
  });

  it('硬降落到底后锁住，并抽出下一块', () => {
    const state = withActive(createTetrisState(5), { kind: 'O', rotation: 0, x: 0, y: 0 });
    const nextKind = state.queue[0];
    const result = hardDrop(state);
    expect(result.locked).toBe(true);
    expect(result.state.board[13]![0]).toBe('O');
    expect(result.state.board[13]![1]).toBe('O');
    expect(result.state.board[12]![0]).toBe('O');
    expect(result.state.active.kind).toBe(nextKind);
    expect(result.state.active.y).toBeLessThan(2);
  });

  it('↓ 一格格下落，贴底时锁住', () => {
    const state = withActive(createTetrisState(6), { kind: 'O', rotation: 0, x: 3, y: 10 });
    const first = stepDown(state);
    expect(first.locked).toBe(false);
    expect(first.state.active.y).toBe(11);
    const second = stepDown(first.state);
    expect(second.locked).toBe(false);
    expect(second.state.active.y).toBe(12);
    const third = stepDown(second.state);
    expect(third.locked).toBe(true);
    expect(third.state.board[13]![3]).toBe('O');
  });
});

describe('消行与计分', () => {
  it('填满一行就消掉，分数 = 行数 × 10 + 落子块数', () => {
    const board = emptyBoard();
    fill(board, 13, 'T', [0, 1, 2, 5, 6, 7]);
    const state = withActive({ ...createTetrisState(7), board }, { kind: 'O', rotation: 0, x: 3, y: 12 });
    const result = lockPiece(state);
    expect(result.cleared).toBe(1);
    expect(result.state.lines).toBe(1);
    expect(result.state.lockedPieces).toBe(1);
    expect(result.state.score).toBe(11);
    expect(result.state.score).toBe(
      result.state.lines * TETRIS_SCORE_PER_LINE +
        result.state.lockedPieces * TETRIS_SCORE_PER_PIECE,
    );
    // 一局只打一轮：消 1 行就是这一局的终点
    expect(result.finished).toBe(true);
    expect(result.state.finished).toBe(true);
    // 上面一行（原来的第 12 行）整体落下来
    expect(result.state.board[13]![3]).toBe('O');
    expect(result.state.board[13]![4]).toBe('O');
    expect(result.state.board[12]!.every((cell) => cell === null)).toBe(true);
  });

  it('一次消两行：计 2 行，同样直接完成这一局', () => {
    const board = emptyBoard();
    fill(board, 12, 'T', [0, 1, 2, 5, 6, 7]);
    fill(board, 13, 'T', [0, 1, 2, 5, 6, 7]);
    const state = withActive({ ...createTetrisState(8), board }, { kind: 'O', rotation: 0, x: 3, y: 12 });
    const result = lockPiece(state);
    expect(result.cleared).toBe(2);
    expect(result.state.lines).toBe(2);
    expect(result.state.lockedPieces).toBe(1);
    expect(result.state.score).toBe(21);
    expect(result.finished).toBe(true);
    expect(result.state.finished).toBe(true);
  });

  it('消到第 1 行即完成一局，继续落子不再改变状态', () => {
    expect(TETRIS_GOAL_LINES).toBe(1);
    const board = emptyBoard();
    fill(board, 13, 'T', [0, 1, 2, 5, 6, 7]);
    let state = withActive({ ...createTetrisState(9), board }, {
      kind: 'O',
      rotation: 0,
      x: 3,
      y: 12,
    });
    const result = lockPiece(state);
    expect(result.finished).toBe(true);
    expect(result.state.finished).toBe(true);
    expect(result.state.lines).toBe(TETRIS_GOAL_LINES);
    expect(result.state.lines).toBe(1);
    expect(result.state.lockedPieces).toBe(1);
    expect(result.state.score).toBe(11);
    expect(result.state.score).toBe(
      result.state.lines * TETRIS_SCORE_PER_LINE +
        result.state.lockedPieces * TETRIS_SCORE_PER_PIECE,
    );
    state = result.state;
    expect(tryMove(state, 1).moved).toBe(false);
    expect(tryRotate(state, 1).moved).toBe(false);
    expect(hardDrop(state).locked).toBe(false);
    expect(stepDown(state).locked).toBe(false);
    expect(lockPiece(state).locked).toBe(false);
    expect(advance(state, 5000).locked).toBe(false);
  });
});

describe('落点影子', () => {
  it('影子在最下面的落点，且不改变当前方块', () => {
    const state = withActive(createTetrisState(10), { kind: 'O', rotation: 0, x: 3, y: 0 });
    expect(ghostY(state)).toBe(12);
    expect(ghostPiece(state).y).toBe(12);
    expect(state.active.y).toBe(0);
  });

  it('棋盘有凸起时影子会被挡住', () => {
    const board = emptyBoard();
    fill(board, 9, 'T', [3, 4]);
    const state = withActive({ ...createTetrisState(11), board }, { kind: 'O', rotation: 0, x: 3, y: 0 });
    expect(ghostY(state)).toBe(7);
  });
});

describe('重力与速度', () => {
  it('1.1 秒/格起步，消行后加快，最快 0.55 秒/格', () => {
    expect(fallIntervalForLines(0)).toBe(1100);
    expect(fallIntervalForLines(1)).toBe(920);
    expect(fallIntervalForLines(3)).toBe(560);
    expect(fallIntervalForLines(99)).toBe(TETRIS_MIN_FALL_MS);
  });

  it('delta 会累计：不够一个间隔不动，够了下落一格', () => {
    const state = withActive(createTetrisState(12), { kind: 'O', rotation: 0, x: 3, y: 0 });
    const notYet = advance(state, 1099);
    expect(notYet.state.active.y).toBe(0);
    expect(notYet.locked).toBe(false);
    const stepped = advance(notYet.state, 1);
    expect(stepped.state.active.y).toBe(1);
    expect(stepped.locked).toBe(false);
  });
});

describe('彩虹救援：堆到顶不失败', () => {
  it('最下面 4 行消掉并计入 1 行，直接完成这一局', () => {
    const board = emptyBoard();
    for (let row = 0; row <= 8; row += 1) fill(board, row, 'T', [0, 1, 2, 3, 4, 5, 6]);
    const state = withActive({ ...createTetrisState(13), board }, { kind: 'O', rotation: 0, x: 3, y: 10 });
    const result = lockPiece(state);
    expect(result.locked).toBe(true);
    expect(result.rescues).toBe(1);
    expect(result.state.rescues).toBe(1);
    expect(result.state.lines).toBe(1);
    expect(result.state.lockedPieces).toBe(1);
    expect(result.state.score).toBe(11);
    // 救援计入 1 行 = 达到单轮目标，直接完成
    expect(result.state.finished).toBe(true);
    expect(result.finished).toBe(true);
    // 原来的第 0 行被整体下移 4 行，顶部 4 行空出来
    expect(result.state.board[4]![0]).toBe('T');
    for (let row = 0; row < 4; row += 1) {
      expect(result.state.board[row]!.every((cell) => cell === null)).toBe(true);
    }
  });

  it('救援直接结束一局：之后不再抽方块、不会无限救援卡死', () => {
    const board = emptyBoard();
    for (let row = 0; row <= 8; row += 1) fill(board, row, 'T', [0, 1, 2, 3, 4, 5, 6]);
    // 堆到顶的棋盘：落子后下一块出生即重叠 → 彩虹救援
    const seeded = withActive({ ...createTetrisState(14), board }, {
      kind: 'O',
      rotation: 0,
      x: 3,
      y: 10,
    });
    const result = lockPiece(seeded);
    expect(result.rescues).toBeGreaterThanOrEqual(1);
    expect(result.finished).toBe(true);
    expect(result.state.lines).toBe(TETRIS_GOAL_LINES);
    expect(result.state.score).toBe(
      result.state.lines * TETRIS_SCORE_PER_LINE +
        result.state.lockedPieces * TETRIS_SCORE_PER_PIECE,
    );
    // 完成后纯逻辑全部是 no-op，不会继续消行 / 卡死
    const state = result.state;
    for (let step = 0; step < 3; step += 1) {
      expect(advance(state, 5000).locked).toBe(false);
      expect(hardDrop(state).locked).toBe(false);
    }
  });
});

describe('AI：autoplay 的落点规划', () => {
  function runAi(seed: number, maxPieces: number): TetrisState {
    let state = createTetrisState(seed);
    for (let piece = 0; piece < maxPieces && !state.finished; piece += 1) {
      const placement = planPlacement(state);
      expect(placement).not.toBeNull();
      if (!placement) break;
      let applied = state;
      let guard = 0;
      while (applied.active.rotation !== placement.rotation && guard < 4) {
        const rotated = tryRotate(applied, 1);
        if (!rotated.moved) break;
        applied = rotated.state;
        guard += 1;
      }
      guard = 0;
      while (applied.active.x !== placement.x && guard < TETRIS_COLS + 4) {
        const direction = applied.active.x < placement.x ? 1 : -1;
        const shifted = tryMove(applied, direction);
        if (!shifted.moved) break;
        applied = shifted.state;
        guard += 1;
      }
      const dropped = hardDrop(applied);
      expect(dropped.locked).toBe(true);
      state = dropped.state;
    }
    return state;
  }

  it('一局（消 1 行）能在 40 块内完成（多组种子）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = runAi(seed, 40);
      expect(state.finished).toBe(true);
      // 单轮一局更短：autoplay 必须快速跑完（实测最多 8 块，这里留一倍余量）
      expect(state.lockedPieces).toBeLessThanOrEqual(20);
      expect(state.lines).toBeGreaterThanOrEqual(TETRIS_GOAL_LINES);
      expect(state.score).toBe(
        state.lines * TETRIS_SCORE_PER_LINE +
          state.lockedPieces * TETRIS_SCORE_PER_PIECE,
      );
    }
  });

  it('落点合法：每格都在棋盘内且不与已有方块重叠', () => {
    for (const seed of [21, 22, 23, 24]) {
      const state = createTetrisState(seed);
      const placement = planPlacement(state);
      expect(placement).not.toBeNull();
      if (!placement) continue;
      expect(placement.y).toBeGreaterThanOrEqual(0);
      const occupied = new Set<string>();
      for (let row = 0; row < TETRIS_ROWS; row += 1) {
        for (let column = 0; column < TETRIS_COLS; column += 1) {
          if (state.board[row]![column] !== null) occupied.add(column + ',' + row);
        }
      }
      for (const cell of shapeCells(placement.kind, placement.rotation)) {
        const x = placement.x + cell.x;
        const y = placement.y + cell.y;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(TETRIS_COLS);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(TETRIS_ROWS);
        expect(occupied.has(x + ',' + y)).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 难度等级：level 只调重力节奏，level = 1 与旧行为完全一致
 * ------------------------------------------------------------------ */
describe('难度等级：fallIntervalForLines', () => {
  it('level = 1 与旧公式逐值相同', () => {
    for (const lines of [0, 1, 2, 3, 5, 10, 99]) {
      expect(fallIntervalForLines(lines, 1)).toBe(fallIntervalForLines(lines));
    }
    expect(fallIntervalForLines(0, 1)).toBe(1100);
    expect(fallIntervalForLines(1, 1)).toBe(920);
    expect(fallIntervalForLines(3, 1)).toBe(560);
    expect(fallIntervalForLines(99, 1)).toBe(TETRIS_MIN_FALL_MS);
    expect(fallIntervalForLines(0)).toBe(1100);
  });

  it('同一消行数下等级越高间隔越短，且任何等级都不低于 300ms', () => {
    for (const lines of [0, 1, 2, 3, 6, 12]) {
      let previous = Number.POSITIVE_INFINITY;
      for (let level = TETRIS_LEVEL_MIN; level <= TETRIS_LEVEL_MAX; level += 1) {
        const interval = fallIntervalForLines(lines, level);
        expect(interval).toBeLessThan(previous);
        expect(interval).toBeGreaterThanOrEqual(TETRIS_FALL_FLOOR_MS);
        expect(interval).toBeGreaterThanOrEqual(300);
        previous = interval;
      }
      expect(fallIntervalForLines(lines, TETRIS_LEVEL_MAX)).toBeLessThan(
        fallIntervalForLines(lines, 1),
      );
    }
  });

  it('level=1 起始 1100、每行 -180、550 保底；高等级起始更快', () => {
    expect(fallIntervalForLines(0)).toBe(1100);
    expect(fallIntervalForLines(1, 1)).toBe(920);
    expect(fallIntervalForLines(2, 1)).toBe(740);
    expect(fallIntervalForLines(3, 1)).toBe(560);
    expect(fallIntervalForLines(4, 1)).toBe(TETRIS_MIN_FALL_MS);
    expect(fallIntervalForLines(0, 6)).toBe(1100 - 5 * 60);
    expect(fallIntervalForLines(0, TETRIS_LEVEL_MAX)).toBe(440);
  });
});

describe('难度等级：状态透传与重力推进', () => {
  it('createTetrisState 默认 level = 1，可选参数透传且越界兜底', () => {
    expect(createTetrisState(2026).level).toBe(1);
    expect(createTetrisState(2026, {}).level).toBe(1);
    expect(createTetrisState(2026, { level: 5 }).level).toBe(5);
    expect(createTetrisState(2026, { level: 12 }).level).toBe(12);
    // 越界 / 非法值一律落回 1..12
    expect(createTetrisState(2026, { level: 0 }).level).toBe(TETRIS_LEVEL_MIN);
    expect(createTetrisState(2026, { level: -7 }).level).toBe(TETRIS_LEVEL_MIN);
    expect(createTetrisState(2026, { level: 99 }).level).toBe(TETRIS_LEVEL_MAX);
    expect(createTetrisState(2026, { level: Number.NaN }).level).toBe(TETRIS_LEVEL_MIN);
    expect(createTetrisState(2026, { level: 2.9 }).level).toBe(2);
    expect(normalizeTetrisLevel(Number.POSITIVE_INFINITY)).toBe(TETRIS_LEVEL_MAX);
    expect(normalizeTetrisLevel(Number.NEGATIVE_INFINITY)).toBe(TETRIS_LEVEL_MIN);
  });

  it('fallIntervalForLines 对 level 越界兜底与合法值一致', () => {
    for (const lines of [0, 2, 4, 99]) {
      expect(fallIntervalForLines(lines, 0)).toBe(fallIntervalForLines(lines, 1));
      expect(fallIntervalForLines(lines, 99)).toBe(fallIntervalForLines(lines, 12));
      expect(fallIntervalForLines(lines, Number.NaN)).toBe(fallIntervalForLines(lines, 1));
      expect(fallIntervalForLines(lines, 3.8)).toBe(fallIntervalForLines(lines, 3));
    }
  });

  it('level=1 的第一局参数与旧版第 1 轮一致：起始 1100ms、目标 1 行', () => {
    const state = createTetrisState(2026);
    expect(state.level).toBe(1);
    expect(state.lines).toBe(0);
    expect(fallIntervalForLines(state.lines, state.level)).toBe(1100);
    expect(fallIntervalForLines(0)).toBe(1100);
  });

  it('advance 用 state.level 决定重力间隔（不是写死 Lv.1）', () => {
    const level1 = withActive(createTetrisState(31), { kind: 'O', rotation: 0, x: 3, y: 0 });
    const level12 = withActive(createTetrisState(31, { level: 12 }), {
      kind: 'O',
      rotation: 0,
      x: 3,
      y: 0,
    });
    const fastInterval = fallIntervalForLines(0, 12);
    expect(fastInterval).toBe(440);

    // Lv.12：够一个间隔就下落一格
    expect(advance(level12, fastInterval - 1).state.active.y).toBe(0);
    expect(advance(level12, fastInterval).state.active.y).toBe(1);
    // 同样的 delta，Lv.1 还在等 1100ms，不动
    expect(advance(level1, fastInterval).state.active.y).toBe(0);
  });
});

describe('难度等级：Lv.12 autoplay 仍能完成一局', () => {
  function runAiAtLevel(seed: number, level: number, maxPieces: number): TetrisState {
    let state = createTetrisState(seed, { level });
    for (let piece = 0; piece < maxPieces && !state.finished; piece += 1) {
      const placement = planPlacement(state);
      expect(placement).not.toBeNull();
      if (!placement) break;
      let applied = state;
      let guard = 0;
      while (applied.active.rotation !== placement.rotation && guard < 4) {
        const rotated = tryRotate(applied, 1);
        if (!rotated.moved) break;
        applied = rotated.state;
        guard += 1;
      }
      guard = 0;
      while (applied.active.x !== placement.x && guard < TETRIS_COLS + 4) {
        const direction = applied.active.x < placement.x ? 1 : -1;
        const shifted = tryMove(applied, direction);
        if (!shifted.moved) break;
        applied = shifted.state;
        guard += 1;
      }
      const dropped = hardDrop(applied);
      expect(dropped.locked).toBe(true);
      state = dropped.state;
    }
    return state;
  }

  it('最高等级 12 下 AI 仍能在 40 块内完成一局（消满 1 行，不会卡死）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = runAiAtLevel(seed, TETRIS_LEVEL_MAX, 40);
      expect(state.level).toBe(TETRIS_LEVEL_MAX);
      expect(state.finished).toBe(true);
      expect(state.lockedPieces).toBeLessThanOrEqual(20);
      expect(state.lines).toBeGreaterThanOrEqual(TETRIS_GOAL_LINES);
      expect(state.score).toBe(
        state.lines * TETRIS_SCORE_PER_LINE +
          state.lockedPieces * TETRIS_SCORE_PER_PIECE,
      );
    }
  });

  it('最高等级下纯重力推进也不会「够间隔却不动」', () => {
    const state = withActive(createTetrisState(77, { level: TETRIS_LEVEL_MAX }), {
      kind: 'O',
      rotation: 0,
      x: 3,
      y: 0,
    });
    const interval = fallIntervalForLines(0, TETRIS_LEVEL_MAX);
    const moved = advance(state, interval * 5);
    expect(moved.locked).toBe(false);
    expect(moved.state.active.y).toBeGreaterThanOrEqual(5);
  });
});
