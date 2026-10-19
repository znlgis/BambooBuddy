import { describe, expect, it } from 'vitest';
import type { ProgressStore, SaveData } from '@bamboo/game-kit';
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
  emptySave,
  ensureDay,
  fragmentsFor,
  levelForXp,
  migrate,
  nextStreak,
  recommendedTasks,
  starsFor,
  statHints,
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

function memoryStore(initial: SaveData | null = null): ProgressStore & { current: SaveData | null; writes: number } {
  const store = {
    current: initial,
    writes: 0,
    async load(): Promise<SaveData> {
      if (!store.current) throw new Error('empty');
      return store.current;
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

  it('等级稳步增长', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(40)).toBe(3);
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
    expect(intimacy.unlockedGestures(12)).toContain('转圈圈');
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
    expect(migrate('nope', T0).schemaVersion).toBe(1);
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