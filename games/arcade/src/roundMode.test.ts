import { describe, expect, it } from 'vitest';
import { resolveRoundMode } from './roundMode';

describe('隐藏小游戏：一局结束后的去向', () => {
  it('无限畅玩 + 真实操作 → continuous（外壳接着开下一局）', () => {
    expect(resolveRoundMode(true, false)).toBe('continuous');
  });

  it('自动通关永远 once：不能被无限畅玩接走，否则 e2e/调试回不到游戏厅', () => {
    expect(resolveRoundMode(true, true)).toBe('once');
    expect(resolveRoundMode(false, true)).toBe('once');
  });

  it('普通模式（含未解锁无限畅玩）一律 once 结算回游戏厅', () => {
    expect(resolveRoundMode(false, false)).toBe('once');
  });
});
