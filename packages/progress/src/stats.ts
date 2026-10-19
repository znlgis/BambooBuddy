import type { StatKey, Stats, TaskId } from '@bamboo/content/ids';
import { STAT_KEYS } from '@bamboo/content/ids';

/** 状态不制造焦虑：永远不归零、不扣命、不结束游戏 */
export const STAT_MIN = 10;
export const STAT_MAX = 100;
/** 低于它才给一句温柔提示（"竹竹想刷牙啦"） */
export const HINT_THRESHOLD = 40;

/** 每天自然衰减：一天只掉一次，掉得很轻；健康掉得最慢 */
export const DAILY_DECAY: Stats = {
  fullness: 10,
  energy: 9,
  clean: 10,
  mood: 7,
  health: 4,
};

export function clampStat(value: number): number {
  if (!Number.isFinite(value)) return STAT_MIN;
  return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(value)));
}

export function normalizeStats(value: Partial<Record<StatKey, number>>): Stats {
  const out = {} as Stats;
  for (const key of STAT_KEYS) out[key] = clampStat(value[key] ?? 60);
  return out;
}

/** 完成一次任务的状态收益；重复玩当天收益减半，但不为 0（做了就有好心情） */
export function applyStatDelta(
  stats: Stats,
  delta: Partial<Record<StatKey, number>>,
  factor = 1,
): Stats {
  const out = { ...stats };
  for (const key of STAT_KEYS) {
    const gain = delta[key];
    if (gain === undefined || gain === 0) continue;
    out[key] = clampStat(out[key] + gain * factor);
  }
  return out;
}

/** 跨了几天就衰减几次（一次最多 7 天：久没来也只轻轻掉一点） */
export function decayStats(stats: Stats, days: number): Stats {
  const times = Math.max(0, Math.min(7, Math.floor(days)));
  if (times === 0) return stats;
  const out = { ...stats };
  for (const key of STAT_KEYS) {
    out[key] = clampStat(out[key] - DAILY_DECAY[key] * times);
  }
  return out;
}

export interface StatHint {
  stat: StatKey;
  /** 建议去做哪个任务（界面上映射成"竹竹想刷牙啦"） */
  taskId: TaskId;
}

const HINT_TASKS: Record<StatKey, TaskId> = {
  fullness: 'feed',
  energy: 'sleep',
  clean: 'bath',
  mood: 'emotion',
  health: 'sport',
};

/**
 * 只提示最低的那一两项，而且只提示"去做什么"，不说"你做得不好"。
 * 没有任何状态低时返回空数组 —— 小屋不会挂着一句无病呻吟的提示。
 */
export function statHints(stats: Stats): StatHint[] {
  return [...STAT_KEYS]
    .sort((a, b) => stats[a] - stats[b])
    .filter((stat) => stats[stat] < HINT_THRESHOLD)
    .slice(0, 2)
    .map((stat) => ({ stat, taskId: HINT_TASKS[stat] }));
}
