import type { TaskSummary } from '@bamboo/content';
import type { StatKey } from '@bamboo/content/ids';
import type { Stars } from '@bamboo/game-kit';
import { dayKey, yesterdayOf } from './day';

/**
 * 星星是"这一局玩得怎么样"的正向反馈，不是评分羞辱：
 * 几乎不失误 3 颗，偶尔重来 2 颗，重来很多次 1 颗 —— **没有 0 颗**。
 */
export function starsFor(mistakes: number): Stars {
  if (mistakes <= 1) return 3;
  if (mistakes <= 3) return 2;
  return 1;
}

export interface CompletionReward {
  shoots: number;
  xp: number;
  /** 今天第 3/6/9… 个不同任务额外给一枚装扮碎片 */
  fragments: number;
}

/** 当天第一次完成给全份奖励；重复玩给一半（最低 1 根竹笋、3 点成长值） */
export function completionReward(task: TaskSummary, firstToday: boolean): CompletionReward {
  const shoots = firstToday ? task.reward.shoots : Math.max(1, Math.floor(task.reward.shoots / 2));
  const xp = firstToday ? task.reward.xp : Math.max(3, Math.floor(task.reward.xp / 2));
  return { shoots, xp, fragments: 0 };
}

/** distinctToday 是"算上这一次之后，今天完成了几个不同任务" */
export function fragmentsFor(distinctToday: number, firstToday: boolean): number {
  if (!firstToday) return 0;
  return distinctToday > 0 && distinctToday % 3 === 0 ? 1 : 0;
}

/** 重复玩时状态收益减半（向上取整，不为 0） */
export function statsDeltaFor(
  task: TaskSummary,
  firstToday: boolean,
): Partial<Record<StatKey, number>> {
  const factor = firstToday ? 1 : 0.5;
  const out: Partial<Record<StatKey, number>> = {};
  for (const [key, value] of Object.entries(task.stats) as [StatKey, number][]) {
    const scaled = Math.max(1, Math.ceil(value * factor));
    out[key] = scaled;
  }
  return out;
}

/**
 * 连续天数：同一天再玩一次保持不变；昨天玩过 → +1；断了 → 从 1 重新开始。
 * 断签不清任何数据、不提示"你断了"，只是重新数。
 */
export function nextStreak(
  lastCompletedDay: string | null,
  today: string,
  previousStreak: number,
): number {
  if (lastCompletedDay === today) return Math.max(1, previousStreak);
  if (lastCompletedDay === yesterdayOf(today)) return Math.max(0, previousStreak) + 1;
  return 1;
}

/** 连续 3 天（以及之后的 6/9…天）完成同一件事，得到一张贴纸；每个任务只有一张 */
export function earnsSticker(streak: number, alreadyOwned: boolean): boolean {
  return !alreadyOwned && streak > 0 && streak % 3 === 0;
}

/** 今日是否已经完成（日记录里的 completed 去重） */
export function completedToday(saveDay: { date: string; completed: readonly string[] }, now: number): boolean {
  return saveDay.date === dayKey(now) && saveDay.completed.length > 0;
}
