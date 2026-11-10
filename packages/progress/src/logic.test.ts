import { describe, expect, it } from 'vitest';
import type { DayRecord, ProgressStore, SaveData, Stars } from '@bamboo/game-kit';
import { SAVE_SCHEMA_VERSION } from '@bamboo/game-kit';
import type { TaskSummary } from '@bamboo/content';
import {
  addDays,
  applyStatDelta,
  careAvailable,
  clampStat,
  completionReward,
  currentSlot,
  dayKey,
  daysBetween,
  decayStats,
  emptyDay,
  emptySave,
  ensureDay,
  feedBird,
  fragmentsFor,
  harvestMultiplier,
  isDayKey,
  isFutureVersionSave,
  isHarvestDay,
  MAX_STORED_MISTAKES,
  migrate,
  MILESTONES,
  milestonesFor,
  nextMilestoneFor,
  nextStreak,
  progressFor,
  pruneDays,
  recommendedTasks,
  starsFor,
  statHints,
  statsDeltaFor,
  todayRecord,
  weekSummary,
  yesterdayOf,
} from './index';
import * as growth from './growth';
import * as intimacy from './intimacy';
import * as manager from './manager';
import * as rewards from './rewards';
import * as stats from './stats';

const DAY = 86_400_000;

/** 本地时间 2026-10-19 09:00（周一早上） */
const T0 = new Date(2026, 9, 19, 9, 0, 0).getTime();
const TODAY = '2026-10-19';

/** 本地时间 2026-10-24 09:00（周六 = 丰收日） */
const SAT = new Date(2026, 9, 24, 9, 0, 0).getTime();
const SAT_DAY = '2026-10-24';

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'brush',
    title: '刷牙',
    emoji: '🪥',
    color: '#e9b7a7',
    timeSlots: ['morning', 'evening'],
    template: 'scrub',
    durationHintSec: 45,
    ageRange: [4, 8],
    unlockLevel: 1,
    stats: { clean: 14, mood: 4 },
    reward: { shoots: 2, xp: 10 },
    habit: '早晚都要刷牙',
    diary: '今天帮竹竹刷了牙，牙齿亮晶晶。',
    tip: '上面下面都要刷到哦',
    ...overrides,
  };
}

const TASKS: TaskSummary[] = [
  task(),
  task({ id: 'feed', title: '吃饭', timeSlots: ['morning', 'noon', 'evening'], stats: { fullness: 20 }, reward: { shoots: 3, xp: 12 } }),
  task({ id: 'sleep', title: '睡觉', template: 'order', timeSlots: ['evening'], stats: { energy: 24 } }),
  task({ id: 'sport', title: '运动', template: 'rhythm', timeSlots: ['morning', 'noon'], stats: { health: 10 } }),
  task({ id: 'learn', title: '学习', template: 'learn', timeSlots: ['morning', 'noon'], stats: { mood: 8 } }),
];

/**
 * 内存版 ProgressStore。
 * 注意：`current === null` 表示"这台设备还没存过档"，对应的应该是 emptySave（真实
 * IndexedDB store 对空档就是 resolve 空档），而不是 reject —— 读档失败不往这里模拟。
 */
function memoryStore(initial: SaveData | null = null): ProgressStore & { current: SaveData | null; writes: number } {
  const store = {
    current: initial,
    writes: 0,
    async load(): Promise<SaveData> {
      return store.current ?? emptySave(T0);
    },
    async save(data: SaveData): Promise<void> {
      store.current = data;
      store.writes += 1;
    },
  };
  return store;
}

describe('日期与时段', () => {
  it('按本地墙钟取日期键', () => {
    expect(dayKey(T0)).toBe(TODAY);
  });

  it('跨月/跨年算天数', () => {
    expect(daysBetween('2026-10-19', '2026-10-22')).toBe(3);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('bad', TODAY)).toBe(0);
  });

  it('加天数与"昨天"', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(yesterdayOf(TODAY)).toBe('2026-10-18');
  });

  it('早上/中午/晚上按小时分', () => {
    expect(currentSlot(new Date(2026, 9, 19, 7, 30).getTime())).toBe('morning');
    expect(currentSlot(new Date(2026, 9, 19, 12, 0).getTime())).toBe('noon');
    expect(currentSlot(new Date(2026, 9, 19, 20, 0).getTime())).toBe('evening');
  });
});

describe('五维状态', () => {
  const stats80 = { fullness: 80, energy: 80, clean: 80, mood: 80, health: 80 };

  it('永远不归零，也不会超过 100', () => {
    expect(clampStat(-100)).toBe(stats.STAT_MIN);
    expect(clampStat(300)).toBe(stats.STAT_MAX);
    expect(clampStat(Number.NaN)).toBe(stats.STAT_MIN);
  });

  it('任务收益只增不减', () => {
    const next = applyStatDelta(stats80, { clean: 15, mood: 5 });
    expect(next.clean).toBe(95);
    expect(next.mood).toBe(85);
    expect(next.fullness).toBe(80);
  });

  it('按天衰减且最多 7 天', () => {
    expect(decayStats(stats80, 1).clean).toBe(70);
    expect(decayStats(stats80, 100).fullness).toBe(stats.STAT_MIN);
  });

  it('只在低状态时给最多两条提示，且提示"去做什么"', () => {
    expect(statHints(stats80)).toEqual([]);
    const hints = statHints({ fullness: 20, energy: 25, clean: 90, mood: 90, health: 90 });
    expect(hints).toHaveLength(2);
    expect(hints[0]?.taskId).toBe('feed');
    expect(hints[1]?.taskId).toBe('sleep');
  });
});

describe('成长阶段', () => {
  it('四个阶段按成长值切换', () => {
    expect(growth.stageForXp(0).id).toBe(1);
    expect(growth.stageForXp(59).id).toBe(1);
    expect(growth.stageForXp(60).id).toBe(2);
    expect(growth.stageForXp(160).id).toBe(3);
    expect(growth.stageForXp(300).id).toBe(4);
    expect(growth.stageForXp(9999).id).toBe(4);
  });

  it('到顶之后没有下一阶段', () => {
    expect(growth.nextStageForXp(300)).toBeNull();
    expect(growth.xpToNextStage(300)).toBe(0);
    expect(growth.xpToNextStage(55)).toBe(5);
  });

  it('距离下一阶段越来越近：成长值增加，剩余值单调递减', () => {
    expect(growth.xpToNextStage(0)).toBe(60);
    expect(growth.xpToNextStage(59)).toBe(1);
    expect(growth.xpToNextStage(100)).toBe(60);
    expect(growth.xpToNextStage(299)).toBe(1);
  });
});

describe('今日任务推荐', () => {
  it('同一天同一时段永远推荐同一组（确定性）', () => {
    const a = recommendedTasks(TODAY, 'morning', TASKS).map((t) => t.id);
    const b = recommendedTasks(TODAY, 'morning', TASKS).map((t) => t.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(new Set(a).size).toBe(4);
  });

  it('一定包含当前时段的任务，且优先排在前面', () => {
    const picked = recommendedTasks(TODAY, 'evening', TASKS);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.some((t) => t.timeSlots.includes('evening'))).toBe(true);
    expect(picked[0]?.timeSlots.includes('evening')).toBe(true);
  });

  it('跨日期可以换一组（不是永远同一套）', () => {
    const days = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      days.add(recommendedTasks(addDays(TODAY, i), 'noon', TASKS).map((t) => t.id).join(','));
    }
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('奖励与连续天数', () => {
  it('星星只给 1–3 颗，没有 0 颗', () => {
    expect(starsFor(0)).toBe(3);
    expect(starsFor(3)).toBe(2);
    expect(starsFor(99)).toBe(1);
  });

  it('当天第一次给全份，重复玩给一半（最低 1 根 / 3 点）', () => {
    expect(completionReward(task(), true)).toEqual({ shoots: 2, xp: 10, fragments: 0 });
    expect(completionReward(task(), false)).toEqual({ shoots: 1, xp: 5, fragments: 0 });
    expect(completionReward(task({ reward: { shoots: 1, xp: 5 } }), false)).toEqual({ shoots: 1, xp: 3, fragments: 0 });
  });

  it('每完成 3 个不同任务给一枚装扮碎片', () => {
    expect(fragmentsFor(2, true)).toBe(0);
    expect(fragmentsFor(3, true)).toBe(1);
    expect(fragmentsFor(6, true)).toBe(1);
    expect(fragmentsFor(3, false)).toBe(0);
  });

  it('连续天数：昨天玩过 +1、同一天不变、断了重来', () => {
    expect(nextStreak(yesterdayOf(TODAY), TODAY, 2)).toBe(3);
    expect(nextStreak(TODAY, TODAY, 2)).toBe(2);
    expect(nextStreak('2026-10-01', TODAY, 9)).toBe(1);
    expect(nextStreak(null, TODAY, 0)).toBe(1);
  });

  it('连续 3 天给贴纸，且每个任务只有一张', () => {
    expect(rewards.earnsSticker(3, false)).toBe(true);
    expect(rewards.earnsSticker(3, true)).toBe(false);
    expect(rewards.earnsSticker(2, false)).toBe(false);
  });
});

describe('亲密度', () => {
  it('按亲密度分档并解锁小动作', () => {
    expect(intimacy.intimacyLevel(0).name).toBe('初次见面');
    expect(intimacy.intimacyLevel(5).name).toBe('好朋友');
    expect(intimacy.intimacyLevel(35).level).toBe(5);
    // 12 点这一档解锁的小动作（原先由 unlockedGestures 断言，函数已删：UI 只用 intimacyLevel）
    expect(intimacy.intimacyLevel(12).gesture).toBe('转圈圈');
  });

  it('每个亲昵动作每天各一次', () => {
    expect(careAvailable({}, 'pat', TODAY)).toBe(true);
    expect(careAvailable({ pat: TODAY }, 'pat', TODAY)).toBe(false);
    expect(careAvailable({ pat: TODAY }, 'hug', TODAY)).toBe(true);
  });
});

describe('存档迁移', () => {
  it('空/坏数据回落到空档', () => {
    expect(migrate(null, T0).pet.name).toBe('竹竹');
    expect(migrate('nope', T0).schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrate({ schemaVersion: 99 }, T0).tasks.brush.completions).toBe(0);
  });

  it('未来字段与坏字段逐条兜底', () => {
    const out = migrate(
      {
        schemaVersion: 1,
        pet: { xp: -5, shoots: 'many', stats: { clean: 999 }, stickers: ['ghost'], unlocked: ['shoes-red', 'nope'] },
        tasks: { brush: { stars: 9, completions: 2 } },
        days: {
          [TODAY]: { completed: ['brush', 'ghost', 'brush'], rewards: { shoots: 2 } },
          'not-a-date': { completed: ['feed'] },
        },
      },
      T0,
    );
    expect(out.pet.xp).toBe(0);
    expect(out.pet.shoots).toBe(0);
    expect(out.pet.stats.clean).toBe(stats.STAT_MAX);
    expect(out.pet.stickers).toEqual([]);
    expect(out.pet.unlocked.sort()).toEqual(['room-rug-green', 'room-wall-cream', 'shoes-red']);
    expect(out.tasks.brush.stars).toBe(3);
    expect(out.tasks.brush.completions).toBe(2);
    expect(out.tasks.feed.completions).toBe(0);
    expect(out.days[TODAY]?.completed).toEqual(['brush']);
    expect(out.days['not-a-date']).toBeUndefined();
  });

  it('默认墙纸与地毯永远存在', () => {
    const out = migrate({ schemaVersion: 1 }, T0);
    expect(out.pet.room.wallpaper).toBe('room-wall-cream');
    expect(out.pet.room.rug).toBe('room-rug-green');
  });

  it('只保留最近 30 天', () => {
    const days: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) days[addDays(TODAY, -i)] = { completed: ['brush'] };
    const out = migrate({ schemaVersion: 1, days }, T0);
    expect(Object.keys(out.days)).toHaveLength(30);
    expect(out.days[TODAY]).toBeDefined();
  });

  it('ensureDay 会补上今天', () => {
    const data = { ...emptySave(T0), days: {} };
    expect(ensureDay(data, T0).days[TODAY]).toBeDefined();
  });

  it('空档里的十个任务都登记了', () => {
    expect(Object.keys(emptySave(T0).tasks)).toHaveLength(10);
  });
});

describe('ProgressManager：完成 -> 奖励 -> 存档', () => {
  it('第一次完成给全份奖励、加状态、记连续天数', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const before = pm.snapshot().pet;
    const result = await pm.completeTask(task(), 3, T0);
    const after = pm.snapshot();

    expect(result.isFirstToday).toBe(true);
    expect(result.shoots).toBe(2);
    expect(result.xp).toBe(10);
    expect(after.pet.shoots).toBe(before.shoots + 2);
    expect(after.pet.xp).toBe(before.xp + 10);
    expect(after.pet.stats.clean).toBe(before.stats.clean + 14);
    expect(after.tasks.brush.completions).toBe(1);
    expect(after.tasks.brush.streak).toBe(1);
    expect(after.tasks.brush.stars).toBe(3);
    expect(after.days[TODAY]?.completed).toEqual(['brush']);
    expect(store.current).toBe(after);
  });

  it('同一天重复玩：奖励减半、日记录不重复', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 3, T0);
    const shootsAfterFirst = pm.snapshot().pet.shoots;
    const result = await pm.completeTask(task(), 2, T0);
    expect(result.isFirstToday).toBe(false);
    expect(result.shoots).toBe(1);
    expect(result.xp).toBe(5);
    expect(pm.snapshot().pet.shoots).toBe(shootsAfterFirst + 1);
    expect(pm.snapshot().days[TODAY]?.completed).toEqual(['brush']);
    expect(pm.snapshot().tasks.brush.completions).toBe(2);
    expect(pm.snapshot().tasks.brush.stars).toBe(3);
  });

  it('连续三天完成同一任务：贴纸 + 连续天数增长', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 3, T0);
    await pm.completeTask(task(), 3, T0 + DAY);
    expect(pm.snapshot().tasks.brush.streak).toBe(2);
    expect(pm.snapshot().pet.stickers).toEqual([]);
    const third = await pm.completeTask(task(), 3, T0 + 2 * DAY);
    expect(third.sticker).toBe(true);
    expect(pm.snapshot().tasks.brush.streak).toBe(3);
    expect(pm.snapshot().pet.stickers).toEqual(['brush']);
  });

  it('第三个不同任务给一枚装扮碎片', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 3, T0);
    await pm.completeTask(task({ id: 'feed', title: '吃饭' }), 3, T0);
    const third = await pm.completeTask(task({ id: 'sleep', title: '睡觉' }), 3, T0);
    expect(third.fragments).toBe(1);
    expect(pm.snapshot().pet.fragments).toBe(1);
  });

  it('跨天打开时状态衰减一次（最多 7 天）', async () => {
    const initial = emptySave(T0);
    initial.pet.lastDecayDay = addDays(TODAY, -2);
    initial.pet.stats.clean = 90;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    expect(pm.snapshot().pet.stats.clean).toBe(90 - 20);
    expect(pm.snapshot().pet.lastDecayDay).toBe(TODAY);
  });
});

describe('ProgressManager：亲昵、喂食、解锁、清除', () => {
  it('摸头/抱抱/击掌每天各一次', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const first = await pm.care('hug', T0);
    expect(first.ok).toBe(true);
    expect(first.intimacy).toBe(2);
    const again = await pm.care('hug', T0);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already');
    const nextDay = await pm.care('hug', T0 + DAY);
    expect(nextDay.ok).toBe(true);
  });

  it('喂竹笋消耗一根，没有竹笋时温柔拒绝', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const feed = await pm.feed(T0);
    expect(feed.ok).toBe(true);
    expect(pm.snapshot().pet.feeds).toBe(1);
    while (pm.snapshot().pet.shoots > 0) await pm.feed(T0);
    const empty = await pm.feed(T0);
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('noShoots');
  });

  it('解锁要看成长阶段，解锁后自动穿上', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 100;
    initial.pet.xp = 0;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();

    const levelBlocked = await pm.unlock('hat-straw', T0); // 需要阶段 2
    expect(levelBlocked.ok).toBe(false);
    expect(levelBlocked.reason).toBe('level');

    const ok = await pm.unlock('hat-bamboo', T0);
    expect(ok.ok).toBe(true);
    expect(pm.snapshot().pet.shoots).toBe(92);
    expect(pm.snapshot().pet.equipped.hat).toBe('hat-bamboo');

    const twice = await pm.unlock('hat-bamboo', T0);
    expect(twice.reason).toBe('owned');

    const off = await pm.equip('hat-bamboo', T0);
    expect(off.ok).toBe(true);
    expect(pm.snapshot().pet.equipped.hat).toBeUndefined();
  });

  it('解锁房间物件并切换', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 100;
    initial.pet.fragments = 5;
    initial.pet.xp = 300;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const res = await pm.unlock('room-bed-cloud', T0);
    expect(res.ok).toBe(true);
    expect(pm.snapshot().pet.room.bed).toBe('room-bed-cloud');
    await pm.equip('room-wall-cream', T0);
    expect(pm.snapshot().pet.room.wallpaper).toBe('room-wall-cream');
  });

  it('清除存档回到初始状态', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 3, T0);
    await pm.clear(T0);
    expect(pm.snapshot().pet.xp).toBe(0);
    expect(pm.snapshot().tasks.brush.completions).toBe(0);
    expect(store.current?.pet.xp).toBe(0);
  });

  it('玩耍时长累加、休息提醒只收起一次', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.addPlaySeconds(30, T0);
    await pm.addPlaySeconds(40, T0);
    expect(pm.snapshot().days[TODAY]?.seconds).toBe(70);
    await pm.dismissRest(T0);
    expect(pm.snapshot().days[TODAY]?.restDismissed).toBe(true);
  });
});

describe('日记与每周回顾', () => {
  it('最近七天由旧到新，缺的日子也有位置', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 3, T0);
    const week = weekSummary(pm.snapshot(), T0);
    expect(week).toHaveLength(7);
    expect(week[6]?.isToday).toBe(true);
    expect(week[6]?.completed).toEqual(['brush']);
    expect(week[0]?.completed).toEqual([]);
    expect(todayRecord(pm.snapshot(), T0).completed).toEqual(['brush']);
  });
});

describe('内容层与存档层解耦', () => {
  it('纯逻辑层没有用到随机数与隐式时钟（由 eslint 守卫，这里只做语义断言）', () => {
    // 同一天推荐两次结果一致已在上面的测试里验证；
    // 这里再确认一遍纯函数不会因为当前时间不同而改变
    const morning = recommendedTasks(TODAY, 'morning', TASKS).map((t) => t.id);
    expect(morning).toEqual(recommendedTasks(TODAY, 'morning', TASKS).map((t) => t.id));
  });
});
describe('坏档与时钟异常：今天永远不能被裁掉', () => {
  /** 30 个比今天更晚的日期键（设备时钟被调快过 + 调试写入未来日期都会造成） */
  function futureDays(): Record<string, DayRecord> {
    const days: Record<string, DayRecord> = {};
    for (let i = 1; i <= 30; i += 1) days[addDays(TODAY, i)] = emptyDay(addDays(TODAY, i));
    return days;
  }

  it('pruneDays 保留 today 与未来键（纯函数）', () => {
    const pruned = pruneDays({ ...futureDays(), [TODAY]: emptyDay(TODAY) }, 30, TODAY);
    expect(pruned[TODAY]).toBeDefined();
    expect(Object.keys(pruned)).toHaveLength(31);
  });

  it('migrate / ensureDay 之后今天仍然存在（不再"补完又裁掉"）', () => {
    const raw = { ...emptySave(T0), days: futureDays() };
    const migrated = migrate(raw, T0);
    expect(migrated.days[TODAY]).toBeDefined();
    const ensured = ensureDay({ ...migrated, days: futureDays() }, T0);
    expect(ensured.days[TODAY]).toBeDefined();
  });

  it('今天缺失时 completeTask / care / addPlaySeconds 不抛异常', async () => {
    const initial = emptySave(T0);
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    // 把内存里的今天硬删掉，模拟"裁剪后今天丢失"的坏档状态
    const broken = { ...pm.snapshot(), days: futureDays() };
    (pm as unknown as { data: SaveData }).data = broken;

    const completion = await pm.completeTask(task({ unlockLevel: 1 }), 3, T0);
    expect(completion.ok).toBe(true);
    expect(pm.snapshot().days[TODAY]?.completed).toEqual(['brush']);

    const care = await pm.care('pat', T0);
    expect(care.ok).toBe(true);

    await pm.addPlaySeconds(30, T0);
    expect(pm.snapshot().days[TODAY]?.seconds).toBe(30);
  });
});

describe('读档失败与未来版本：宁可拒绝写入也不覆盖原档', () => {
  it('load reject 时 init 抛错，且不会拿空档写盘', async () => {
    let writes = 0;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        throw new Error('IndexedDB read failed');
      },
      async save(): Promise<void> {
        writes += 1;
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await expect(pm.init()).rejects.toThrow('IndexedDB read failed');
    expect(writes).toBe(0);
  });

  it('读档失败后所有写操作都拒绝（不得以空档覆盖）', async () => {
    let writes = 0;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        throw new Error('boom');
      },
      async save(): Promise<void> {
        writes += 1;
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await expect(pm.init()).rejects.toThrow('boom');
    await expect(pm.care('pat', T0)).rejects.toThrow('boom');
    expect(writes).toBe(0);
  });

  it('读档失败不是永久只读：下一次 init / 写操作会重试读档，成功后正常结算并落盘', async () => {
    let attempts = 0;
    const real = emptySave(T0);
    real.pet.shoots = 9;
    let disk: SaveData = real;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        attempts += 1;
        if (attempts === 1) throw new Error('transient IDB timeout');
        return real;
      },
      async save(data: SaveData): Promise<void> {
        disk = data;
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    // 第一次读档失败：调用方拿到错误、磁盘一个字都没写
    await expect(pm.init()).rejects.toThrow('transient IDB timeout');
    expect(attempts).toBe(1);
    // 失败不能把管理器锁成"本次会话永久只读"：再试一次就能读到真实存档
    const loaded = await pm.init();
    expect(attempts).toBe(2);
    expect(loaded.pet.shoots).toBe(9);
    await pm.feed(T0);
    expect(pm.snapshot().pet.shoots).toBe(8);
    expect(disk.pet.shoots).toBe(8);
  });

  it('未来版本存档：init 抛错、原档不被覆盖，clear() 仍可用作自救', async () => {
    const rawFuture = { schemaVersion: 99, pet: { xp: 123 }, tasks: {}, days: {} };
    let disk: unknown = rawFuture;
    let writes = 0;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        // 真实 web store 会先 migrate：这里模拟"migrate 降级出来的空档带未来版本标记"
        return migrate(rawFuture, T0);
      },
      async save(data: SaveData): Promise<void> {
        disk = data;
        writes += 1;
      },
    };
    expect(isFutureVersionSave(migrate(rawFuture, T0))).toBe(true);

    const pm = new manager.ProgressManager(store, () => T0, T0);
    await expect(pm.init()).rejects.toThrow();
    expect(writes).toBe(0);
    expect(disk).toBe(rawFuture);

    // 家长页清档是唯一被允许的写入口
    await pm.clear(T0);
    expect(writes).toBe(1);
    expect((disk as SaveData).pet.xp).toBe(0);
  });
});

describe('读档期间写入：等待读档而不是覆盖旧档', () => {
  it('load 未完成时 care() 会等读档完成，并以真实存档为底结算', async () => {
    const real = emptySave(T0);
    real.pet.intimacy = 10;
    real.pet.shoots = 50;
    let release: ((save: SaveData) => void) | null = null;
    let disk: SaveData = real;
    const store: ProgressStore = {
      load: () =>
        new Promise<SaveData>((resolve) => {
          release = resolve;
        }),
      async save(data: SaveData): Promise<void> {
        disk = data;
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    const initPromise = pm.init();
    const carePromise = pm.care('hug', T0); // 读档完成前的点击
    await Promise.resolve();
    release!(real);
    await initPromise;
    const care = await carePromise;

    expect(care.ok).toBe(true);
    expect(pm.snapshot().pet.intimacy).toBe(12); // 10 + 2，而不是空的 0 + 2
    expect(pm.snapshot().pet.shoots).toBe(50); // 旧档没有被空档覆盖
    expect(disk.pet.shoots).toBe(50);
  });

  it('没 await init 就调用写方法时，init 完成后不覆盖这次写入', async () => {
    const real = emptySave(T0);
    real.pet.shoots = 7;
    let disk: SaveData = real;
    const store: ProgressStore = {
      load: () => new Promise<SaveData>((resolve) => setTimeout(() => resolve(real), 40)),
      async save(data: SaveData): Promise<void> {
        disk = data;
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    // 构造函数不会自动 init：这里直接写（等价于调用方忘了 await init）
    const feedPromise = pm.feed(T0);
    const initPromise = pm.init();
    await initPromise;
    const fed = await feedPromise;
    expect(fed.feeds).toBe(1);
    expect(pm.snapshot().pet.feeds).toBe(1);
    expect(pm.snapshot().pet.shoots).toBe(6);
    expect(disk.pet.feeds).toBe(1);
  });
});

describe('运行时输入校验（类型断言不能代替校验）', () => {
  it('阶段不足时 completeTask 返回 locked，且不写任何奖励', async () => {
    const before = emptySave(T0);
    before.pet.xp = 0; // 阶段 1
    const store = memoryStore(before);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();

    const outcome = await pm.completeTask(task({ id: 'sport', unlockLevel: 3 }), 3, T0);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('locked');
    expect(outcome.shoots).toBe(0);
    expect(pm.snapshot().pet.xp).toBe(0);
    expect(pm.snapshot().days[TODAY]?.completed).toEqual([]);
    expect(pm.snapshot().tasks.sport.completions).toBe(0);
  });

  it('越界星星被夹到 0..3', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.completeTask(task(), 9 as Stars, T0);
    expect(pm.snapshot().tasks.brush.stars).toBe(3);
    expect(store.current?.tasks.brush.stars).toBe(3);
  });

  it('NaN 时长不会写进日记录', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.addPlaySeconds(30, T0);
    await pm.addPlaySeconds(Number.NaN, T0);
    expect(pm.snapshot().days[TODAY]?.seconds).toBe(30);
  });

  it('成长值对 NaN 有兜底（不再显示 NaN）', () => {
    expect(growth.xpToNextStage(Number.NaN)).toBe(60);
    expect(growth.stageForXp(Number.NaN).id).toBe(1);
  });

  it('非法日历日（2026-02-31）不会被算成 3 月 3 日', () => {
    expect(daysBetween('2026-02-31', '2026-03-03')).toBe(0);
    expect(addDays('2026-02-31', 1)).toBe('2026-02-31');
  });
});
/* ================================================================== *
 * 存档 v5：累计件数 / 喂小鸟 / 上一次失误 / 30 分钟收尾（P1-3/4/5/7）
 * ================================================================== */

describe('存档 v5：累计件数 / 喂小鸟 / 上一次失误 / 30 分钟收尾', () => {
  /** 一份完整的 v4 老档：既有字段全在，v5 新字段一个都没有 */
  function v4Save(): Record<string, unknown> {
    return {
      schemaVersion: 4,
      updatedAt: T0,
      pet: {
        name: '竹竹',
        xp: 120,
        stats: { fullness: 60, energy: 70, clean: 80, mood: 90, health: 85 },
        lastDecayDay: TODAY,
        shoots: 12,
        fragments: 2,
        unlocked: ['hat-bamboo'],
        stickers: ['brush'],
        intimacy: 6,
        careDays: { pat: TODAY },
        equipped: { hat: 'hat-bamboo' },
        room: { wallpaper: 'room-wall-cream', rug: 'room-rug-green' },
        feeds: 4,
      },
      tasks: {
        brush: {
          taskId: 'brush',
          stars: 3,
          completions: 5,
          lastPlayedAt: T0,
          lastCompletedDay: TODAY,
          streak: 3,
          bestStreak: 3,
        },
        feed: {
          taskId: 'feed',
          stars: 2,
          completions: 2,
          lastPlayedAt: T0 - DAY,
          lastCompletedDay: yesterdayOf(TODAY),
          streak: 1,
          bestStreak: 2,
        },
      },
      arcade: {
        popstar: { best: 42, plays: 6, lastPlayedDay: TODAY },
        bounce: { best: 0, plays: 0, lastPlayedDay: null },
        tetris: { best: 0, plays: 0, lastPlayedDay: null },
      },
      days: {
        [TODAY]: {
          date: TODAY,
          completed: ['brush', 'feed'],
          rewards: { shoots: 5, xp: 22, fragments: 0 },
          stickers: ['brush'],
          care: ['pat'],
          seconds: 300,
          restDismissed: true,
          arcade: ['popstar'],
          arcadePlays: 3,
          arcadeSecret: false,
        },
      },
    };
  }

  it('v4 → v5：版本升级、新字段齐全，竹笋/星星/贴纸一根不少', () => {
    const out = migrate(v4Save(), T0);
    expect(out.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(5);
    // v5 新字段
    expect(out.pet.totalCompletions).toBe(7); // 5 + 2：由各任务 completions 之和回填
    expect(out.pet.birdFeeds).toBe(0);
    expect(out.tasks.brush.lastMistakes).toBe(0);
    expect(out.tasks.feed.lastMistakes).toBe(0);
    expect(out.days[TODAY]?.restWrapDismissed).toBe(false);
    // 老档的数值与既有字段一个都不能丢
    expect(out.pet.shoots).toBe(12);
    expect(out.pet.xp).toBe(120);
    expect(out.pet.fragments).toBe(2);
    expect(out.pet.feeds).toBe(4);
    expect(out.pet.intimacy).toBe(6);
    expect(out.pet.stickers).toEqual(['brush']);
    expect(out.pet.equipped.hat).toBe('hat-bamboo');
    expect(out.tasks.brush.stars).toBe(3);
    expect(out.tasks.brush.completions).toBe(5);
    expect(out.tasks.brush.streak).toBe(3);
    expect(out.tasks.feed.bestStreak).toBe(2);
    expect(out.days[TODAY]?.completed).toEqual(['brush', 'feed']);
    expect(out.days[TODAY]?.rewards).toEqual({ shoots: 5, xp: 22, fragments: 0 });
    expect(out.days[TODAY]?.restDismissed).toBe(true);
    expect(out.days[TODAY]?.arcadePlays).toBe(3);
    expect(out.arcade.popstar).toEqual({ best: 42, plays: 6, lastPlayedDay: TODAY });
  });

  it('空档默认值：新字段都有安全默认（新档不会硬夸「进步」）', () => {
    const empty = emptySave(T0);
    expect(empty.pet.totalCompletions).toBe(0);
    expect(empty.pet.birdFeeds).toBe(0);
    expect(empty.tasks.brush.lastMistakes).toBe(0);
    expect(empty.days[TODAY]?.restWrapDismissed).toBe(false);
  });

  it('坏字段逐条兜底：totalCompletions 负数 / NaN / 字符串', () => {
    const tasks = { brush: { completions: 4 } };
    expect(migrate({ schemaVersion: 4, pet: { totalCompletions: -5 }, tasks }, T0).pet.totalCompletions).toBe(4);
    expect(
      migrate({ schemaVersion: 4, pet: { totalCompletions: Number.NaN }, tasks }, T0).pet.totalCompletions,
    ).toBe(4);
    expect(
      migrate({ schemaVersion: 4, pet: { totalCompletions: 'many' }, tasks }, T0).pet.totalCompletions,
    ).toBe(4);
    // 合法值比任务次数之和大时保留大的那个（累计数只增不减）
    expect(
      migrate({ schemaVersion: 5, pet: { totalCompletions: 37 }, tasks }, T0).pet.totalCompletions,
    ).toBe(37);
  });

  it('坏字段逐条兜底：lastMistakes 越界 / birdFeeds 负数 / restWrapDismissed 非布尔', () => {
    const out = migrate(
      {
        schemaVersion: 4,
        pet: { shoots: 9, birdFeeds: -3 },
        tasks: {
          brush: { completions: 2, lastMistakes: -2 },
          feed: { completions: 1, lastMistakes: 1000 },
          sleep: { completions: 0, lastMistakes: Number.NaN },
          wash: { completions: 0, lastMistakes: 2 },
        },
        days: { [TODAY]: { restWrapDismissed: 'yes' } },
      },
      T0,
    );
    expect(out.pet.shoots).toBe(9);
    expect(out.pet.birdFeeds).toBe(0);
    expect(out.pet.totalCompletions).toBe(3); // totalCompletions 缺失 → 任务次数之和
    expect(out.tasks.brush.lastMistakes).toBe(0);
    expect(out.tasks.feed.lastMistakes).toBe(MAX_STORED_MISTAKES);
    expect(out.tasks.sleep.lastMistakes).toBe(0);
    expect(out.tasks.wash.lastMistakes).toBe(2);
    expect(out.days[TODAY]?.restWrapDismissed).toBe(false);
  });

  it('v5 存档已有的 restWrapDismissed=true 会被保留', () => {
    const out = migrate({ schemaVersion: 5, days: { [TODAY]: { restWrapDismissed: true } } }, T0);
    expect(out.days[TODAY]?.restWrapDismissed).toBe(true);
  });
});

describe('丰收日：每周六竹笋 ×2（确定性、非随机）', () => {
  it('只有周六是丰收日（坏日期永远不是）', () => {
    expect(isHarvestDay(SAT_DAY)).toBe(true);
    expect(harvestMultiplier(SAT_DAY)).toBe(2);
    expect(harvestMultiplier(TODAY)).toBe(1); // 周一
    expect(harvestMultiplier(addDays(TODAY, 1))).toBe(1); // 周二
    expect(isHarvestDay('2026-10-22')).toBe(false);
    expect(harvestMultiplier('bad')).toBe(1);
    expect(harvestMultiplier('2026-02-31')).toBe(1); // 非法日历日不误判成丰收日
  });

  it('周六第一次完成：竹笋 ×2，成长值不翻倍', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => SAT, SAT);
    await pm.init();
    const before = pm.snapshot().pet;
    const result = await pm.completeTask(task(), 3, SAT);
    expect(result.harvest).toBe(true);
    expect(result.shoots).toBe(4); // 2 根 × 2
    expect(result.xp).toBe(10); // 成长值不翻倍
    expect(pm.snapshot().pet.shoots).toBe(before.shoots + 4);
    expect(pm.snapshot().days[SAT_DAY]?.rewards.shoots).toBe(4);
    expect(store.current?.days[SAT_DAY]?.rewards.shoots).toBe(4);
  });

  it('周六重复玩：先减半再 ×2（2 → 1 → 2），不会低于 1', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => SAT, SAT);
    await pm.init();
    await pm.completeTask(task(), 3, SAT);
    const shootsAfterFirst = pm.snapshot().pet.shoots;
    const repeat = await pm.completeTask(task(), 2, SAT);
    expect(repeat.isFirstToday).toBe(false);
    expect(repeat.harvest).toBe(true);
    expect(repeat.shoots).toBe(2);
    expect(pm.snapshot().pet.shoots).toBe(shootsAfterFirst + 2);
    // 「最低 1 根」的规则仍然在：奖励 1 根的任务减半后是 1，丰收日 ×2 是 2
    expect(completionReward(task({ reward: { shoots: 1, xp: 5 } }), false, 2)).toEqual({
      shoots: 2,
      xp: 3,
      fragments: 0,
    });
  });

  it('工作日不翻倍：第一次 2、重复 1（与 v4 口径完全一致）', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const first = await pm.completeTask(task(), 3, T0);
    expect(first.harvest).toBe(false);
    expect(first.shoots).toBe(2);
    expect((await pm.completeTask(task(), 3, T0)).shoots).toBe(1);
    expect(completionReward(task(), true, 1)).toEqual({ shoots: 2, xp: 10, fragments: 0 });
  });
});

describe('喂小鸟：竹笋的轻量出口（不给数值增益）', () => {
  it('纯函数：竹笋够就扣 1 根、次数 +1', () => {
    expect(feedBird({ shoots: 3, birdFeeds: 0 })).toEqual({
      ok: true,
      shoots: 2,
      birdFeeds: 1,
      spent: 1,
    });
    expect(feedBird({ shoots: 1, birdFeeds: 4 })).toEqual({
      ok: true,
      shoots: 0,
      birdFeeds: 5,
      spent: 1,
    });
  });

  it('纯函数：竹笋不足返回 noShoots，不扣、不出负数', () => {
    expect(feedBird({ shoots: 0, birdFeeds: 4 })).toEqual({
      ok: false,
      reason: 'noShoots',
      shoots: 0,
      birdFeeds: 4,
      spent: 0,
    });
    expect(feedBird({ shoots: Number.NaN, birdFeeds: Number.NaN })).toEqual({
      ok: false,
      reason: 'noShoots',
      shoots: 0,
      birdFeeds: 0,
      spent: 0,
    });
    expect(feedBird({ shoots: -5, birdFeeds: -2 }).ok).toBe(false);
  });

  it('成本不合法时按 1 根算（不给免费喂的口子）', () => {
    expect(feedBird({ shoots: 2, birdFeeds: 0 }, 0).spent).toBe(1);
    expect(feedBird({ shoots: 2, birdFeeds: 0 }, -3).spent).toBe(1);
    expect(feedBird({ shoots: 2, birdFeeds: 0 }, Number.NaN).spent).toBe(1);
  });

  it('Manager：竹笋不足时返回 reason 且一个字都不写档', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 0;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const writes = store.writes;
    const outcome = await pm.feedBird(T0);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('noShoots');
    expect(outcome.shoots).toBe(0);
    expect(outcome.birdFeeds).toBe(0);
    expect(outcome.spent).toBe(0);
    expect(store.writes).toBe(writes); // 判定即落档：拒绝 = 不落档
    expect(pm.snapshot().pet.shoots).toBe(0);
    expect(pm.snapshot().pet.birdFeeds).toBe(0);
  });

  it('Manager：竹笋够时扣一根、birdFeeds +1 并立即落盘；不动成长/喂竹竹次数', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 5;
    initial.pet.feeds = 2;
    const xpBefore = initial.pet.xp;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const outcome = await pm.feedBird(T0);
    expect(outcome).toEqual({ ok: true, shoots: 4, birdFeeds: 1, spent: 1 });
    expect(pm.snapshot().pet.shoots).toBe(4);
    expect(pm.snapshot().pet.birdFeeds).toBe(1);
    expect(store.current?.pet.birdFeeds).toBe(1);
    expect(store.current?.pet.feeds).toBe(2); // 喂竹竹的次数不变
    expect(store.current?.pet.xp).toBe(xpBefore); // 不给经验，不污染任务经济
    expect(store.current?.tasks.brush.completions).toBe(0);
  });
});

describe('进步反馈 progressFor：只在更好时说话', () => {
  it('更好 / 持平 / 更差 三种情况', () => {
    expect(progressFor(1, 3)).toEqual({ better: 2 });
    expect(progressFor(0, 2)).toEqual({ better: 2 });
    expect(progressFor(3, 3)).toEqual({ better: 0 });
    expect(progressFor(4, 3)).toEqual({ better: 0 });
    expect(progressFor(0, 0)).toEqual({ better: 0 }); // 第一次做没有"上次"可比
  });

  it('坏输入兜底：NaN / 负数 / 小数不会算出诡异的「进步」', () => {
    expect(progressFor(Number.NaN, 3)).toEqual({ better: 0 }); // 坏输入宁可不夸
    expect(progressFor(-1, 3)).toEqual({ better: 0 });
    expect(progressFor(1.9, 3)).toEqual({ better: 2 }); // 小数向下取整
    expect(progressFor(2, Number.NaN)).toEqual({ better: 0 });
  });
});

describe('完成卡：上次失误 / 累计件数 / 累计里程碑', () => {
  it('写入 lastMistakes 与累计件数，并给出「比上次少错 X 次」', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const first = await pm.completeTask(task(), 2, { mistakes: 4 });
    expect(first.mistakes).toBe(4);
    expect(first.better).toBe(0);
    expect(first.totalCompletions).toBe(1);
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(4);
    expect(store.current?.tasks.brush.lastMistakes).toBe(4); // 判定即落档

    const second = await pm.completeTask(task(), 3, { mistakes: 1 });
    expect(second.better).toBe(3);
    expect(second.mistakes).toBe(1);
    expect(second.totalCompletions).toBe(2);
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(1);

    const worse = await pm.completeTask(task(), 1, { mistakes: 5 });
    expect(worse.better).toBe(0); // 更差不说话
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(5);
  });

  it('第三参数继续接受时间戳（老调用不用改），失误数越界被夹取', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const oldStyle = await pm.completeTask(task(), 3, T0);
    expect(oldStyle.mistakes).toBe(0);
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(0);
    // 已经存过真实值时，老调用不会把它覆盖成 0（不知道 ≠ 完美）
    await pm.completeTask(task(), 3, { mistakes: 3 });
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(3);
    await pm.completeTask(task(), 3, T0);
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(3);
    const nan = await pm.completeTask(task(), 3, { mistakes: Number.NaN });
    expect(nan.mistakes).toBe(0);
    const huge = await pm.completeTask(task(), 3, { mistakes: 1_000_000 });
    expect(huge.mistakes).toBe(MAX_STORED_MISTAKES);
    expect(pm.snapshot().tasks.brush.lastMistakes).toBe(MAX_STORED_MISTAKES);
    expect(pm.snapshot().pet.totalCompletions).toBe(5);
  });

  it('累计件数跨过里程碑时返回它（第 5 件），普通一次返回 null', async () => {
    const initial = emptySave(T0);
    initial.pet.totalCompletions = 4;
    const store = memoryStore(initial);
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    const outcome = await pm.completeTask(task(), 3, T0);
    expect(outcome.totalCompletions).toBe(5);
    expect(outcome.milestone?.at).toBe(5);
    expect(outcome.milestone?.title).toBe('五件小事');
    expect((await pm.completeTask(task(), 3, T0)).milestone).toBeNull();
  });
});

describe('累计里程碑：1 / 5 / 10 / 20 / 30 / 50', () => {
  it('六个里程碑、中英各一份、不带 emoji', () => {
    expect(MILESTONES.map((milestone) => milestone.at)).toEqual([1, 5, 10, 20, 30, 50]);
    for (const milestone of MILESTONES) {
      expect(milestone.title.length).toBeGreaterThan(0);
      expect(milestone.titleEn.length).toBeGreaterThan(0);
      expect(
        /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(milestone.title + milestone.titleEn),
      ).toBe(false);
    }
  });

  it('milestonesFor 只返回已经跨过的（新玩家为空、坏输入不炸）', () => {
    expect(milestonesFor(0)).toEqual([]);
    expect(milestonesFor(-5)).toEqual([]);
    expect(milestonesFor(Number.NaN)).toEqual([]);
    expect(milestonesFor(1).map((milestone) => milestone.at)).toEqual([1]);
    expect(milestonesFor(5).map((milestone) => milestone.at)).toEqual([1, 5]);
    expect(milestonesFor(49).map((milestone) => milestone.at)).toEqual([1, 5, 10, 20, 30]);
    expect(milestonesFor(50)).toHaveLength(6);
    expect(milestonesFor(9999)).toHaveLength(6);
  });

  it('nextMilestoneFor 给出下一个目标；到顶后返回 null（不设"必须连续"的门槛）', () => {
    expect(nextMilestoneFor(0)?.at).toBe(1);
    expect(nextMilestoneFor(4)?.at).toBe(5);
    expect(nextMilestoneFor(49)?.at).toBe(50);
    expect(nextMilestoneFor(50)).toBeNull();
  });
});

describe('30 分钟收尾卡片：当天收下一次，跨天自动重置', () => {
  it('dismissRestWrap 落档；重复调用幂等；dismissRest 不会顺手收起它', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    expect(pm.snapshot().days[TODAY]?.restWrapDismissed).toBe(false);
    await pm.dismissRest(T0);
    expect(pm.snapshot().days[TODAY]?.restWrapDismissed).toBe(false);
    const writes = store.writes;
    await pm.dismissRestWrap(T0);
    expect(pm.snapshot().days[TODAY]?.restWrapDismissed).toBe(true);
    expect(store.current?.days[TODAY]?.restWrapDismissed).toBe(true);
    expect(store.writes).toBe(writes + 1);
    await pm.dismissRestWrap(T0);
    expect(store.writes).toBe(writes + 1); // 幂等：已经收下就不重复写
  });

  it('跨天是新的一天：收尾卡片标记自动归零', async () => {
    const store = memoryStore();
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await pm.dismissRestWrap(T0);
    const tomorrow = addDays(TODAY, 1);
    await pm.refresh(T0 + DAY);
    expect(pm.snapshot().days[TODAY]?.restWrapDismissed).toBe(true); // 昨天的记录还在
    expect(pm.snapshot().days[tomorrow]?.restWrapDismissed).toBe(false);
  });
});

/* ================================================================== *
 * 故障路径：坏日期键 / 写盘失败 / 并发写盘（审查遗留的最后一块空白）
 * ================================================================== */

describe('坏日期键：非法日历日不能禁用衰减、不能污染日记录', () => {
  it('lastDecayDay 是 2026-02-31 时换成读档当天，之后跨天衰减照常发生（不会被永久禁用）', async () => {
    const raw = emptySave(T0);
    raw.pet.lastDecayDay = '2026-02-31';
    raw.pet.stats = { fullness: 90, energy: 90, clean: 90, mood: 90, health: 90 };
    const store = memoryStore(raw);
    const tomorrow = T0 + DAY;
    const pm = new manager.ProgressManager(store, () => tomorrow, tomorrow);
    await pm.init();
    // 坏键不能留在存档里：读档当天按"今天"算起，不会凭空掉一截状态
    expect(pm.snapshot().pet.lastDecayDay).toBe(addDays(TODAY, 1));
    expect(pm.snapshot().pet.stats.fullness).toBe(90);
    // 再过一天：衰减必须恢复。旧实现把 '2026-02-31' 原样留下，
    // daysBetween(坏键, 今天) 恒为 0 → 状态衰减从此永久失效
    await pm.refresh(tomorrow + DAY);
    expect(pm.snapshot().pet.stats.fullness).toBe(80);
    expect(pm.snapshot().pet.lastDecayDay).toBe(addDays(TODAY, 2));
  });

  it('careDays / lastCompletedDay / lastPlayedDay 的坏日历日被丢弃（动作不会被永久锁住）', () => {
    const raw = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      pet: { careDays: { pat: '2026-02-31' } },
      tasks: { brush: { lastCompletedDay: '2026-02-31' } },
      arcade: { popstar: { lastPlayedDay: '2026-02-31' } },
    };
    const out = migrate(raw, T0);
    expect(out.pet.careDays.pat).toBeUndefined();
    expect(out.tasks.brush.lastCompletedDay).toBeNull();
    expect(out.arcade.popstar.lastPlayedDay).toBeNull();
  });

  it('days 里的非法日历日整条丢弃，合法日期保留', () => {
    const out = migrate(
      {
        schemaVersion: SAVE_SCHEMA_VERSION,
        days: { [TODAY]: { seconds: 60 }, '2026-02-31': { seconds: 999 } },
      },
      T0,
    );
    expect(out.days[TODAY]?.seconds).toBe(60);
    expect(out.days['2026-02-31']).toBeUndefined();
  });

  it('isDayKey 只认真实存在的日历日', () => {
    expect(isDayKey(TODAY)).toBe(true);
    expect(isDayKey('2026-02-28')).toBe(true);
    expect(isDayKey('2024-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-02-31')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('2026-00-10')).toBe(false);
    expect(isDayKey('2026-10-19 ')).toBe(false);
    expect(isDayKey(20_261_019)).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });

  it('dayKey / addDays 对非有限时间戳不会造出 NaN-NaN-NaN', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(dayKey(bad)).not.toContain('NaN');
      expect(isDayKey(dayKey(bad))).toBe(true);
      expect(addDays(TODAY, bad)).toBe(TODAY);
    }
  });

  it('未来日期键也要限额：坏档塞进 100 个未来日期时只留 30 天，今天仍在', () => {
    const days: Record<string, DayRecord> = { [TODAY]: emptyDay(TODAY) };
    for (let i = 1; i <= 100; i += 1) days[addDays(TODAY, i)] = emptyDay(addDays(TODAY, i));
    const pruned = pruneDays(days, 30, TODAY);
    expect(pruned[TODAY]).toBeDefined();
    expect(Object.keys(pruned)).toHaveLength(31);
  });
});

describe('写盘失败：内存已更新、磁盘最终补齐', () => {
  it('save reject 时本次调用抛错，但这一局的反馈仍在内存；下一次成功写盘把改动一起落盘', async () => {
    let fail = true;
    const writes: SaveData[] = [];
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        return emptySave(T0);
      },
      async save(data: SaveData): Promise<void> {
        if (fail) throw new Error('quota exceeded');
        writes.push(data);
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await expect(pm.care('pat', T0)).rejects.toThrow('quota exceeded');
    // 写盘失败不能把孩子的动作回滚：界面照常给反馈，只是"可能没存上"
    expect(pm.snapshot().pet.careDays.pat).toBe(TODAY);
    expect(writes).toHaveLength(0);

    fail = false;
    await pm.care('hug', T0);
    // 下一次成功写盘会把上一次没写进去的「摸头」一起带上
    expect(writes.at(-1)?.pet.careDays.pat).toBe(TODAY);
    expect(writes.at(-1)?.pet.careDays.hug).toBe(TODAY);
  });

  it('一次写盘失败不会卡住后续写盘（队列吞错但不丢顺序）', async () => {
    let calls = 0;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        return emptySave(T0);
      },
      async save(): Promise<void> {
        calls += 1;
        throw new Error('write failed #' + calls);
      },
    };
    const pm = new manager.ProgressManager(store, () => T0, T0);
    await pm.init();
    await expect(pm.care('pat', T0)).rejects.toThrow('write failed #1');
    await expect(pm.care('hug', T0)).rejects.toThrow('write failed #2');
    expect(calls).toBe(2);
  });
});

describe('并发写盘：队列保证磁盘最终是最新快照', () => {
  /** 每个 save 都挂住，由测试手动按顺序放行；记录并发度 */
  function deferredStore(initial: SaveData) {
    const started: SaveData[] = [];
    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const store: ProgressStore = {
      async load(): Promise<SaveData> {
        return initial;
      },
      save(data: SaveData): Promise<void> {
        started.push(data);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<void>((resolve) => {
          resolvers.push(() => {
            inFlight -= 1;
            resolve();
          });
        });
      },
    };
    return { store, started, resolvers, maxInFlight: () => maxInFlight };
  }

  async function flushMicrotasks(times = 10): Promise<void> {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
  }

  it('两次写盘串行：第一次没落地前第二次不发起，磁盘最后是最新快照', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 50;
    const deferred = deferredStore(initial);
    const pm = new manager.ProgressManager(deferred.store, () => T0, T0);
    await pm.init();

    const first = pm.care('pat', T0);
    await flushMicrotasks();
    expect(deferred.started).toHaveLength(1);

    const second = pm.care('hug', T0);
    await flushMicrotasks();
    // 串行：第一次还没落地，第二次不许开始（否则完成顺序可能反过来）
    expect(deferred.started).toHaveLength(1);
    expect(deferred.maxInFlight()).toBe(1);

    deferred.resolvers[0]!();
    await flushMicrotasks();
    expect(deferred.started).toHaveLength(2);
    deferred.resolvers[1]!();
    await Promise.all([first, second]);

    expect(deferred.maxInFlight()).toBe(1);
    expect(deferred.started.at(-1)?.pet.careDays.pat).toBe(TODAY);
    expect(deferred.started.at(-1)?.pet.careDays.hug).toBe(TODAY);
    expect(deferred.started.at(-1)?.pet.shoots).toBe(50);
  });

  it('清档与在途写盘并发：空档最后落盘，旧进度不会被写回来', async () => {
    const initial = emptySave(T0);
    initial.pet.shoots = 50;
    initial.pet.careDays = {};
    const deferred = deferredStore(initial);
    const pm = new manager.ProgressManager(deferred.store, () => T0, T0);
    await pm.init();

    const carePromise = pm.care('pat', T0);
    await flushMicrotasks();
    expect(deferred.started).toHaveLength(1);

    const clearPromise = pm.clear(T0);
    await flushMicrotasks();
    // 清档排在在途写盘之后：不会有第二个并发写
    expect(deferred.started).toHaveLength(1);

    deferred.resolvers[0]!();
    await flushMicrotasks();
    expect(deferred.started).toHaveLength(2);
    deferred.resolvers[1]!();
    await Promise.all([carePromise, clearPromise]);

    // 磁盘最终是空档：旧进度（50 根竹笋、摸头记录）不会被写回来
    expect(deferred.started.at(-1)?.pet.shoots).toBe(3);
    expect(deferred.started.at(-1)?.pet.careDays.pat).toBeUndefined();
    expect(pm.snapshot().pet.shoots).toBe(3);
  });
});

describe('纯函数坏输入兜底：NaN 不能变成惩罚或污染存档', () => {
  it('decayStats：坏天数（NaN / Infinity / 负数）等于没跨天，不会把所有状态打到下限', () => {
    const stats = { fullness: 90, energy: 90, clean: 90, mood: 90, health: 90 };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3]) {
      expect(decayStats(stats, bad), String(bad)).toEqual(stats);
    }
    // 正常路径不变：1 天按表掉一次
    expect(decayStats(stats, 1)).toEqual({
      fullness: 80,
      energy: 81,
      clean: 80,
      mood: 83,
      health: 86,
    });
  });

  it('starsFor：坏失误数也至少 1 颗星（永远没有 0 颗）', () => {
    expect(starsFor(Number.NaN)).toBe(1);
    // 负数按"几乎没有失误"处理：计数型输入出现负数只可能是坏数据，不能因此扣星星
    expect(starsFor(-5)).toBe(3);
    expect(starsFor(0)).toBe(3);
    expect(starsFor(3)).toBe(2);
    expect(starsFor(99)).toBe(1);
  });

  it('completionReward：奖励字段坏掉时退回最低 1 根 / 0 成长，不写 NaN', () => {
    const broken = task({ reward: { shoots: Number.NaN, xp: Number.NaN } as TaskSummary['reward'] });
    const first = completionReward(broken, true);
    expect(first.shoots).toBe(1);
    expect(Number.isFinite(first.xp)).toBe(true);
    expect(first.xp).toBe(0);
    const repeat = completionReward(broken, false);
    expect(repeat.shoots).toBe(1);
    expect(repeat.xp).toBe(3);
    // 正常内容口径不变
    expect(completionReward(task(), true, 1)).toEqual({ shoots: 2, xp: 10, fragments: 0 });
  });

  it('statsDeltaFor：坏状态收益不参与（不会把这一项打到下限 10）', () => {
    const broken = task({ stats: { clean: Number.NaN, mood: 4 } as TaskSummary['stats'] });
    expect(statsDeltaFor(broken, true)).toEqual({ mood: 4 });
    expect(statsDeltaFor(task(), true)).toEqual({ clean: 14, mood: 4 });
    expect(statsDeltaFor(task(), false)).toEqual({ clean: 7, mood: 2 });
  });

  it('nextStreak：坏连续数不会产出 NaN', () => {
    expect(nextStreak(yesterdayOf(TODAY), TODAY, Number.NaN)).toBe(1);
    expect(nextStreak(TODAY, TODAY, Number.NaN)).toBe(1);
    expect(nextStreak(yesterdayOf(TODAY), TODAY, 3)).toBe(4);
    expect(nextStreak(TODAY, TODAY, 3)).toBe(3);
  });

  it('recommendedTasks：坏 count 兜底成安全件数，不会把全部任务都塞进去', () => {
    // NaN / Infinity 回落默认件数（4）；负数夹到最小 1 件
    expect(recommendedTasks(TODAY, 'morning', TASKS, Number.NaN)).toHaveLength(
      Math.min(4, TASKS.length),
    );
    expect(recommendedTasks(TODAY, 'morning', TASKS, Number.POSITIVE_INFINITY)).toHaveLength(
      Math.min(4, TASKS.length),
    );
    expect(recommendedTasks(TODAY, 'morning', TASKS, -5)).toHaveLength(1);
  });

  it('pruneDays：坏 keep 兜底成 30 天上限，坏数据不会绕过裁剪', () => {
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < 40; i += 1) days[addDays(TODAY, -i)] = emptyDay(addDays(TODAY, -i));
    const pruned = pruneDays(days, Number.NaN, TODAY);
    expect(Object.keys(pruned)).toHaveLength(30);
    expect(pruned[TODAY]).toBeDefined();
  });
});
