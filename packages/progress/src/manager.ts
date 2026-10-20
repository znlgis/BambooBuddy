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
import { CLOTHING_SLOTS, findItem, ownsItem } from './catalog';
import type { CatalogItem } from './catalog';
import {
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
import { completionReward, earnsSticker, fragmentsFor, nextStreak, statsDeltaFor } from './rewards';
import { emptySave, emptyTaskProgress, ensureDay, migrate } from './save';
import { applyStatDelta, decayStats } from './stats';

export interface CompletionOutcome {
  task: TaskProgress;
  isFirstToday: boolean;
  stars: Stars;
  shoots: number;
  xp: number;
  fragments: number;
  sticker: boolean;
  /** 这一局刚好跨过「今天四件小事」的门槛：外壳据此弹出「发现一扇小门」 */
  arcadeUnlocked: boolean;
}

export type ArcadePlayReason = 'unknown' | 'notUnlocked' | 'already';
export interface ArcadePlayOutcome {
  ok: boolean;
  reason?: ArcadePlayReason;
  gameId: ArcadeGameId;
  /** 玩完之后（或现有的）最高成绩 */
  best: number;
  /** 玩完之后（或现有的）总局数 */
  plays: number;
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
 * 三条实现纪律：
 * - 纯逻辑（奖励、衰减、连续天数）在别的文件里，这里只做编排；
 * - 每次改动都先更新内存再落盘：写盘失败时孩子这一局仍然有反馈，界面另行提示；
 * - 读档只做一次（single-flight），避免深链直达游戏时旧快照覆盖新进度。
 */
export class ProgressManager {
  private readonly store: ProgressStore;
  private readonly clock: () => number;
  private data: SaveData;
  private loading: Promise<SaveData> | null = null;

  constructor(store: ProgressStore, clock: () => number, now = clock()) {
    this.store = store;
    this.clock = clock;
    this.data = emptySave(now);
  }

  init(): Promise<SaveData> {
    this.loading ??= (async () => {
      const now = this.clock();
      let raw: unknown;
      try {
        raw = await this.store.load();
      } catch {
        raw = null;
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
      this.data = next;
      // 只有状态真的变过才写盘：打开一次就写一次只会白耗 IndexedDB 寿命
      if (gap > 0 || missingDay) {
        try {
          await this.store.save(next);
        } catch {
          // 读档已经成功，写失败留给后续操作的 unsaved 提示
        }
      }
      return next;
    })();
    return this.loading;
  }

  snapshot(): SaveData {
    return this.data;
  }

  taskProgress(taskId: TaskId): TaskProgress {
    return this.data.tasks[taskId] ?? emptyTaskProgress(taskId);
  }

  /** 回到小屋 / 切回前台时调用：跨天就掉一点状态，并补上今天的日记录 */
  async refresh(now = this.clock()): Promise<{ decayedDays: number }> {
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

  /** 完成一次任务：奖励、状态收益、连续天数、贴纸全部在这里结算 */
  async completeTask(task: TaskSummary, stars: Stars, now = this.clock()): Promise<CompletionOutcome> {
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
    const arcadeWasUnlocked = isArcadeUnlocked(day);
    const firstToday = !day.completed.includes(task.id);
    const distinctToday = day.completed.length + (firstToday ? 1 : 0);
    const reward = completionReward(task, firstToday);
    const fragments = fragmentsFor(distinctToday, firstToday);
    const previous = data.tasks[task.id] ?? emptyTaskProgress(task.id);
    const streak = nextStreak(previous.lastCompletedDay, today, previous.streak);
    const sticker = earnsSticker(streak, data.pet.stickers.includes(task.id));

    const progress: TaskProgress = {
      taskId: task.id,
      stars: Math.max(previous.stars, stars) as Stars,
      completions: previous.completions + 1,
      lastPlayedAt: now,
      lastCompletedDay: today,
      streak,
      bestStreak: Math.max(previous.bestStreak, streak),
    };

    const pet: PetState = {
      ...data.pet,
      xp: data.pet.xp + reward.xp,
      shoots: data.pet.shoots + reward.shoots,
      fragments: data.pet.fragments + fragments,
      stats: applyStatDelta(data.pet.stats, statsDeltaFor(task, firstToday)),
      stickers: sticker ? [...data.pet.stickers, task.id] : data.pet.stickers,
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
      task: progress,
      isFirstToday: firstToday,
      stars,
      shoots: reward.shoots,
      xp: reward.xp,
      fragments,
      sticker,
      arcadeUnlocked: !arcadeWasUnlocked && isArcadeUnlocked(nextDay),
    };
  }

  /** 今天的小门状态（未解锁 / 已玩哪几款 / 是否无限畅玩），界面与 e2e 都从这里读 */
  arcadeStatus(now = this.clock()): ArcadeStatus {
    return readArcadeStatus(this.data, now);
  }

  /**
   * 触发隐藏彩蛋「竹林小路」：当天小门直接打开，三款游戏无限畅玩。
   * 只写日记录里的一个布尔值（跨天自动失效），不发奖励、不影响任务统计。
   */
  async unlockArcadeSecret(now = this.clock()): Promise<ArcadeSecretOutcome> {
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
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
   * 记录一局隐藏小游戏：只在「已解锁 + 今天没玩过」时成功。
   * 调用时机是一局真正结束（arcade:complete），中途退出不消耗当天的机会。
   */
  async playArcade(
    gameId: ArcadeGameId,
    score: number,
    now = this.clock(),
  ): Promise<ArcadePlayOutcome> {
    if (!isArcadeGameId(gameId)) {
      return { ok: false, reason: 'unknown', gameId, best: 0, plays: 0 };
    }
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
    const previous = data.arcade[gameId] ?? { best: 0, plays: 0, lastPlayedDay: null };
    if (!isArcadeUnlocked(day)) {
      return { ok: false, reason: 'notUnlocked', gameId, best: previous.best, plays: previous.plays };
    }
    // 隐藏彩蛋触发后当天无限畅玩：同一款可以反复玩，最高分与总局数照常累计
    if (!isArcadeUnlimited(day) && day.arcade.includes(gameId)) {
      return { ok: false, reason: 'already', gameId, best: previous.best, plays: previous.plays };
    }
    const next = withArcadePlay(data, gameId, score, now);
    await this.commit(next);
    const record = next.arcade[gameId];
    return { ok: true, gameId, best: record.best, plays: record.plays };
  }

  /** 摸头 / 抱抱 / 击掌：每天各一次，不消耗任何资源 */
  async care(action: CareAction, now = this.clock()): Promise<CareOutcome> {
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
    if (data.pet.careDays[action] === today) {
      return { ok: false, reason: 'already', action, intimacy: data.pet.intimacy, allDone: day.care.length >= 3 };
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
    return { ok: true, action, intimacy: pet.intimacy, allDone: nextDay.care.length >= 3 };
  }

  /** 喂竹笋：消耗 1 根，提升饱腹、心情与亲密度（奖励有了用处，又不构成"氪"） */
  async feed(now = this.clock()): Promise<FeedOutcome> {
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

  /** 解锁：先看阶段，再看竹笋/碎片；解锁后自动穿上（少一步操作，孩子更顺） */
  async unlock(itemId: string, now = this.clock()): Promise<UnlockOutcome> {
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
    const add = Math.max(0, Math.floor(seconds));
    if (add === 0) return;
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, seconds: day.seconds + add } },
    };
    await this.commit(next);
  }

  async dismissRest(now = this.clock()): Promise<void> {
    const today = dayKey(now);
    const data = ensureDay(this.data, now);
    const day = data.days[today]!;
    if (day.restDismissed) return;
    const next: SaveData = {
      ...data,
      updatedAt: now,
      days: { ...data.days, [today]: { ...day, restDismissed: true } },
    };
    await this.commit(next);
  }

  /** 家长页的「清除本机存档」：清空并立刻落盘（界面上有长按确认，防误触） */
  async clear(now = this.clock()): Promise<SaveData> {
    const next = emptySave(now);
    this.data = next;
    this.loading = Promise.resolve(next);
    await this.store.save(next);
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
    await this.store.save(next);
  }
}