import { describe, expect, it } from 'vitest';
import type { PopstarBoard, StarFamily } from './popstar.logic';
import {
  POPSTAR_CELLS,
  POPSTAR_COLS,
  POPSTAR_GOALS,
  POPSTAR_GOAL_PER_LEVEL,
  POPSTAR_MAX_GOAL,
  POPSTAR_MAX_LEVEL,
  POPSTAR_MIN_LEVEL,
  POPSTAR_MIN_GROUP,
  POPSTAR_ROUNDS,
  POPSTAR_ROWS,
  advanceRound,
  clampLevel,
  createPopstarState,
  dealBoard,
  filledCount,
  findGroup,
  goalForRound,
  isValidGroup,
  largestGroup,
  neighborIndices,
  popTone,
  remainingToGoal,
  roundProgress,
  tryPop,
} from './popstar.logic';

const EMPTY_ROW = '........';

function blankRows(count: number): string[] {
  return Array.from({ length: count }, () => EMPTY_ROW);
}

/** 用 10 行 × 8 列的字符串搭棋盘，'.' = 空格；测试读起来和棋盘长得一样 */
function boardOf(rows: readonly string[]): PopstarBoard {
  if (rows.length !== POPSTAR_ROWS || rows.some((row) => row.length !== POPSTAR_COLS)) {
    throw new Error('测试棋盘必须是 10 行 × 8 列');
  }
  return [...rows.join('')].map((ch) => (ch === '.' ? null : (Number(ch) as StarFamily)));
}

/** 四邻接都不同家族的「死棋」：不会出现任何 ≥2 的组 */
function checkerRows(): string[] {
  return Array.from({ length: POPSTAR_ROWS }, (_, row) =>
    Array.from({ length: POPSTAR_COLS }, (_, col) => String((row + col) % 4)).join(''),
  );
}

describe('连通组：只认 4 邻接的同家族，≥2 才算可消', () => {
  it('把上下左右连成的整组找出来，斜角不算', () => {
    // (0,0)(0,1) 横着连，(1,0) 竖着接上 -> 3 颗；对角不连
    const board = boardOf(['11......', '1.......', ...blankRows(8)]);
    expect(findGroup(board, 0)).toEqual([0, 1, 8]);
    expect(findGroup(board, 1)).toEqual([0, 1, 8]);
    expect(findGroup(board, 8)).toEqual([0, 1, 8]);
    expect(isValidGroup(board, [0, 1, 8])).toBe(true);
    expect(isValidGroup(board, [0, 1])).toBe(false);
    expect(isValidGroup(board, [0, 1, 9])).toBe(false);
  });

  it('只有对角相邻的两颗不连；4 邻接也不跨行绕回', () => {
    const board = boardOf(['1.......', '.1......', ...blankRows(8)]);
    expect(findGroup(board, 0)).toEqual([0]);
    expect(findGroup(board, 9)).toEqual([9]);
    expect(largestGroup(board)).toEqual([]);

    const neighbors = neighborIndices(7);
    expect(neighbors).toContain(6);
    expect(neighbors).toContain(15);
    expect(neighbors).not.toContain(8);
    expect([...neighborIndices(0)].sort((a, b) => a - b)).toEqual([1, 8]);
  });

  it('达到 2 颗门槛才可消，最大的组会被选中', () => {
    const board = boardOf(['22......', ...blankRows(7), '3333....', '........']);
    expect(findGroup(board, 0)).toEqual([0, 1]);
    expect(largestGroup(board)).toEqual([64, 65, 66, 67]);
    expect(largestGroup(boardOf(checkerRows()))).toEqual([]);
  });
});

describe('消除：整组消失，上方星星落下来', () => {
  it('拒绝单颗、混家族、不连通和重复下标，状态一动不动', () => {
    const board = boardOf(['12......', '12......', '11......', ...blankRows(7)]);
    const state = createPopstarState(1, { board });
    for (const group of [[0], [], [0, 16], [0, 8], [0, 1], [0, 0, 1]]) {
      const result = tryPop(state, group);
      expect(result.popped).toBe(0);
      expect(result.state).toBe(state);
    }
    expect(state.pops).toBe(0);
    expect(filledCount(state.board)).toBe(6);
  });

  it('消掉整组后每列向下压缩，顶部补满新星', () => {
    const board = boardOf(['11......', '22......', '33......', ...blankRows(7)]);
    const state = createPopstarState(7, { board });
    const result = tryPop(state, [0, 1]);

    expect(result.popped).toBe(2);
    expect(result.state.collected).toBe(2);
    expect(result.state.score).toBe(2);
    expect(result.state.pops).toBe(1);
    expect(filledCount(result.state.board)).toBe(POPSTAR_CELLS);
    // 第 0 列原来从上到下是 1,2,3；消掉 1 之后 2、3 落到最底下两行
    expect(result.state.board[8 * POPSTAR_COLS]).toBe(2);
    expect(result.state.board[9 * POPSTAR_COLS]).toBe(3);
    // 第 1 列同理
    expect(result.state.board[8 * POPSTAR_COLS + 1]).toBe(2);
    expect(result.state.board[9 * POPSTAR_COLS + 1]).toBe(3);
  });

  it('没有可消的组时，剩下的星星飞回天上计入收集并刷新棋盘', () => {
    const board = boardOf(['3......2', ...blankRows(9)]);
    const state = createPopstarState(3, { board, collected: 10, score: 10 });
    const result = tryPop(state, []);
    expect(result.popped).toBe(0);
    expect(result.autoCollected).toBe(2);
    expect(result.state.collected).toBe(12);
    expect(filledCount(result.state.board)).toBe(POPSTAR_CELLS);
    expect(largestGroup(result.state.board).length).toBeGreaterThanOrEqual(POPSTAR_MIN_GROUP);
  });
});

describe('补星：种子决定一切', () => {
  it('同种子同结果：初始棋盘与连续消除都完全一致', () => {
    const first = createPopstarState(424242);
    const second = createPopstarState(424242);
    expect(first.board).toEqual(second.board);
    expect(dealBoard(424242, 'round:0')).toEqual(first.board);

    let a = first;
    let b = second;
    for (let step = 0; step < 4; step += 1) {
      const groupA = largestGroup(a.board);
      const groupB = largestGroup(b.board);
      expect(groupA).toEqual(groupB);
      expect(groupA.length).toBeGreaterThanOrEqual(POPSTAR_MIN_GROUP);
      const resultA = tryPop(a, groupA);
      const resultB = tryPop(b, groupB);
      expect(resultA.popped).toBe(resultB.popped);
      expect(resultA.state.board).toEqual(resultB.state.board);
      a = resultA.state;
      b = resultB.state;
    }
  });

  it('不同种子发出来的棋盘不一样', () => {
    expect(createPopstarState(100).board).not.toEqual(createPopstarState(200).board);
    expect(dealBoard(1, 'a')).not.toEqual(dealBoard(1, 'b'));
  });
});

describe('无解兜底：不失败，剩下的星星飞回天上', () => {
  it('没有 ≥2 的组时，点一下就把剩下的星星收走并刷新棋盘', () => {
    const board = boardOf(['1.......', '.2......', '..3.....', '...0....', ...blankRows(6)]);
    const state = createPopstarState(11, { board, collected: 3, score: 3 });
    expect(largestGroup(state.board)).toEqual([]);

    const result = tryPop(state, [0]);
    expect(result.popped).toBe(0);
    expect(result.autoCollected).toBe(4);
    expect(result.state.collected).toBe(7);
    expect(result.state.score).toBe(7);
    expect(result.state.autoCollectedTotal).toBe(4);
    expect(result.state.status).toBe('playing');
    expect(filledCount(result.state.board)).toBe(POPSTAR_CELLS);
    expect(largestGroup(result.state.board).length).toBeGreaterThanOrEqual(POPSTAR_MIN_GROUP);
  });

  it('飞回天上的星星也计入目标；收够了就完成本轮', () => {
    const board = boardOf(['1.......', '.2......', '..3.....', '...0....', ...blankRows(6)]);
    const state = createPopstarState(11, { board, collected: 22, score: 22 });
    const result = tryPop(state, []);
    expect(result.autoCollected).toBe(4);
    expect(result.state.collected).toBe(26);
    expect(result.state.status).toBe('roundDone');
    expect(result.roundDone).toBe(true);
    expect(filledCount(result.state.board)).toBe(0);
  });
});

describe('三轮目标：24 / 32 / 40，完成一轮才进下一轮', () => {
  it('目标、剩余与竹筐比例', () => {
    expect(goalForRound(0)).toBe(POPSTAR_GOALS[0]);
    expect(goalForRound(1)).toBe(POPSTAR_GOALS[1]);
    expect(goalForRound(2)).toBe(POPSTAR_GOALS[2]);
    expect(goalForRound(99)).toBe(POPSTAR_GOALS[2]);
    const state = createPopstarState(1, { collected: 10, score: 10 });
    expect(remainingToGoal(state)).toBe(14);
    expect(roundProgress(state)).toBeCloseTo(10 / 24);
  });

  it('完成后不接受消除，进下一轮才继续；第三轮结束 -> done', () => {
    const pair = boardOf(['11......', ...blankRows(9)]);
    let state = createPopstarState(7, { board: pair, collected: 22, score: 22, round: 0 });
    state = tryPop(state, [0, 1]).state;
    expect(state.collected).toBe(24);
    expect(state.status).toBe('roundDone');
    const ignored = tryPop(state, [0, 1]);
    expect(ignored.popped).toBe(0);
    expect(ignored.state).toBe(state);

    state = advanceRound(state);
    expect(state.status).toBe('playing');
    expect(state.round).toBe(1);
    expect(state.collected).toBe(0);
    expect(state.score).toBe(24);
    expect(filledCount(state.board)).toBe(POPSTAR_CELLS);
    expect(advanceRound(state)).toBe(state);

    // 第二轮：本轮 30 + 2 = 32，整局 24 + 32 = 56
    state = tryPop({ ...state, board: pair, collected: 30, score: 54 }, [0, 1]).state;
    expect(state.status).toBe('roundDone');
    state = advanceRound(state);
    expect(state.round).toBe(2);
    expect(state.score).toBe(56);

    // 第三轮：本轮 38 + 2 = 40，整局 96 -> done
    state = tryPop({ ...state, board: pair, collected: 38, score: 94 }, [0, 1]).state;
    expect(state.status).toBe('roundDone');
    state = advanceRound(state);
    expect(state.status).toBe('done');
    expect(state.round).toBe(POPSTAR_ROUNDS - 1);
    expect(state.score).toBe(24 + 32 + 40);
    expect(filledCount(state.board)).toBe(0);
    expect(advanceRound(state)).toBe(state);
  });
});

describe('autoplay：选最大组、不空转、一局能走完', () => {
  it('每次都选当前最大的一组，并且走同一个 tryPop', () => {
    const board = boardOf(['22......', ...blankRows(7), '3333....', '........']);
    const state = createPopstarState(5, { board });
    const group = largestGroup(state.board);
    expect(group).toEqual([64, 65, 66, 67]);
    const result = tryPop(state, group);
    expect(result.popped).toBe(4);
    expect(result.state.collected).toBe(4);
    expect(result.state.board).not.toEqual(state.board);
  });

  it('整局在有限步内完成，每一步都真的前进了（不会无限空转）', () => {
    for (const seed of [1, 7, 42, 2024, 20261020]) {
      let state = createPopstarState(seed);
      let steps = 0;
      let pops = 0;
      while (state.status !== 'done' && steps < 400) {
        steps += 1;
        if (state.status === 'roundDone') {
          state = advanceRound(state);
          continue;
        }
        const group = largestGroup(state.board);
        expect(group.length).toBeGreaterThanOrEqual(POPSTAR_MIN_GROUP);
        const result = tryPop(state, group);
        expect(result.popped).toBe(group.length);
        expect(result.popped + result.autoCollected).toBeGreaterThan(0);
        state = result.state;
        pops += 1;
      }
      expect(state.status).toBe('done');
      expect(steps).toBeLessThan(200);
      expect(pops).toBeGreaterThan(0);
      // 三轮目标 24 / 32 / 40 加起来至少 96 颗
      expect(state.score).toBeGreaterThanOrEqual(24 + 32 + 40);
    }
  });

  it('组越大音调越高，封顶在舒服的音域', () => {
    expect(popTone(2)).toBeLessThan(popTone(5));
    expect(popTone(5)).toBeLessThan(popTone(9));
    expect(popTone(100)).toBeLessThanOrEqual(1200);
    expect(popTone(POPSTAR_MIN_GROUP)).toBeGreaterThan(0);
  });
});

describe('难度等级：level=1 与老行为一致，升级只加目标、不制造失败', () => {
  it('level=1 / 不传 level 时，三轮目标仍是 24 / 32 / 40', () => {
    expect(goalForRound(0, 1)).toBe(POPSTAR_GOALS[0]);
    expect(goalForRound(1, 1)).toBe(POPSTAR_GOALS[1]);
    expect(goalForRound(2, 1)).toBe(POPSTAR_GOALS[2]);
    expect(goalForRound(0)).toBe(24);
    expect(goalForRound(1)).toBe(32);
    expect(goalForRound(2)).toBe(40);
    expect(goalForRound(99, 1)).toBe(40);

    const state = createPopstarState(1);
    expect(state.level).toBe(1);
    expect(remainingToGoal(state)).toBe(24);
    expect(roundProgress(state)).toBe(0);
  });

  it('每升一级每轮 +2，随等级单调不减且不超过单轮上限', () => {
    for (let round = 0; round < POPSTAR_ROUNDS; round += 1) {
      let previous = 0;
      for (let level = POPSTAR_MIN_LEVEL; level <= POPSTAR_MAX_LEVEL; level += 1) {
        const goal = goalForRound(round, level);
        expect(goal).toBe(POPSTAR_GOALS[round] + (level - 1) * POPSTAR_GOAL_PER_LEVEL);
        expect(goal).toBeGreaterThanOrEqual(previous);
        expect(goal).toBeLessThanOrEqual(POPSTAR_MAX_GOAL);
        // 单轮目标始终远低于本轮最多能收集的 96 颗，永远凑得够
        expect(goal).toBeLessThan(POPSTAR_CELLS);
        previous = goal;
      }
    }
    // 12 级最难：46 / 54 / 62（整局 162），仍远低于三轮一共能收集的 288 颗
    expect([goalForRound(0, 12), goalForRound(1, 12), goalForRound(2, 12)]).toEqual([46, 54, 62]);
    // 上限 clamp 只是兜底保护（1..12 级够不到），越界等级也只会停在 12 级的目标
    expect(goalForRound(2, 999)).toBe(goalForRound(2, POPSTAR_MAX_LEVEL));
    expect(goalForRound(2, 999)).toBeLessThanOrEqual(POPSTAR_MAX_GOAL);
  });

  it('内部目标检查跟着 state.level 走，进下一轮也保留等级', () => {
    // 同一副棋盘、同样已收集 22：level=1 目标是 24（再消 2 颗就完成），level=5 目标是 32（还差 10 颗）
    const pair = boardOf(['11......', ...blankRows(9)]);
    const easy = createPopstarState(7, { board: pair, collected: 22, score: 22, level: 1 });
    const hard = createPopstarState(7, { board: pair, collected: 22, score: 22, level: 5 });
    expect(goalForRound(0, hard.level)).toBe(32);
    expect(remainingToGoal(hard)).toBe(10);
    expect(roundProgress(hard)).toBeCloseTo(22 / 32);
    expect(tryPop(easy, [0, 1]).state.status).toBe('roundDone');
    expect(tryPop(hard, [0, 1]).state.status).toBe('playing');

    // 用一副 4 星棋盘把 level=5 的第一轮做完，进下一轮后等级不丢、目标按 40 走
    const four = boardOf(['1111....', ...blankRows(9)]);
    let state = createPopstarState(7, { board: four, collected: 28, score: 28, level: 5 });
    state = tryPop(state, [0, 1, 2, 3]).state;
    expect(state.status).toBe('roundDone');
    expect(state.level).toBe(5);
    state = advanceRound(state);
    expect(state.round).toBe(1);
    expect(state.level).toBe(5);
    expect(remainingToGoal(state)).toBe(40);
    expect(roundProgress(state)).toBe(0);
  });

  it('无解飞回天上也按 state.level 结算：30 颗在 level=1 完成、level=5 还没完成', () => {
    const board = boardOf(['1230....', ...blankRows(9)]);
    expect(largestGroup(board)).toEqual([]);
    const easy = createPopstarState(11, { board, collected: 26, score: 26, level: 1 });
    const hard = createPopstarState(11, { board, collected: 26, score: 26, level: 5 });
    const easyResult = tryPop(easy, []);
    expect(easyResult.autoCollected).toBe(4);
    expect(easyResult.state.collected).toBe(30);
    expect(easyResult.state.status).toBe('roundDone');
    const hardResult = tryPop(hard, []);
    expect(hardResult.autoCollected).toBe(4);
    expect(hardResult.state.collected).toBe(30);
    expect(hardResult.state.status).toBe('playing');
  });

  it('level 越界 / 非法值兜底到 1..12，目标不会倒挂也不会崩', () => {
    expect(clampLevel(undefined)).toBe(POPSTAR_MIN_LEVEL);
    expect(clampLevel(Number.NaN)).toBe(POPSTAR_MIN_LEVEL);
    expect(clampLevel(Number.POSITIVE_INFINITY)).toBe(POPSTAR_MIN_LEVEL);
    expect(clampLevel(-5)).toBe(POPSTAR_MIN_LEVEL);
    expect(clampLevel(1.9)).toBe(1);
    expect(clampLevel(12.9)).toBe(POPSTAR_MAX_LEVEL);
    expect(clampLevel(999)).toBe(POPSTAR_MAX_LEVEL);

    for (const raw of [0, -3, 99, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const state = createPopstarState(3, { level: raw });
      expect(state.level).toBeGreaterThanOrEqual(POPSTAR_MIN_LEVEL);
      expect(state.level).toBeLessThanOrEqual(POPSTAR_MAX_LEVEL);
    }
    expect(createPopstarState(3).level).toBe(1);
    expect(createPopstarState(3, { level: 12 }).level).toBe(12);
    expect(goalForRound(0, 0)).toBe(24);
    expect(goalForRound(0, 999)).toBe(goalForRound(0, 12));
  });

  it('12 级（最难）autoplay 仍能在有限步内打完整局 3 轮，且每一步都真的前进', () => {
    const level = POPSTAR_MAX_LEVEL;
    const totalGoal = goalForRound(0, level) + goalForRound(1, level) + goalForRound(2, level);
    expect(totalGoal).toBe(162);
    for (const seed of [1, 7, 42, 2024, 20261020]) {
      let state = createPopstarState(seed, { level });
      expect(state.level).toBe(level);
      let steps = 0;
      let pops = 0;
      while (state.status !== 'done' && steps < 400) {
        steps += 1;
        if (state.status === 'roundDone') {
          state = advanceRound(state);
          continue;
        }
        const group = largestGroup(state.board);
        expect(group.length).toBeGreaterThanOrEqual(POPSTAR_MIN_GROUP);
        const result = tryPop(state, group);
        expect(result.popped).toBe(group.length);
        // 每一步都必须真的前进：消除或自动收星至少发生一件，绝不空转
        expect(result.popped + result.autoCollected).toBeGreaterThan(0);
        state = result.state;
        pops += 1;
      }
      expect(state.status).toBe('done');
      expect(steps).toBeLessThan(400);
      expect(pops).toBeGreaterThan(0);
      expect(state.level).toBe(level);
      // 每轮都至少收到目标数，整局分数必然不低于三轮目标之和
      expect(state.score).toBeGreaterThanOrEqual(totalGoal);
    }
  });
});
