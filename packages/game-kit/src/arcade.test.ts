import { describe, expect, it } from 'vitest';
import { ARCADE_LEVEL_EVERY_PLAYS, ARCADE_LEVEL_MAX, arcadeLevelFor } from './arcade';
import { ARCADE_GAME_IDS, CARE_ACTIONS, SAVE_SCHEMA_VERSION, speechLang } from './contract';

/**
 * game-kit 是"契约包"：这里只回归**纯函数与常量**的边界，
 * 实现侧（progress / platform / games）各自有行为测试。
 */

describe('arcadeLevelFor：难度等级由累计局数派生', () => {
  it('正常区间：每 2 局升一级，1 级起步，12 级封顶', () => {
    expect(arcadeLevelFor(0)).toBe(1);
    expect(arcadeLevelFor(1)).toBe(1);
    expect(arcadeLevelFor(2)).toBe(2);
    expect(arcadeLevelFor(ARCADE_LEVEL_EVERY_PLAYS * 3)).toBe(4);
    expect(arcadeLevelFor(ARCADE_LEVEL_MAX * ARCADE_LEVEL_EVERY_PLAYS)).toBe(ARCADE_LEVEL_MAX);
    expect(arcadeLevelFor(Number.MAX_SAFE_INTEGER)).toBe(ARCADE_LEVEL_MAX);
  });

  it('坏输入一律回到 1 级，绝不产出 NaN（NaN 会让界面显示 "Lv.NaN"）', () => {
    for (const bad of [
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      -1,
      -999,
      undefined as unknown as number,
      'many' as unknown as number,
      {} as unknown as number,
    ]) {
      expect(arcadeLevelFor(bad), String(bad)).toBe(1);
    }
  });

  it('小数向下取整；+Infinity 视为玩了很多局、封顶最高级', () => {
    expect(arcadeLevelFor(3.9)).toBe(2);
    expect(arcadeLevelFor(Number.POSITIVE_INFINITY)).toBe(ARCADE_LEVEL_MAX);
  });

  it('单调不减：局数增加等级不会倒退', () => {
    let previous = 0;
    for (let plays = 0; plays <= 100; plays += 1) {
      const level = arcadeLevelFor(plays);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(ARCADE_LEVEL_MAX);
      previous = level;
    }
  });
});

describe('契约常量：与存档 / 内容口径一致', () => {
  it('SAVE_SCHEMA_VERSION 是正整数（存档迁移链的分支起点）', () => {
    expect(Number.isInteger(SAVE_SCHEMA_VERSION)).toBe(true);
    expect(SAVE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('三款隐藏小游戏 id 唯一且固定（存档键、路由、游戏导出名都从这里取）', () => {
    expect([...ARCADE_GAME_IDS]).toEqual(['popstar', 'bounce', 'tetris']);
    expect(new Set(ARCADE_GAME_IDS).size).toBe(ARCADE_GAME_IDS.length);
  });

  it('三个亲昵动作唯一（存档 careDays 的键集合）', () => {
    expect(new Set(CARE_ACTIONS).size).toBe(CARE_ACTIONS.length);
    expect([...CARE_ACTIONS]).toEqual(['pat', 'hug', 'highfive']);
  });
});

describe('speechLang：BCP-47 语音标签', () => {
  it('en 必须映射成 en-US（"en" 不是合法语音标签），中文映射成 zh-CN', () => {
    expect(speechLang('en')).toBe('en-US');
    expect(speechLang('zh-CN')).toBe('zh-CN');
  });
});
