import { describe, expect, it } from 'vitest';
import {
  PIECE_KINDS,
  TETRIS_COLS,
  TETRIS_GOAL_LINES,
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
    // 上面一行（原来的第 12 行）整体落下来
    expect(result.state.board[13]![3]).toBe('O');
    expect(result.state.board[13]![4]).toBe('O');
    expect(result.state.board[12]!.every((cell) => cell === null)).toBe(true);
  });

  it('一次消两行：计 2 行，分数 = 20 + 落子块数', () => {
    const board = emptyBoard();
    fill(board, 12, 'T', [0, 1, 2, 5, 6, 7]);
    fill(board, 13, 'T', [0, 1, 2, 5, 6, 7]);
    const state = withActive({ ...createTetrisState(8), board }, { kind: 'O', rotation: 0, x: 3, y: 12 });
    const result = lockPiece(state);
    expect(result.cleared).toBe(2);
    expect(result.state.lines).toBe(2);
    expect(result.state.lockedPieces).toBe(1);
    expect(result.state.score).toBe(21);
    expect(result.finished).toBe(false);
  });

  it('消到第 3 行即完成，继续落子不再改变状态', () => {
    const board = emptyBoard();
    fill(board, 13, 'T', [0, 1, 2, 5, 6, 7]);
    let state = withActive({ ...createTetrisState(9), board, lines: 2, lockedPieces: 7, score: 27 }, {
      kind: 'O',
      rotation: 0,
      x: 3,
      y: 12,
    });
    const result = lockPiece(state);
    expect(result.finished).toBe(true);
    expect(result.state.lines).toBe(TETRIS_GOAL_LINES);
    expect(result.state.lockedPieces).toBe(8);
    expect(result.state.score).toBe(38);
    expect(result.state.score).toBe(
      result.state.lines * TETRIS_SCORE_PER_LINE +
        result.state.lockedPieces * TETRIS_SCORE_PER_PIECE,
    );
    state = result.state;
    expect(tryMove(state, 1).moved).toBe(false);
    expect(tryRotate(state, 1).moved).toBe(false);
    expect(hardDrop(state).locked).toBe(false);
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
  it('最下面 4 行消掉并计入 1 行进度，继续玩', () => {
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
    expect(result.state.finished).toBe(false);
    // 原来的第 0 行被整体下移 4 行，顶部 4 行空出来
    expect(result.state.board[4]![0]).toBe('T');
    for (let row = 0; row < 4; row += 1) {
      expect(result.state.board[row]!.every((cell) => cell === null)).toBe(true);
    }
  });

  it('救援也算 1 行：已消 2 行时救援直接完成', () => {
    const board = emptyBoard();
    for (let row = 0; row <= 8; row += 1) fill(board, row, 'T', [0, 1, 2, 3, 4, 5, 6]);
    const state = withActive(
      { ...createTetrisState(14), board, lines: 2, lockedPieces: 6, score: 26 },
      { kind: 'O', rotation: 0, x: 3, y: 10 },
    );
    const result = lockPiece(state);
    expect(result.rescues).toBe(1);
    expect(result.finished).toBe(true);
    expect(result.state.lines).toBe(TETRIS_GOAL_LINES);
    expect(result.state.lockedPieces).toBe(7);
    expect(result.state.score).toBe(37);
    expect(result.state.score).toBe(
      result.state.lines * TETRIS_SCORE_PER_LINE +
        result.state.lockedPieces * TETRIS_SCORE_PER_PIECE,
    );
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

  it('40 块内至少消 3 行（多组种子）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = runAi(seed, 40);
      expect(state.finished).toBe(true);
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
