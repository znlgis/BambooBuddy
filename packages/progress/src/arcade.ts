import type { ArcadeGameId, ArcadeProgress, DayRecord, SaveData } from '@bamboo/game-kit';
import { ARCADE_GAME_IDS } from '@bamboo/game-kit';
import { DAILY_TASK_TARGET } from './daily';
import { dayKey } from './day';
import { emptyDay, ensureDay } from './save';

/**
 * 普通模式每天最多玩几局（三款游戏合计）。
 * 无限畅玩（竹林小路）不设局数上限，只累计局数用于难度成长。
 */
export const ARCADE_DAILY_PLAYS = 21;

export interface ArcadeStatus {
  /** 今天的小门出现了没有 */
  unlocked: boolean;
  /** 今天完成了几件不同的小事 / 目标件数（界面上的 3/4 只给家长看，孩子界面不做进度条） */
  completed: number;
  target: number;
  /** 今天已经完整玩完几局（三款合计） */
  playsToday: number;
  /** 普通模式每天最多几局（无限畅玩也返回这个数，只是不拦） */
  dailyLimit: number;
  /** 今天还剩几局（无限畅玩时界面显示 ∞，不看这个数） */
  remainingPlays: number;
  /** 今天触发了隐藏彩蛋：三款游戏无限畅玩、不设局数上限 */
  unlimited: boolean;
}

/** 运行时校验：存档里的坏 id、路由里的乱 id 都靠它挡掉 */
export function isArcadeGameId(value: string): value is ArcadeGameId {
  return (ARCADE_GAME_IDS as readonly string[]).includes(value);
}

/** 今天有没有触发隐藏彩蛋（竹林小路）：小门直接打开，三款游戏无限畅玩 */
export function arcadeUnlimited(day: DayRecord | undefined): boolean {
  return day?.arcadeSecret === true;
}

/**
 * 解锁判定的唯一实现：今天完成的不同任务数 ≥ 每日目标（4），
 * 或者触发了隐藏彩蛋（不用攒四件小事，小门也开着）。
 * 按数量而不是「今日推荐的这一批」：推荐集是 日期 + 时段 的种子，中午/晚上会换一批，
 * 按集合判定会出现「上午解锁、中午又锁上」；按数量判定当天只增不减，稳定且对得起孩子。
 */
export function arcadeUnlocked(day: DayRecord | undefined): boolean {
  if (day === undefined) return false;
  return day.completed.length >= DAILY_TASK_TARGET || arcadeUnlimited(day);
}

/** 今天已经玩完了几局（中途退出不计数） */
export function arcadePlaysToday(day: DayRecord | undefined): number {
  if (day === undefined) return 0;
  return Math.max(0, Math.floor(day.arcadePlays));
}

export function arcadeStatus(save: SaveData, now: number): ArcadeStatus {
  const day = save.days[dayKey(now)];
  const playsToday = arcadePlaysToday(day);
  return {
    unlocked: arcadeUnlocked(day),
    completed: day?.completed.length ?? 0,
    target: DAILY_TASK_TARGET,
    playsToday,
    dailyLimit: ARCADE_DAILY_PLAYS,
    remainingPlays: Math.max(0, ARCADE_DAILY_PLAYS - playsToday),
    unlimited: arcadeUnlimited(day),
  };
}

/**
 * 这一款今天还能不能开局：
 * 未解锁 → 都不能；无限畅玩 → 随便玩；普通模式 → 今天还没玩满 ARCADE_DAILY_PLAYS 局就能玩（不限哪一款）。
 */
export function arcadeAvailable(save: SaveData, gameId: ArcadeGameId, now: number): boolean {
  const day = save.days[dayKey(now)];
  if (!arcadeUnlocked(day) || day === undefined) return false;
  // 额度是三款**共用**的（普通模式每天 ARCADE_DAILY_PLAYS 局），gameId 只为调用处对称；
  // 保留参数是为了兼容外壳的调用签名（改签名要同步 apps/site/src/stores/progress.ts）。
  void gameId;
  return arcadeUnlimited(day) || arcadePlaysToday(day) < ARCADE_DAILY_PLAYS;
}

/**
 * 记录一局：最高分只增不减、总次数 +1、今天玩过、今天局数 +1。
 * 纯函数，落盘由 Manager 负责；无限畅玩也照常累计（只是不设上限）。
 */
export function withArcadePlay(
  save: SaveData,
  gameId: ArcadeGameId,
  score: number,
  now: number,
): SaveData {
  const today = dayKey(now);
  const data = ensureDay(save, now);
  const day = data.days[today] ?? emptyDay(today);
  // NaN / Infinity 过不了 Math.max + Math.floor（结果仍是 NaN），会让 best 变成 NaN；
  // 落盘后 sanitize 又把 NaN 兜底成 0，等于把历史最高分抹掉 —— 所以这里必须先夹取。
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  const previous: ArcadeProgress = data.arcade[gameId] ?? { best: 0, plays: 0, lastPlayedDay: null };
  return {
    ...data,
    updatedAt: now,
    arcade: {
      ...data.arcade,
      [gameId]: {
        best: Math.max(previous.best, safeScore),
        plays: previous.plays + 1,
        lastPlayedDay: today,
      },
    },
    days: {
      ...data.days,
      [today]: {
        ...day,
        arcade: day.arcade.includes(gameId) ? day.arcade : [...day.arcade, gameId],
        arcadePlays: arcadePlaysToday(day) + 1,
      },
    },
  };
}
