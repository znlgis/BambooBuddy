import { describe, expect, it } from 'vitest';
import type { ProgressStore, SaveData } from '@bamboo/game-kit';
import { SAVE_SCHEMA_VERSION } from '@bamboo/game-kit';
import type { TaskSummary } from '@bamboo/content';
import {
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

describe('隐藏小游戏：每天每款一次', () => {
  it('未解锁时 playArcade 被拒绝', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    const outcome = await manager.playArcade('popstar', 30);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('notUnlocked');
  });

  it('解锁后可以玩，记录最高分 / 次数 / 今天玩过；第二次被拒绝', async () => {
    const store = memoryStore();
    const manager = new ProgressManager(store, () => T0);
    await manager.init();
    const ids: TaskSummary['id'][] = ['brush', 'wash', 'feed', 'dress'];
    for (const id of ids) await manager.completeTask(task(id), 3);

    const first = await manager.playArcade('popstar', 42);
    expect(first.ok).toBe(true);
    expect(first.best).toBe(42);
    const save = manager.snapshot();
    expect(save.arcade.popstar.best).toBe(42);
    expect(save.arcade.popstar.plays).toBe(1);
    expect(save.arcade.popstar.lastPlayedDay).toBe(TODAY);
    expect(save.days[TODAY]!.arcade).toEqual(['popstar']);
    expect(arcadeStatus(save, T0).remaining).toEqual(['bounce', 'tetris']);

    const second = await manager.playArcade('popstar', 99);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already');
    // 最高分不会被第二次（被拒绝的）覆盖
    expect(manager.snapshot().arcade.popstar.best).toBe(42);
  });

  it('三款互不影响：同一天每款各一次', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) await manager.completeTask(task(id), 3);
    expect((await manager.playArcade('popstar', 10)).ok).toBe(true);
    expect((await manager.playArcade('bounce', 20)).ok).toBe(true);
    expect((await manager.playArcade('tetris', 30)).ok).toBe(true);
    expect(arcadeStatus(manager.snapshot(), T0).remaining).toEqual([]);
  });

  it('第二天 00:00 之后又能玩，最高分保留', async () => {
    const store = memoryStore();
    const manager = new ProgressManager(store, () => T0);
    await manager.init();
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) await manager.completeTask(task(id), 3);
    await manager.playArcade('popstar', 55);

    const tomorrow = T0 + DAY;
    const tomorrowKey = '2026-10-21';
    // 新的一天：先完成 4 件（真实流程），再玩
    await manager.refresh(tomorrow);
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) await manager.completeTask(task(id), 3, tomorrow);
    expect(arcadeStatus(manager.snapshot(), tomorrow).unlocked).toBe(true);
    const again = await manager.playArcade('popstar', 60, tomorrow);
    expect(again.ok).toBe(true);
    expect(again.best).toBe(60);
    expect(manager.snapshot().arcade.popstar.plays).toBe(2);
    expect(manager.snapshot().days[tomorrowKey]!.arcade).toEqual(['popstar']);
  });

  it('中途退出不写存档：没有 playArcade 调用就不消耗次数', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) await manager.completeTask(task(id), 3);
    const before = manager.snapshot();
    expect(arcadeAvailable(before, 'popstar', T0)).toBe(true);
    // 场景没发 arcade:complete → 什么都没变
    expect(arcadeAvailable(manager.snapshot(), 'popstar', T0)).toBe(true);
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

describe('隐藏彩蛋：竹林小路（当天无限畅玩）', () => {
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

  it('同一款可以一直玩：第二次仍然成功，总次数与最高分照常累计', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    await manager.unlockArcadeSecret();

    expect((await manager.playArcade('popstar', 30)).ok).toBe(true);
    const second = await manager.playArcade('popstar', 55);
    expect(second.ok).toBe(true);
    expect(second.best).toBe(55);
    expect(manager.snapshot().arcade.popstar.plays).toBe(2);
    expect(manager.snapshot().days[TODAY]!.arcade).toEqual(['popstar']);

    const third = await manager.playArcade('popstar', 20);
    expect(third.ok).toBe(true);
    expect(third.best).toBe(55);
    expect(manager.snapshot().arcade.popstar.plays).toBe(3);
  });

  it('无限畅玩只限当天：第二天没触发就又回到「每款一次」', async () => {
    const manager = new ProgressManager(memoryStore(), () => T0);
    await manager.init();
    await manager.unlockArcadeSecret();
    await manager.playArcade('popstar', 40);

    const tomorrow = T0 + DAY;
    await manager.refresh(tomorrow);
    expect(manager.arcadeStatus(tomorrow).unlimited).toBe(false);
    expect(manager.arcadeStatus(tomorrow).unlocked).toBe(false);
    expect(arcadeAvailable(manager.snapshot(), 'popstar', tomorrow)).toBe(false);

    // 第二天完成四件小事后：每款一次的限制回来了
    for (const id of ['brush', 'wash', 'feed', 'dress'] as const) {
      await manager.completeTask(task(id), 3, tomorrow);
    }
    expect(manager.arcadeStatus(tomorrow).unlocked).toBe(true);
    expect(manager.arcadeStatus(tomorrow).unlimited).toBe(false);
    expect((await manager.playArcade('bounce', 20, tomorrow)).ok).toBe(true);
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
    (old.pet as Record<string, unknown>).shoots = 88;

    const migrated = migrate(old, T0);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.pet.shoots).toBe(88);
    expect(migrated.arcade.popstar).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.days[TODAY]!.arcade).toEqual([]);
  });

  it('坏 id / 坏成绩逐条兜底，不连累整份存档', () => {
    const save = emptySave(T0) as unknown as Record<string, unknown>;
    save.arcade = { popstar: { best: 12, plays: 'x', lastPlayedDay: 'nope' }, bounce: 'bad' };
    const day = (save.days as Record<string, unknown>)[TODAY] as Record<string, unknown>;
    day.arcade = ['popstar', 'mario', 'popstar'];
    const migrated = migrate(save, T0);
    expect(migrated.arcade.popstar.best).toBe(12);
    expect(migrated.arcade.popstar.plays).toBe(0);
    expect(migrated.arcade.popstar.lastPlayedDay).toBeNull();
    expect(migrated.arcade.bounce).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.arcade.tetris).toEqual({ best: 0, plays: 0, lastPlayedDay: null });
    expect(migrated.days[TODAY]!.arcade).toEqual(['popstar']);
  });

  it('withArcadePlay 是纯函数：不改原对象，最高分只增不减', () => {
    const save = emptySave(T0);
    const next = withArcadePlay(save, 'popstar', 30, T0);
    expect(save.arcade.popstar.best).toBe(0);
    expect(next.arcade.popstar.best).toBe(30);
    const lower = withArcadePlay(next, 'popstar', 5, T0);
    expect(lower.arcade.popstar.best).toBe(30);
  });
});
