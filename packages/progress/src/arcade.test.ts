import { describe, expect, it } from 'vitest';
import type { ProgressStore, SaveData } from '@bamboo/game-kit';
import { ARCADE_LEVEL_MAX, SAVE_SCHEMA_VERSION, arcadeLevelFor } from '@bamboo/game-kit';
import type { TaskSummary } from '@bamboo/content';
import {
  ARCADE_DAILY_PLAYS,
  arcadeAvailable,
  arcadeStatus,
  arcadeUnlocked,
  DAILY_TASK_TARGET,
  emptySave,
  isArcadeGameId,
  migrate,
  ProgressManager,
  withArcadePlay,
} from './index';

const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime();
const DAY = 86_400_000;
const TODAY = '2026-10-20';
const TOMORROW_KEY = '2026-10-21';

function task(id: TaskSummary['id']): TaskSummary {
  return {
    id,
    title: id,
    emoji: '🪥',
    color: '#e9b7a7',
    timeSlots: ['morning'],
    template: 'scrub',
    durationHintSec: 45,
    ageRange: [4, 8],
    unlockLevel: 1,
    stats: { clean: 10 },
    reward: { shoots: 2, xp: 10 },
    habit: '习惯',
    diary: '日记',
    tip: '提示',
  };
}

function memoryStore(initial: SaveData | null = null): ProgressStore & { current: SaveData | null } {
  const store = {
    current: initial,
    async load(): Promise<SaveData> {
      if (!store.current) throw new Error('empty');
      return store.current;
    },
    async save(data: SaveData): Promise<void> {
      store.current = data;
    },
  };
  return store;
}

/** 完成 n 件不同任务后的存档（走真实的 completeTask，不手搓日记录） */
async function completed(n: number): Promise<SaveData> {
  const manager = new ProgressManager(memoryStore(), () => T0);
  await manager.init();
  const ids: TaskSummary['id'][] = ['brush', 'wash', 'feed', 'dress', 'bath'];
  for (let i = 0; i < n; i += 1) await manager.completeTask(task(ids[i]!), 3);
  return manager.snapshot();
}

/** 解锁（完成四件小事）之后的 Manager，测试「局数」都在这个基础上跑 */
async function unlockedManager(now = T0): Promise<ProgressManager> {
  const manager = new ProgressManager(memoryStore(), () => now);
  await manager.init();
  const ids: TaskSummary['id'][] = ['brush', 'wash', 'feed', 'dress'];
  for (const id of ids) await manager.completeTask(task(id), 3);
  return manager;
}

describe('隐藏小游戏：解锁判定', () => {
  it('每天的目标就是今日推荐的件数（4）', () => {
    expect(DAILY_TASK_TARGET).toBe(4);
  });

  it('完成 3 件不同的小事不解锁，第 4 件才解锁', async () => {
    const three = await completed(3);
    expect(arcadeUnlocked(three.days[TODAY])).toBe(false);
    expect(arcadeStatus(three, T0).unlocked).toBe(false);

    const four = await completed(4);
    expect(arcadeUnlocked(four.days[TODAY])).toBe(true);
    expect(arcadeStatus(four, T0).unlocked).toBe(true);
  });

  it('重复玩同一件任务不算数：4 次同一条仍然是 1 件', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    for (let i = 0; i < 4; i += 1) await manager.completeTask(task('brush'), 3);
    const save = manager.snapshot();
    expect(save.days[TODAY]!.completed).toHaveLength(1);
    expect(arcadeUnlocked(save.days[TODAY])).toBe(false);
  });

  it('completeTask 只在跨过门槛的那一次标记 arcadeUnlocked', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    const ids: TaskSummary['id'][] = ['brush', 'wash', 'feed', 'dress'];
    const outcomes = [];
    for (const id of ids) outcomes.push(await manager.completeTask(task(id), 3));
    expect(outcomes.map((outcome) => outcome.arcadeUnlocked)).toEqual([false, false, false, true]);
    // 同一天再玩一件：门槛早已跨过，不再重复弹浮层
    expect((await manager.completeTask(task('bath'), 3)).arcadeUnlocked).toBe(false);
  });

  it('跨天重新攒：昨天解锁，今天又是 0 件', () => {
    const save = emptySave(T0);
    const yesterdayKey = '2026-10-19';
    const seeded: SaveData = {
      ...save,
      days: {
        ...save.days,
        [yesterdayKey]: { ...save.days[yesterdayKey]!, completed: ['brush', 'wash', 'feed', 'dress'] },
      },
    };
    expect(arcadeUnlocked(seeded.days[yesterdayKey])).toBe(true);
    expect(arcadeStatus(seeded, T0).unlocked).toBe(false);
  });
});

describe('难度等级：由累计局数派生（跨天保留）', () => {
  it('arcadeLevelFor：每 2 局升一级，1..ARCADE_LEVEL_MAX 封顶', () => {
    expect(ARCADE_LEVEL_MAX).toBe(12);
    expect(arcadeLevelFor(0)).toBe(1);
    expect(arcadeLevelFor(1)).toBe(1);
    expect(arcadeLevelFor(2)).toBe(2);
    expect(arcadeLevelFor(3)).toBe(2);
    expect(arcadeLevelFor(4)).toBe(3);
    expect(arcadeLevelFor(22)).toBe(ARCADE_LEVEL_MAX);
    expect(arcadeLevelFor(999)).toBe(ARCADE_LEVEL_MAX);
  });

  it('坏输入兜底到 1 级，不会出现 NaN / 0 / 负数', () => {
    expect(arcadeLevelFor(-5)).toBe(1);
    expect(arcadeLevelFor(Number.NaN)).toBe(1);
    expect(arcadeLevelFor(Number.POSITIVE_INFINITY)).toBe(ARCADE_LEVEL_MAX);
  });
});

describe('隐藏小游戏：每天最多 21 局（三款合计）', () => {
  it('未解锁时 playArcade 被拒绝', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    const outcome = await manager.playArcade('popstar', 30);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('notUnlocked');
    expect(outcome.level).toBe(1);
    expect(outcome.playsToday).toBe(0);
  });

  it('解锁后可以玩：最高分 / 总次数 / 今天玩过 / 今天局数 / 难度都记录', async () => {
    const manager = await unlockedManager();
    const first = await manager.playArcade('popstar', 42);
    expect(first.ok).toBe(true);
    expect(first.best).toBe(42);
    expect(first.plays).toBe(1);
    expect(first.level).toBe(1);
    expect(first.playsToday).toBe(1);

    const save = manager.snapshot();
    expect(save.arcade.popstar.best).toBe(42);
    expect(save.arcade.popstar.plays).toBe(1);
    expect(save.arcade.popstar.lastPlayedDay).toBe(TODAY);
    expect(save.days[TODAY]!.arcade).toEqual(['popstar']);
    expect(save.days[TODAY]!.arcadePlays).toBe(1);

    const status = arcadeStatus(save, T0);
    expect(status.playsToday).toBe(1);
    expect(status.dailyLimit).toBe(ARCADE_DAILY_PLAYS);
    expect(status.remainingPlays).toBe(ARCADE_DAILY_PLAYS - 1);
  });

  it('三款共用一个额度：连续玩 21 局都成功，第 22 局返回 limit', async () => {
    const manager = await unlockedManager();
    const ids = ['popstar', 'bounce', 'tetris'] as const;
    for (let i = 0; i < ARCADE_DAILY_PLAYS; i += 1) {
      const outcome = await manager.playArcade(ids[i % ids.length]!, 10 + i);
      expect(outcome.ok, '第 ' + (i + 1) + ' 局应该成功').toBe(true);
      expect(outcome.playsToday).toBe(i + 1);
    }

    const blocked = await manager.playArcade('popstar', 99);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('limit');
    expect(blocked.playsToday).toBe(ARCADE_DAILY_PLAYS);

    const save = manager.snapshot();
    expect(save.days[TODAY]!.arcadePlays).toBe(ARCADE_DAILY_PLAYS);
    expect(save.days[TODAY]!.arcade.slice().sort()).toEqual(['bounce', 'popstar', 'tetris']);
    expect(arcadeStatus(save, T0).remainingPlays).toBe(0);
    expect(arcadeAvailable(save, 'popstar', T0)).toBe(false);
    // 被拒绝的那一局不写档：三款总局数正好 7
    const totalPlays = save.arcade.popstar.plays + save.arcade.bounce.plays + save.arcade.tetris.plays;
    expect(totalPlays).toBe(ARCADE_DAILY_PLAYS);
  });

  it('同一款可以反复玩（只是占当天额度）：局数增加，难度按 2 局一级升', async () => {
    const manager = await unlockedManager();
    for (let i = 0; i < 4; i += 1) {
      const outcome = await manager.playArcade('popstar', 20 + i);
      expect(outcome.ok).toBe(true);
      expect(outcome.level).toBe(arcadeLevelFor(i + 1));
    }
    const save = manager.snapshot();
    expect(save.arcade.popstar.plays).toBe(4);
    expect(save.arcade.popstar.best).toBe(23);
    expect(save.days[TODAY]!.arcade).toEqual(['popstar']);
    expect(save.days[TODAY]!.arcadePlays).toBe(4);
  });

  it('第二天 00:00 局数归零，但成绩与难度接着昨天继续', async () => {
    const manager = await unlockedManager();
    for (let i = 0; i < 4; i += 1) await manager.playArcade('popstar', 10 + i);

    const tomorrow = T0 + DAY;
    await manager.refresh(tomorrow);
    // 新的一天：要重新完成 4 件小事才解锁
    expect(arcadeStatus(manager.snapshot(), tomorrow).unlocked).toBe(false);
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) {
      await manager.completeTask(task(id), 3, tomorrow);
    }

    const status = arcadeStatus(manager.snapshot(), tomorrow);
    expect(status.unlocked).toBe(true);
    expect(status.playsToday).toBe(0);
    expect(status.remainingPlays).toBe(ARCADE_DAILY_PLAYS);
    // 成绩与难度是跨天记录，不清零
    expect(manager.snapshot().arcade.popstar.plays).toBe(4);
    expect(manager.snapshot().arcade.popstar.best).toBe(13);

    const again = await manager.playArcade('popstar', 70, tomorrow);
    expect(again.ok).toBe(true);
    expect(again.best).toBe(70);
    expect(again.plays).toBe(5);
    expect(again.level).toBe(arcadeLevelFor(5));
    expect(again.playsToday).toBe(1);
    expect(manager.snapshot().days[TOMORROW_KEY]!.arcadePlays).toBe(1);
  });

  it('中途退出不写存档：没有 playArcade 调用就不消耗额度', async () => {
    const manager = await unlockedManager();
    const before = manager.snapshot();
    expect(arcadeAvailable(before, 'popstar', T0)).toBe(true);
    // 场景没发 arcade:complete → 什么都没变
    expect(arcadeAvailable(manager.snapshot(), 'popstar', T0)).toBe(true);
    expect(manager.snapshot().days[TODAY]!.arcadePlays).toBe(0);
  });

  it('死数据的 id 被识别为非法，playArcade 返回 unknown', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    expect(isArcadeGameId('popstar')).toBe(true);
    expect(isArcadeGameId('mario')).toBe(false);
    const outcome = await manager.playArcade('mario' as never, 1);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unknown');
  });
});

describe('隐藏彩蛋：竹林小路（当天无限畅玩、不设局数上限）', () => {
  it('没完成四件小事也能触发：小门打开、三款都能玩', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    expect(arcadeStatus(manager.snapshot(), T0).unlocked).toBe(false);

    const outcome = await manager.unlockArcadeSecret();
    expect(outcome.ok).toBe(true);
    expect(outcome.already).toBe(false);

    const status = manager.arcadeStatus();
    expect(status.unlocked).toBe(true);
    expect(status.unlimited).toBe(true);
    expect(manager.snapshot().days[TODAY]!.arcadeSecret).toBe(true);
    for (const id of ['popstar', 'bounce', 'tetris'] as const) {
      expect(arcadeAvailable(manager.snapshot(), id, T0)).toBe(true);
    }
  });

  it('重复触发不重复写档', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    expect((await manager.unlockArcadeSecret()).already).toBe(false);
    expect((await manager.unlockArcadeSecret()).already).toBe(true);
  });

  it('同一款可以一局接一局地玩：超过 21 局也不拦，难度持续上涨', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    await manager.unlockArcadeSecret();

    const total = ARCADE_DAILY_PLAYS + 2;
    for (let i = 0; i < total; i += 1) {
      const outcome = await manager.playArcade('popstar', 30 + i);
      expect(outcome.ok, '无限畅玩第 ' + (i + 1) + ' 局应该成功').toBe(true);
      expect(outcome.playsToday).toBe(i + 1);
      expect(outcome.level).toBe(arcadeLevelFor(i + 1));
    }
    const save = manager.snapshot();
    expect(save.arcade.popstar.plays).toBe(total);
    expect(save.days[TODAY]!.arcadePlays).toBe(total);
    // 局数上限只管普通模式：无限畅玩时 arcadeAvailable 一直是 true
    expect(arcadeAvailable(save, 'bounce', T0)).toBe(true);
    expect(arcadeStatus(save, T0).remainingPlays).toBe(0);
    expect(arcadeStatus(save, T0).unlimited).toBe(true);
  });

  it('无限畅玩只限当天：第二天回到 21 局上限，难度记录保留', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    await manager.unlockArcadeSecret();
    for (let i = 0; i < ARCADE_DAILY_PLAYS + 1; i += 1) await manager.playArcade('popstar', 40 + i);

    const tomorrow = T0 + DAY;
    await manager.refresh(tomorrow);
    expect(manager.arcadeStatus(tomorrow).unlimited).toBe(false);
    expect(manager.arcadeStatus(tomorrow).unlocked).toBe(false);
    expect(arcadeAvailable(manager.snapshot(), 'popstar', tomorrow)).toBe(false);

    // 第二天完成四件小事后：普通模式每天 21 局，难度与成绩继续
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) {
      await manager.completeTask(task(id), 3, tomorrow);
    }
    expect(manager.arcadeStatus(tomorrow).unlocked).toBe(true);
    expect(manager.arcadeStatus(tomorrow).unlimited).toBe(false);
    expect(manager.arcadeStatus(tomorrow).playsToday).toBe(0);
    expect(manager.snapshot().arcade.popstar.plays).toBe(ARCADE_DAILY_PLAYS + 1);

    for (let i = 0; i < ARCADE_DAILY_PLAYS; i += 1) {
      expect((await manager.playArcade('bounce', 20, tomorrow)).ok).toBe(true);
    }
    expect((await manager.playArcade('bounce', 30, tomorrow)).ok).toBe(false);
  });

  it('v2 老档（没有 arcadeSecret 字段）升级后默认 false，不会白送无限畅玩', () => {
    const old = emptySave(T0) as unknown as Record<string, unknown>;
    old.schemaVersion = 2;
    const day = (old.days as Record<string, unknown>)[TODAY] as Record<string, unknown>;
    delete day.arcadeSecret;
    const migrated = migrate(old, T0);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.days[TODAY]!.arcadeSecret).toBe(false);
  });
});

describe('隐藏小游戏：存档迁移与兜底', () => {
  it('v1 老档升级到最新版：补上 arcade 记录，竹笋星星一根不少', () => {
    const old = emptySave(T0) as unknown as Record<string, unknown>;
    old.schemaVersion = 1;
    delete old.arcade;
    const day = (old.days as Record<string, unknown>)[TODAY] as Record<string, unknown>;
    delete day.arcade;
    delete day.arcadePlays;
    (old.pet as Record<string, unknown>).shoots = 88;

    const migrated = migrate(old, T0);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.pet.shoots).toBe(88);
    expect(migrated.arcade.popstar).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.days[TODAY]!.arcade).toEqual([]);
    expect(migrated.days[TODAY]!.arcadePlays).toBe(0);
  });

  it('v3 老档没有 arcadePlays：按旧规则「今天玩过几款」兜底，不白送额度', () => {
    const old = emptySave(T0) as unknown as Record<string, unknown>;
    old.schemaVersion = 3;
    const day = (old.days as Record<string, unknown>)[TODAY] as Record<string, unknown>;
    day.arcade = ['popstar', 'bounce'];
    delete day.arcadePlays;

    const migrated = migrate(old, T0);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.days[TODAY]!.arcadePlays).toBe(2);
  });

  it('坏 id / 坏成绩逐条兜底，不连累整份存档', () => {
    const save = emptySave(T0) as unknown as Record<string, unknown>;
    save.arcade = { popstar: { best: 12, plays: 'x', lastPlayedDay: 'nope' }, bounce: 'bad' };
    const day = (save.days as Record<string, unknown>)[TODAY] as Record<string, unknown>;
    day.arcade = ['popstar', 'mario', 'popstar'];
    day.arcadePlays = 'bad';
    const migrated = migrate(save, T0);
    expect(migrated.arcade.popstar.best).toBe(12);
    expect(migrated.arcade.popstar.plays).toBe(0);
    expect(migrated.arcade.popstar.lastPlayedDay).toBeNull();
    expect(migrated.arcade.bounce).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.arcade.tetris).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.days[TODAY]!.arcade).toEqual(['popstar']);
    // arcadePlays 坏值：按去重后的 arcade 条数兜底
    expect(migrated.days[TODAY]!.arcadePlays).toBe(1);
  });

  it('withArcadePlay 是纯函数：不改原对象，最高分只增不减，今天局数 +1', () => {
    const save = emptySave(T0);
    const next = withArcadePlay(save, 'popstar', 30, T0);
    expect(save.arcade.popstar.best).toBe(0);
    expect(save.days[TODAY]!.arcadePlays).toBe(0);
    expect(next.arcade.popstar.best).toBe(30);
    expect(next.days[TODAY]!.arcadePlays).toBe(1);
    const lower = withArcadePlay(next, 'popstar', 5, T0);
    expect(lower.arcade.popstar.best).toBe(30);
    expect(lower.arcade.popstar.plays).toBe(2);
    expect(lower.days[TODAY]!.arcadePlays).toBe(2);
  });
});