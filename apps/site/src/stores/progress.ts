import { getTaskSummary } from '@bamboo/content';
import type { TaskId } from '@bamboo/content';
import type { ArcadeGameId, CareAction, ClothingSlot, RoomSlot, SaveData, Stars } from '@bamboo/game-kit';
import { arcadeLevelFor } from '@bamboo/game-kit';
import {
  BIRD_FEED_COST,
  isHarvestDay,
  milestonesFor,
  nextMilestoneFor,
  arcadeAvailable as isArcadeAvailable,
  arcadeStatus as readArcadeStatus,
  careAvailable as isCareAvailable,
  dayKey,
  findItem,
  nextStageForXp,
  ownsItem,
  stageForXp,
  todayRecord as readTodayRecord,
  weekSummary as readWeekSummary,
  xpToNextStage,
} from '@bamboo/progress';
import type {
  BirdFeedOutcome,
  ArcadePlayOutcome,
  ArcadeSecretOutcome,
  CareOutcome,
  CompletionOutcome,
  EquipOutcome,
  FeedOutcome,
  UnlockOutcome,
} from '@bamboo/progress';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import { setDebugSave } from '../shell/debug';
import { platform } from '../shell/platform';
import { progressManager } from '../shell/progress';

/** 20 分钟：一天里玩到这么久就提醒孩子看看远处（一天只提醒一次） */
export const REST_SECONDS = 20 * 60;
/**
 * 30 分钟：不是"强制下线"，是给这一天一个体面的收尾。
 * 《移动互联网未成年人模式建设指南》以 30 分钟为连续使用提醒线（整机口径），
 * 我们按善意对齐做一次"玩够啦"的收尾卡片，仍然不锁、不惩罚。
 */
export const REST_WRAP_SECONDS = 30 * 60;

/** 响应式时钟的心跳：1 分钟。跨天、问候语、今日推荐都靠它自己过期，不用用户刷新 */
const CLOCK_TICK_MS = 60_000;

/**
 * 一个会自己走的时间源。
 *
 * 之前 todayRecord / weekSummary / restDue / careAvailable 都在 computed 里调
 * platform.now()，但 platform.now 不是响应式的：平板插着电挂一夜，第二天打开还是
 * 「晚上好」、昨天的完成勾与推荐批次。这里用每分钟一次（外加切回前台）的 ref 驱动，
 * 派生数据就会自己过期。
 */
function useNow() {
  const now = ref(platform.now());
  const tick = (): void => {
    now.value = platform.now();
  };
  const timer = setInterval(tick, CLOCK_TICK_MS);
  const offResume = platform.lifecycle.onResume(tick);
  onScopeDispose(() => {
    clearInterval(timer);
    offResume();
  });
  return { now, tick };
}

/**
 * 界面唯一的存档读取口。
 *
 * 三条纪律（同 CHAGS 的 ProgressStore）：
 * - 读档 single-flight：深链直达玩法时，一次秒通关的写入不能早于读档完成，否则会被旧快照盖掉；
 * - 每次操作后都用 ProgressManager.snapshot() 换成新对象，界面自动重渲染，debug 桥同步换对象；
 * - 写盘失败只把 unsaved 置位，不打断当前这一局的反馈。
 */
export const useProgress = defineStore('progress', () => {
  const save = ref<SaveData>(progressManager.snapshot());
  const ready = ref(false);
  /** 写盘失败（配额满 / 无痕模式）：界面据此提示"这次可能没存上" */
  const unsaved = ref(false);
  const initError = ref<string | null>(null);
  let inflight: Promise<void> | null = null;

  /** 把内存里的最新快照同时交给界面与 e2e 观测窗口（后者必须是普通对象） */
  function syncSave(): void {
    const snapshot = progressManager.snapshot();
    save.value = snapshot;
    setDebugSave(snapshot);
  }

  function init(): Promise<void> {
    inflight ??= (async () => {
      try {
        save.value = await progressManager.init();
      } catch (cause) {
        // 读档失败先按空档用；但不缓存失败：manager 允许重试（超时/被占用多是瞬时的）
        inflight = null;
        initError.value = cause instanceof Error ? cause.message : String(cause);
        console.warn('[bamboo] 读档失败，先按空档用', cause);
      } finally {
        ready.value = true;
        syncSave();
      }
    })();
    return inflight;
  }

  /**
   * 所有写操作的统一出口：失败可见，成功后同步快照。
   *
   * **必须先 await init()**：App 挂载时只是 `void progress.init()`，界面在 IndexedDB
   * 读档完成前就能点。如果这期间直接写，Manager 会以 emptySave 为底算出新档并落盘，
   * 把真正的旧档覆盖掉 —— 界面看不出异常，下次刷新才发现进度没了。
   * init() 是 single-flight 的，已经读完时这里只是等一个已 resolve 的 Promise。
   */
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      await init();
      const result = await action();
      unsaved.value = false;
      return result;
    } catch (cause) {
      unsaved.value = true;
      console.warn('[bamboo] 存档写入失败：本次进度可能不会保留', cause);
      return null;
    } finally {
      syncSave();
    }
  }

  /** 回到小屋 / 切回前台时调用：跨天就轻轻掉一点状态，并补上今天的日记录 */
  function refresh(): Promise<{ decayedDays: number } | null> {
    return run(() => progressManager.refresh());
  }

  /**
   * 完成一局：mistakes 来自 task:complete 事件（玩法侧只报数字，判定与奖励都在 progress）。
   * 传 mistakes 让 manager 能算「比上次少错几次」，也让完成卡能夸一句进步。
   */
  function completeTask(
    taskId: TaskId,
    stars: Stars,
    mistakes = 0,
  ): Promise<CompletionOutcome | null> {
    const summary = getTaskSummary(taskId);
    if (!summary) return Promise.resolve(null);
    return run(() => progressManager.completeTask(summary, stars, { mistakes }));
  }

  function care(action: CareAction): Promise<CareOutcome | null> {
    return run(() => progressManager.care(action));
  }

  function feed(): Promise<FeedOutcome | null> {
    return run(() => progressManager.feed());
  }

  function unlock(itemId: string): Promise<UnlockOutcome | null> {
    return run(() => progressManager.unlock(itemId));
  }

  function equip(itemId: string): Promise<EquipOutcome | null> {
    return run(() => progressManager.equip(itemId));
  }

  /** 记录一局隐藏小游戏：未解锁 / 今天玩过都会返回 reason，界面据此给一句人话 */
  function playArcade(gameId: ArcadeGameId, score: number): Promise<ArcadePlayOutcome | null> {
    return run(() => progressManager.playArcade(gameId, score));
  }

  /** 小屋里的隐藏彩蛋：当天小门直接打开 + 三款无限畅玩 */
  function unlockArcadeSecret(): Promise<ArcadeSecretOutcome | null> {
    return run(() => progressManager.unlockArcadeSecret());
  }

  async function addSeconds(seconds: number): Promise<void> {
    await run(() => progressManager.addPlaySeconds(seconds));
  }

  async function dismissRest(): Promise<void> {
    await run(() => progressManager.dismissRest());
  }

  async function clear(): Promise<void> {
    await run(() => progressManager.clear());
  }

  /* ------------------------------- 派生数据 ------------------------------- */

  const { now } = useNow();

  const pet = computed(() => save.value.pet);
  const stage = computed(() => stageForXp(save.value.pet.xp));
  const nextStage = computed(() => nextStageForXp(save.value.pet.xp));
  const xpToNext = computed(() => xpToNextStage(save.value.pet.xp));
  const todayRecord = computed(() => readTodayRecord(save.value, now.value));
  const weekSummary = computed(() => readWeekSummary(save.value, now.value));
  const todaySeconds = computed(() => todayRecord.value.seconds);
  const restDue = computed(
    () => todaySeconds.value >= REST_SECONDS && !todayRecord.value.restDismissed,
  );
  /** 30 分钟收尾卡片当天只出现一次；存档字段由 W1 加入 restWrapDismissed 后接管 */
  const restWrapDue = computed(
    () => todaySeconds.value >= REST_WRAP_SECONDS && !todayRecord.value.restWrapDismissed,
  );
  /** 30 分钟收尾卡片「收下啦」：写进当天日记录，跨天自动重置 */
  async function dismissRestWrap(): Promise<void> {
    await run(() => progressManager.dismissRestWrap());
  }

  /** 请小鸟吃一根竹笋（竹笋的轻量消耗出口）：判定在 progress，竹笋不够不扣 */
  function feedBird(): Promise<BirdFeedOutcome | null> {
    return run(() => progressManager.feedBird());
  }

  /** 累计做到过多少件小事（跨任务、跨天、只增不减） */
  const totalCompletions = computed(() => save.value.pet.totalCompletions);
  /** 已经跨过的累计里程碑（家长页/小屋展示用，按 at 升序） */
  const milestones = computed(() => milestonesFor(save.value.pet.totalCompletions));
  /** 下一个还没达成的里程碑（到顶返回 null） */
  const nextMilestone = computed(() => nextMilestoneFor(save.value.pet.totalCompletions));
  /** 今天是不是丰收日（每周六，竹笋 ×2）：确定性日历判断，不是随机掉落 */
  const harvestToday = computed(() => isHarvestDay(dayKey(now.value)));
  /** 请过小鸟几次（竹笋消耗出口的计数） */
  const birdFeeds = computed(() => save.value.pet.birdFeeds);

  /** 今天的小门：解锁了没有、今天玩了几局、还剩几局（界面与 e2e 都从这里读） */
  const arcadeStatus = computed(() => readArcadeStatus(save.value, now.value));
  const arcadeUnlocked = computed(() => arcadeStatus.value.unlocked);
  /** 今天触发了隐藏彩蛋：三款无限畅玩、不限局数 */
  const arcadeUnlimited = computed(() => arcadeStatus.value.unlimited);

  /** 今天每个亲昵动作还能不能做（小屋按钮据此禁用并标注"今天已经做过啦"） */
  const careAvailable = computed<Record<CareAction, boolean>>(() => {
    const today = dayKey(now.value);
    return {
      pat: isCareAvailable(save.value.pet.careDays, 'pat', today),
      hug: isCareAvailable(save.value.pet.careDays, 'hug', today),
      highfive: isCareAvailable(save.value.pet.careDays, 'highfive', today),
    };
  });

  function starsFor(taskId: TaskId): number {
    return save.value.tasks[taskId]?.stars ?? 0;
  }

  function streakFor(taskId: TaskId): number {
    return save.value.tasks[taskId]?.streak ?? 0;
  }

  /** 这个任务一共做到过几次（孩子看得到"我做过几次"，家长看得到坚持） */
  function completionsFor(taskId: TaskId): number {
    return save.value.tasks[taskId]?.completions ?? 0;
  }

  function hasSticker(taskId: TaskId): boolean {
    return save.value.pet.stickers.includes(taskId);
  }

  function completedToday(taskId: TaskId): boolean {
    return todayRecord.value.completed.includes(taskId);
  }

  /** 这一款今天还能不能开局（判定只有一份：progress 的 arcadeAvailable，含隐藏彩蛋的无限畅玩） */
  function arcadeAvailable(gameId: ArcadeGameId): boolean {
    return isArcadeAvailable(save.value, gameId, now.value);
  }

  function arcadeBest(gameId: ArcadeGameId): number {
    return save.value.arcade[gameId]?.best ?? 0;
  }

  /** 这一款当前的难度等级（1..12）：由该款累计完成局数派生，跨天保留、最多 12 级 */
  function arcadeLevel(gameId: ArcadeGameId): number {
    return arcadeLevelFor(save.value.arcade[gameId]?.plays ?? 0);
  }

  /** 玩家以前完成过这个任务（玩法里据此决定要不要说"又做到啦"） */
  function completedBefore(taskId: TaskId): boolean {
    const task = save.value.tasks[taskId];
    return task !== undefined && (task.completions > 0 || task.lastCompletedDay !== null);
  }

  function owns(itemId: string): boolean {
    const item = findItem(itemId);
    return item !== undefined && ownsItem(save.value.pet, item);
  }

  function equippedId(slot: ClothingSlot): string | undefined {
    return save.value.pet.equipped[slot];
  }

  function roomId(slot: RoomSlot): string | undefined {
    return save.value.pet.room[slot];
  }

  return {
    save,
    ready,
    unsaved,
    initError,
    init,
    refresh,
    completeTask,
    care,
    feed,
    unlock,
    equip,
    playArcade,
    unlockArcadeSecret,
    addSeconds,
    dismissRest,
    clear,
    pet,
    stage,
    nextStage,
    xpToNext,
    /** 响应式"现在"（每分钟与切回前台各走一次）：视图里的时间派生都该用它，而不是 platform.now() */
    now,
    todayRecord,
    weekSummary,
    todaySeconds,
    restDue,
    restWrapDue,
    dismissRestWrap,
    feedBird,
    completionsFor,
    totalCompletions,
    milestones,
    nextMilestone,
    harvestToday,
    birdFeeds,
    BIRD_FEED_COST,
    careAvailable,
    arcadeStatus,
    arcadeUnlocked,
    arcadeUnlimited,
    arcadeAvailable,
    arcadeBest,
    arcadeLevel,
    starsFor,
    streakFor,
    hasSticker,
    completedToday,
    completedBefore,
    owns,
    equippedId,
    roomId,
  };
});