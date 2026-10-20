import { getTaskSummary } from '@bamboo/content';
import type { TaskId } from '@bamboo/content';
import type { ArcadeGameId, CareAction, ClothingSlot, RoomSlot, SaveData, Stars } from '@bamboo/game-kit';
import {
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
  ArcadePlayOutcome,
  ArcadeSecretOutcome,
  CareOutcome,
  CompletionOutcome,
  EquipOutcome,
  FeedOutcome,
  UnlockOutcome,
} from '@bamboo/progress';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { setDebugSave } from '../shell/debug';
import { platform } from '../shell/platform';
import { progressManager } from '../shell/progress';

/** 20 分钟：一天里玩到这么久就提醒孩子看看远处（一天只提醒一次） */
export const REST_SECONDS = 20 * 60;

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
        // 存档坏了不是致命错误：本次会话从空档开始，界面照样能用
        initError.value = cause instanceof Error ? cause.message : String(cause);
        console.warn('[bamboo] 存档读取失败，本次从空档开始', cause);
      } finally {
        ready.value = true;
        syncSave();
      }
    })();
    return inflight;
  }

  /** 所有写操作的统一出口：失败可见，成功后同步快照 */
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
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

  function completeTask(taskId: TaskId, stars: Stars): Promise<CompletionOutcome | null> {
    const summary = getTaskSummary(taskId);
    if (!summary) return Promise.resolve(null);
    return run(() => progressManager.completeTask(summary, stars));
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

  const pet = computed(() => save.value.pet);
  const stage = computed(() => stageForXp(save.value.pet.xp));
  const nextStage = computed(() => nextStageForXp(save.value.pet.xp));
  const xpToNext = computed(() => xpToNextStage(save.value.pet.xp));
  const todayRecord = computed(() => readTodayRecord(save.value, platform.now()));
  const weekSummary = computed(() => readWeekSummary(save.value, platform.now()));
  const todaySeconds = computed(() => todayRecord.value.seconds);
  const restDue = computed(
    () => todaySeconds.value >= REST_SECONDS && !todayRecord.value.restDismissed,
  );

  /** 今天的小门：解锁了没有、三款里哪几款还能玩（界面与 e2e 都从这里读） */
  const arcadeStatus = computed(() => readArcadeStatus(save.value, platform.now()));
  const arcadeUnlocked = computed(() => arcadeStatus.value.unlocked);
  const arcadePlayed = computed(() => arcadeStatus.value.played);
  /** 今天触发了隐藏彩蛋：三款无限畅玩 */
  const arcadeUnlimited = computed(() => arcadeStatus.value.unlimited);

  /** 今天每个亲昵动作还能不能做（小屋按钮据此禁用并标注"今天已经做过啦"） */
  const careAvailable = computed<Record<CareAction, boolean>>(() => {
    const today = dayKey(platform.now());
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

  function hasSticker(taskId: TaskId): boolean {
    return save.value.pet.stickers.includes(taskId);
  }

  function completedToday(taskId: TaskId): boolean {
    return todayRecord.value.completed.includes(taskId);
  }

  /** 这一款今天还能不能玩（判定只有一份：progress 的 arcadeAvailable，含隐藏彩蛋的无限畅玩） */
  function arcadeAvailable(gameId: ArcadeGameId): boolean {
    return isArcadeAvailable(save.value, gameId, platform.now());
  }

  function arcadeBest(gameId: ArcadeGameId): number {
    return save.value.arcade[gameId]?.best ?? 0;
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
    todayRecord,
    weekSummary,
    todaySeconds,
    restDue,
    careAvailable,
    arcadeStatus,
    arcadeUnlocked,
    arcadePlayed,
    arcadeUnlimited,
    arcadeAvailable,
    arcadeBest,
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
