import type {
  ArcadeGameId,
  CareAction,
  DayRecord,
  PetState,
  ProgressStore,
  SaveData,
  Stars,
  TaskId,
  TaskProgress,
} from '@bamboo/game-kit';
import type { TaskSummary } from '@bamboo/content';
import { CARE_ACTIONS, arcadeLevelFor } from '@bamboo/game-kit';
import { CLOTHING_SLOTS, findItem, milestonesFor, ownsItem } from './catalog';
import type { CatalogItem, Milestone } from './catalog';
import {
  ARCADE_DAILY_PLAYS,
  arcadeStatus as readArcadeStatus,
  arcadeUnlimited as isArcadeUnlimited,
  arcadeUnlocked as isArcadeUnlocked,
  isArcadeGameId,
  withArcadePlay,
} from './arcade';
import type { ArcadeStatus } from './arcade';
import { dayKey, daysBetween } from './day';
import { stageForXp } from './growth';
import { CARE_MOOD, CARE_POINTS } from './intimacy';
import {
  completionReward,
  earnsSticker,
  feedBird as feedBirdPure,
  fragmentsFor,
  harvestMultiplier,
  nextStreak,
  progressFor,
  statsDeltaFor,
} from './rewards';
import type { BirdFeedResult } from './rewards';
import {
  MAX_STORED_MISTAKES,
  emptyDay,
  emptySave,
  emptyTaskProgress,
  ensureDay,
  isFutureVersionSave,
  migrate,
} from './save';
import { applyStatDelta, decayStats } from './stats';

/** 星星的运行时夹取：类型是 Stars，但事件桥传进来的值不可信（0..3） */
function intStars(value: Stars): Stars {
  const safe = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(3, Math.max(0, safe)) as Stars;
}

/** 失误数的运行时夹取：同样来自事件桥（不可信），夹到 0..MAX_STORED_MISTAKES 的整数 */
function intMistakes(value: number | undefined): number {
  const safe = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(MAX_STORED_MISTAKES, Math.max(0, safe));
}

export interface CompletionOutcome {
  /** 结算是否真的生效：false 只发生在"任务还没解锁"（reason = 'locked'） */
  ok: boolean;
  reason?: 'locked';
  task: TaskProgress;
  isFirstToday: boolean;
  stars: Stars;
  shoots: number;
  xp: number;
  fragments: number;
  sticker: boolean;
  /** 这一局刚好跨过「今天四件小事」的门槛：外壳据此弹出「发现一扇小门」 */
  arcadeUnlocked: boolean;
  /** 这一次的失误数（玩法报上来的，已夹取） */
  mistakes: number;
  /** 比上一次少错了几次；没有更好就是 0（完成卡只在 > 0 时夸一句） */
  better: number;
  /** 这一次是不是丰收日：竹笋奖励已经 ×2（成长值不翻倍） */
  harvest: boolean;
  /** 累计完成件数（含这一次）：里程碑与家长页的累计口径 */
  totalCompletions: number;
  /** 这一次刚好跨过的累计里程碑；没有就 null */
  milestone: Milestone | null;
}

/**
 * completeTask 的第三个参数：既接受"现在"的时间戳（老调用一行都不用改），
 * 也接受带失误数的对象。失误数来自 GameEventMap['task:complete'].mistakes。
 */
export interface CompletionWhen {
  /** 显式传入的当前时间（等价于第三参数直接传 number） */
  now?: number;
  /** 这一次的失误数（默认 0；越界会被夹取） */
  mistakes?: number;
}

export type ArcadePlayReason = 'unknown' | 'notUnlocked' | 'limit';
export interface ArcadePlayOutcome {
  ok: boolean;
  reason?: ArcadePlayReason;
  gameId: ArcadeGameId;
  /** 玩完之后（或现有的）最高成绩 */
  best: number;
  /** 玩完之后（或现有的）总局数 */
  plays: number;
  /** 玩完之后（或现有的）难度等级（由总局数派生，跨天保留） */
  level: number;
  /** 玩完之后（或现有的）今天已经玩了几局 */
  playsToday: number;
}

export interface ArcadeSecretOutcome {
  ok: boolean;
  /** 今天早就触发过了（重复触发不算错，只是不重复弹浮层） */
  already: boolean;
}

export interface CareOutcome {
  ok: boolean;
  reason?: 'already';
  action: CareAction;
  intimacy: number;
  /** 今天做完这个动作之后，三个动作是不是都做过了 */
  allDone: boolean;
}

export interface FeedOutcome {
  ok: boolean;
  reason?: 'noShoots';
  feeds: number;
}

/** 喂小鸟的结果：判定在 rewards.feedBird（纯函数），这里只多一层"判定即落档" */
export type BirdFeedOutcome = BirdFeedResult;

export type UnlockReason = 'missing' | 'owned' | 'level' | 'noShoots' | 'noFragments';
export interface UnlockOutcome {
  ok: boolean;
  reason?: UnlockReason;
  item?: CatalogItem;
}

export interface EquipOutcome {
  ok: boolean;
  reason?: 'missing' | 'locked';
  item?: CatalogItem;
}

/**
 * 存档读写与所有"会改变存档"的操作都收在这里：
 * 界面层只调方法、拿结果，不自己拼 SaveData（同 CHAGS 的 ProgressManager 分层）。
 *
 * 四条实现纪律：
 * - 纯逻辑（奖励、衰减、连续天数）在别的文件里，这里只做编排；
 * - 每次改动都先更新内存再落盘：写盘失败时孩子这一局仍然有反馈，界面另行提示；
 * - 读档只做一次（single-flight），避免深链直达游戏时旧快照覆盖新进度；
 * - 所有写操作先 await ready()：界面在 IndexedDB 读档完成前就能点，不等待就会拿
 *   emptySave 当底算出新档并落盘，把真正的旧档覆盖掉（读档失败则向上抛错，绝不静默覆盖）。
 */
export class ProgressManager {
  private readonly store: ProgressStore;
  private readonly clock: () => number;
  private data: SaveData;
  private loading: Promise<SaveData> | null = null;
  /** 第一次读档是否已经落定（成功或失败都算落定，clear() 也算） */
  private loaded = false;
  /** 读档落定之前是否发生过写入：有写入时绝不拿读出来的旧快照覆盖内存 */
  private writtenBeforeLoad = false;
  /**
   * 落盘队列：两次操作几乎同时点下时（如"清档"紧接着"摸头"），
   * 不能让两次 IndexedDB 写入乱序完成 —— 否则先发的那次后落地，磁盘回退到旧快照。
   * 队列只负责顺序，错误照样抛给各自的调用方。
   */
  private saveChain: Promise<void> = Promise.resolve();

  constructor(store: ProgressStore, clock: () => number, now = clock()) {
    this.store = store;
    this.clock = clock;
    this.data = emptySave(now);
  }

  init(): Promise<SaveData> {
    this.loading ??= this.load().catch((cause: unknown) => {
      // 读档失败不缓存成"本次会话永久只读"：IndexedDB 打不开多数是瞬时的
      // （3 秒超时、别的标签页占着升级、隐私模式里被拒），下一次 init / 写操作
      // 应该还能再试一次。当次调用照样把错误抛给调用方，绝不静默用空档顶上。
      this.loading = null;
      throw cause;
    });
    return this.loading;
  }

  /**
   * 所有写操作的入口都先 `await this.ready()`：界面在 IndexedDB 读档完成之前就能点，
   * 不等待的话写入会以 emptySave 为底算出新档并落盘，把真正的旧档覆盖掉。
   *
   * 还没有人调用过 init() 时这里顺手触发一次（single-flight），所以"调用方忘了 await init"
   * 也不会丢档；读档失败（含未来版本存档）时错误会继续抛出去，外壳据此提示而不是静默覆盖。
   */
  private async ready(): Promise<void> {
    if (this.loading === null) this.init();
    const loading = this.loading;
    if (loading !== null) await loading;
  }

  private async load(): Promise<SaveData> {
    const now = this.clock();
    // 读档失败必须往上抛：把失败当"没有存档"会让第一次写入用空档覆盖真实进度
    const raw: unknown = await this.store.load();
    if (isFutureVersionSave(raw)) {
      // 未来版本的存档：原档留在 IndexedDB 里不动，本次会话拒绝写入（清档除外）
      throw new Error('存档来自更新版本的 BambooBuddy，已停止写入以免覆盖原进度。');
    }
    let next = migrate(raw, now);
    const today = dayKey(now);
    const gap = daysBetween(next.pet.lastDecayDay, today);
    const missingDay = next.days[today] === undefined;
    if (gap > 0) {
      next = {
        ...next,
        pet: { ...next.pet, stats: decayStats(next.pet.stats, gap), lastDecayDay: today },
      };
    }
    next = ensureDay(next, now);
    // 读档期间已经有写入（家长清档 / 没 await init 就调用的写方法）：以内存为准，别用旧快照盖掉
    if (this.writtenBeforeLoad) {
      this.loaded = true;
      return this.data;
    }
    this.data = next;
    this.loaded = true;
    // 只有状态真的变过才写盘：打开一次就写一次只会白耗 IndexedDB 寿命
    if (gap > 0 || missingDay) {
      try {
        // 也走落盘队列：读档补写与"清档"同时发生时，两笔写入不能乱序
        await this.enqueueSave(next);
      } catch {
        // 读档已经成功，写失败留给后续操作的 unsaved 提示
      }
    }
    return next;
  }

  snapshot(): SaveData {
    return this.data;
  }

  taskProgress(taskId: TaskId): TaskProgress {
    return this.data.tasks[taskId] ?? emptyTaskProgress(taskId);
  }

  /** 回到小屋 / 切回前台时调用：跨天就掉一点状态，并补上今天的日记录 */
  async refresh(now = this.clock()): Promise<{ decayedDays: number }> {
    await this.ready();
    const today = dayKey(now);
    const gap = daysBetween(this.data.pet.lastDecayDay, today);
    const missingDay = this.data.days[today] === undefined;
    if (gap <= 0 && !missingDay) return { decayedDays: 0 };
    let next = ensureDay(this.data, now);
    if (gap > 0) {
      next = {
        ...next,
        pet: { ...next.pet, stats: decayStats(next.pet.stats, gap), lastDecayDay: today },
      };
    }
    await this.commit(next);
    return { decayedDays: Math.max(0, gap) };
  }

  /**
   * 完成一次任务：奖励、状态收益、连续天数、贴纸、上次失误、累计件数全部在这里结算。
   *
   * 第三参数既接受时间戳（老调用：completeTask(task, stars, now)），也接受
   * `{ now?, mistakes? }`（玩法把 task:complete 里的 mistakes 一起报上来）。
   */
  async completeTask(
    task: TaskSummary,
    stars: Stars,
    when: number | CompletionWhen = this.clock(),
  ): Promise<CompletionOutcome> {
    await this.ready();
    const now = typeof when === 'number' ? when : (when.now ?? this.clock());
    // 老调用（第三参数是时间戳）没有失误数：这一次既不做"比上次少错"的比较、也不覆盖
    // 存档里的 lastMistakes —— 还没接 mistakes 之前，完成卡不能凭空夸一句"进步啦"。
    const suppliedMistakes = typeof when === 'number' ? undefined : when.mistakes;
    const mistakes = intMistakes(suppliedMistakes);
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    // 阶段没到就不结算：UI 的锁只在外壳，manager 是唯一写档口，必须自己守门
    if (stageForXp(data.pet.xp).id < task.unlockLevel) {
      const locked = data.tasks[task.id] ?? emptyTaskProgress(task.id);
      return {
        ok: false,
        reason: 'locked',
        task: locked,
        isFirstToday: false,
        stars: locked.stars,
        shoots: 0,
        xp: 0,
        fragments: 0,
        sticker: false,
        arcadeUnlocked: false,
        mistakes: 0,
        better: 0,
        harvest: false,
        totalCompletions: data.pet.totalCompletions,
        milestone: null,
      };
    }
    const safeStars = intStars(stars);
    const arcadeWasUnlocked = isArcadeUnlocked(day);
    const firstToday = !day.completed.includes(task.id);
    const distinctToday = day.completed.length + (firstToday ? 1 : 0);
    // 丰收日（每周六）竹笋 ×2：奖励数值仍然只由 rewards.completionReward 算，这里不写死任何数字
    const multiplier = harvestMultiplier(today);
    const reward = completionReward(task, firstToday, multiplier);
    const fragments = fragmentsFor(distinctToday, firstToday);
    const previous = data.tasks[task.id] ?? emptyTaskProgress(task.id);
    const streak = nextStreak(previous.lastCompletedDay, today, previous.streak);
    const sticker = earnsSticker(streak, data.pet.stickers.includes(task.id));
    const better =
      suppliedMistakes === undefined ? 0 : progressFor(suppliedMistakes, previous.lastMistakes).better;
    const totalCompletions = data.pet.totalCompletions + 1;
    // 这一次刚好跨过的累计里程碑（+1 最多跨过一个；老档回填过 total 时同样按"跨过"算）
    const milestone =
      milestonesFor(totalCompletions).find((item) => item.at > data.pet.totalCompletions) ?? null;

    const progress: TaskProgress = {
      taskId: task.id,
      stars: Math.max(previous.stars, safeStars) as Stars,
      completions: previous.completions + 1,
      lastPlayedAt: now,
      lastCompletedDay: today,
      streak,
      bestStreak: Math.max(previous.bestStreak, streak),
      // 没报失误数就不写：宁可留着上一次的真实值，也不写一个假的 0
      lastMistakes: suppliedMistakes === undefined ? previous.lastMistakes : mistakes,
    };

    const pet: PetState = {
      ...data.pet,
      xp: data.pet.xp + reward.xp,
      shoots: data.pet.shoots + reward.shoots,
      fragments: data.pet.fragments + fragments,
      stats: applyStatDelta(data.pet.stats, statsDeltaFor(task, firstToday)),
      stickers: sticker ? [...data.pet.stickers, task.id] : data.pet.stickers,
      totalCompletions,
    };

    const nextDay: DayRecord = {
      ...day,
      completed: firstToday ? [...day.completed, task.id] : day.completed,
      rewards: {
        shoots: day.rewards.shoots + reward.shoots,
        xp: day.rewards.xp + reward.xp,
        fragments: day.rewards.fragments + fragments,
      },
      stickers: sticker ? [...day.stickers, task.id] : day.stickers,
      arcade: day.arcade,
    };

    const next: SaveData = {
      ...data,
      updatedAt: now,
      pet,
      tasks: { ...data.tasks, [task.id]: progress },
      days: { ...data.days, [today]: nextDay },
    };
    await this.commit(next);

    return {
      ok: true,
      task: progress,
      isFirstToday: firstToday,
      stars: safeStars,
      shoots: reward.shoots,
      xp: reward.xp,
      fragments,
      sticker,
      arcadeUnlocked: !arcadeWasUnlocked && isArcadeUnlocked(nextDay),
      mistakes,
      better,
      harvest: multiplier === 2,
      totalCompletions,
      milestone,
    };
  }

  /** 今天的小门状态（未解锁 / 已玩几局 / 是否无限畅玩），界面与 e2e 都从这里读 */
  arcadeStatus(now = this.clock()): ArcadeStatus {
    return readArcadeStatus(this.data, now);
  }

  /**
   * 触发隐藏彩蛋「竹林小路」：当天小门直接打开，三款游戏无限畅玩。
   * 只写日记录里的一个布尔值（跨天自动失效），不发奖励、不影响任务统计。
   */
  async unlockArcadeSecret(now = this.clock()): Promise<ArcadeSecretOutcome> {
    await this.ready();
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    if (day.arcadeSecret) return { ok: true, already: true };
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, arcadeSecret: true } },
    };
    await this.commit(next);
    return { ok: true, already: false };
  }

  /**
   * 记录一局隐藏小游戏：解锁之后，普通模式每天最多 ARCADE_DAILY_PLAYS 局（三款合计），
   * 无限畅玩不设局数上限。调用时机是一局真正结束（arcade:complete），中途退出不消耗当天的机会。
   */
  async playArcade(
    gameId: ArcadeGameId,
    score: number,
    now = this.clock(),
  ): Promise<ArcadePlayOutcome> {
    if (!isArcadeGameId(gameId)) {
      return { ok: false, reason: 'unknown', gameId, best: 0, plays: 0, level: 1, playsToday: 0 };
    }
    await this.ready();
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    // 日记录理论上一定存在（ensureDay 保证），用兜底而不是非空断言：坏档也不能抛异常
    const day = data.days[today] ?? emptyDay(today);
    const previous = data.arcade[gameId] ?? { best: 0, plays: 0, lastPlayedDay: null };
    const current = {
      gameId,
      best: previous.best,
      plays: previous.plays,
      level: arcadeLevelFor(previous.plays),
      playsToday: day.arcadePlays,
    };
    if (!isArcadeUnlocked(day)) {
      return { ok: false, reason: 'notUnlocked', ...current };
    }
    // 无限畅玩：不设局数上限；普通模式：三款合计最多 ARCADE_DAILY_PLAYS 局
    if (!isArcadeUnlimited(day) && day.arcadePlays >= ARCADE_DAILY_PLAYS) {
      return { ok: false, reason: 'limit', ...current };
    }
    // 分数来自游戏事件（不可信输入）：先夹到非负有限整数，否则 NaN 会污染 best 并让重启后归零
    const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    const next = withArcadePlay(data, gameId, safeScore, now);
    await this.commit(next);
    const record = next.arcade[gameId];
    return {
      ok: true,
      gameId,
      best: record.best,
      plays: record.plays,
      level: arcadeLevelFor(record.plays),
      playsToday: (next.days[today] ?? emptyDay(today)).arcadePlays,
    };
  }

  /** 摸头 / 抱抱 / 击掌：每天各一次，不消耗任何资源 */
  async care(action: CareAction, now = this.clock()): Promise<CareOutcome> {
    await this.ready();
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    if (data.pet.careDays[action] === today) {
      return {
        ok: false,
        reason: 'already',
        action,
        intimacy: data.pet.intimacy,
        allDone: day.care.length >= CARE_ACTIONS.length,
      };
    }
    const pet: PetState = {
      ...data.pet,
      intimacy: data.pet.intimacy + CARE_POINTS[action],
      stats: applyStatDelta(data.pet.stats, { mood: CARE_MOOD[action] }),
      careDays: { ...data.pet.careDays, [action]: today },
    };
    const nextDay: DayRecord = {
      ...day,
      care: day.care.includes(action) ? day.care : [...day.care, action],
    };
    const next: SaveData = {
      ...data,
      updatedAt: now,
      pet,
      days: { ...data.days, [today]: nextDay },
    };
    await this.commit(next);
    return {
      ok: true,
      action,
      intimacy: pet.intimacy,
      allDone: nextDay.care.length >= CARE_ACTIONS.length,
    };
  }

  /** 喂竹笋：消耗 1 根，提升饱腹、心情与亲密度（奖励有了用处，又不构成"氪"） */
  async feed(now = this.clock()): Promise<FeedOutcome> {
    await this.ready();
    if (this.data.pet.shoots < 1) {
      return { ok: false, reason: 'noShoots', feeds: this.data.pet.feeds };
    }
    const pet: PetState = {
      ...this.data.pet,
      shoots: this.data.pet.shoots - 1,
      feeds: this.data.pet.feeds + 1,
      intimacy: this.data.pet.intimacy + 1,
      stats: applyStatDelta(this.data.pet.stats, { fullness: 12, mood: 3 }),
    };
    const next: SaveData = { ...this.data, updatedAt: now, pet };
    await this.commit(next);
    return { ok: true, feeds: pet.feeds };
  }

  /**
   * 请小鸟吃一根竹笋（P1-5 竹笋消耗出口）：只扣竹笋、记次数，不给经验/状态增益，
   * 也不碰任务统计与连续天数 —— 竹笋有地方花，但经济不会因此崩。
   *
   * 判定在 rewards.feedBird（纯函数，竹笋不够就不扣），这里只负责
   * `await this.ready()` 与「判定即落档」：拒绝时不写盘。
   */
  async feedBird(now = this.clock()): Promise<BirdFeedOutcome> {
    await this.ready();
    const result = feedBirdPure(this.data.pet);
    if (!result.ok) {
      return {
        ok: false,
        reason: 'noShoots',
        shoots: this.data.pet.shoots,
        birdFeeds: this.data.pet.birdFeeds,
        spent: 0,
      };
    }
    const pet: PetState = {
      ...this.data.pet,
      shoots: result.shoots,
      birdFeeds: result.birdFeeds,
    };
    await this.commit({ ...this.data, updatedAt: now, pet });
    return result;
  }

  /** 解锁：先看阶段，再看竹笋/碎片；解锁后自动穿上（少一步操作，孩子更顺） */
  async unlock(itemId: string, now = this.clock()): Promise<UnlockOutcome> {
    await this.ready();
    const item = findItem(itemId);
    if (!item) return { ok: false, reason: 'missing' };
    if (ownsItem(this.data.pet, item)) return { ok: false, reason: 'owned', item };
    if (stageForXp(this.data.pet.xp).id < item.unlockLevel) return { ok: false, reason: 'level', item };
    if (this.data.pet.shoots < item.costShoots) return { ok: false, reason: 'noShoots', item };
    if (this.data.pet.fragments < item.costFragments) return { ok: false, reason: 'noFragments', item };

    const pet: PetState = {
      ...this.data.pet,
      shoots: this.data.pet.shoots - item.costShoots,
      fragments: this.data.pet.fragments - item.costFragments,
      unlocked: [...this.data.pet.unlocked, item.id],
    };
    const equipped = this.withItemEquipped(pet, item);
    const next: SaveData = { ...this.data, updatedAt: now, pet: { ...pet, ...equipped } };
    await this.commit(next);
    return { ok: true, item };
  }

  /** 穿脱装扮 / 换小窝物件（同一件再点一次 = 脱下来） */
  async equip(itemId: string, now = this.clock()): Promise<EquipOutcome> {
    await this.ready();
    const item = findItem(itemId);
    if (!item) return { ok: false, reason: 'missing' };
    if (!ownsItem(this.data.pet, item)) return { ok: false, reason: 'locked', item };
    const isClothing = CLOTHING_SLOTS.includes(item.slot as (typeof CLOTHING_SLOTS)[number]);
    let pet: PetState;
    if (isClothing) {
      const slot = item.slot as keyof PetState['equipped'];
      const equipped = { ...this.data.pet.equipped };
      if (equipped[slot] === item.id) delete equipped[slot];
      else equipped[slot] = item.id;
      pet = { ...this.data.pet, equipped };
    } else {
      const slot = item.slot as keyof PetState['room'];
      pet = { ...this.data.pet, room: { ...this.data.pet.room, [slot]: item.id } };
    }
    await this.commit({ ...this.data, updatedAt: now, pet });
    return { ok: true, item };
  }

  /** 玩耍时长（家长页与 20 分钟休息提醒的数据来源） */
  async addPlaySeconds(seconds: number, now = this.clock()): Promise<void> {
    await this.ready();
    if (!Number.isFinite(seconds)) return;
    const add = Math.max(0, Math.floor(seconds));
    if (add === 0) return;
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, seconds: day.seconds + add } },
    };
    await this.commit(next);
  }

  /** 20 分钟休息提醒今天已经收起（一天只提醒一次） */
  async dismissRest(now = this.clock()): Promise<void> {
    await this.ready();
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    if (day.restDismissed) return;
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, restDismissed: true } },
    };
    await this.commit(next);
  }

  /**
   * 30 分钟「玩够啦」收尾卡片今天已经收下：只写一个布尔值，不锁任何功能。
   * 与 20 分钟提醒是两张独立的卡片（各收各的），当天都不再出现，跨天自动重置。
   */
  async dismissRestWrap(now = this.clock()): Promise<void> {
    await this.ready();
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today] ?? emptyDay(today);
    if (day.restWrapDismissed) return;
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, restWrapDismissed: true } },
    };
    await this.commit(next);
  }

  /**
   * 家长页的「清除本机存档」：清空并立刻落盘（界面上有长按确认，防误触）。
   *
   * 刻意不等待 ready()：读档失败/未来版本存档时，清档是家长唯一的自救入口。
   * 清档会标记 writtenBeforeLoad，并在途的读档返回后以内存（空档）为准，不被旧快照覆盖。
   */
  async clear(now = this.clock()): Promise<SaveData> {
    const next = emptySave(now);
    this.data = next;
    this.writtenBeforeLoad = true;
    this.loaded = true;
    this.loading = Promise.resolve(next);
    // 走落盘队列：清档前还在途的存档写完再清，磁盘最终一定是空档（旧进度不会被写回来）
    await this.enqueueSave(next);
    return next;
  }

  private withItemEquipped(
    pet: PetState,
    item: CatalogItem,
  ): Pick<PetState, 'equipped' | 'room'> {
    const isClothing = CLOTHING_SLOTS.includes(item.slot as (typeof CLOTHING_SLOTS)[number]);
    if (isClothing) {
      return { equipped: { ...pet.equipped, [item.slot]: item.id }, room: pet.room };
    }
    return { equipped: pet.equipped, room: { ...pet.room, [item.slot]: item.id } };
  }

  private async commit(next: SaveData): Promise<void> {
    this.data = next;
    if (!this.loaded) this.writtenBeforeLoad = true;
    await this.enqueueSave(next);
  }

  /**
   * 把一次落盘排进队列：磁盘上的写入顺序 = 内存里的提交顺序，最后落地的一定是最新快照。
   * 队列自身吞掉错误（否则一次写盘失败会让后续所有写盘都跟着失败），
   * 但每次都把这份错误原样抛给调用方，unsaved 提示与失败语义不受影响。
   */
  private enqueueSave(next: SaveData): Promise<void> {
    const run = this.saveChain.then(() => this.store.save(next));
    this.saveChain = run.catch(() => undefined);
    return run;
  }
}
