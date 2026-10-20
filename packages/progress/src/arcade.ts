import type { ArcadeGameId, ArcadeProgress, DayRecord, SaveData } from '@bamboo/game-kit';
import { ARCADE_GAME_IDS } from '@bamboo/game-kit';
import { DAILY_TASK_TARGET } from './daily';
import { dayKey } from './day';
import { ensureDay } from './save';

export interface ArcadeStatus {
  /** 今天的小门出现了没有 */
  unlocked: boolean;
  /** 今天完成了几件不同的小事 / 目标件数（界面上的 3/4 只给家长看，孩子界面不做进度条） */
  completed: number;
  target: number;
  /** 今天已经玩过的小游戏（去重） */
  played: ArcadeGameId[];
  /** 今天还能玩的小游戏 */
  remaining: ArcadeGameId[];
  /** 今天触发了隐藏彩蛋：三款游戏无限畅玩 */
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

export function arcadeStatus(save: SaveData, now: number): ArcadeStatus {
  const day = save.days[dayKey(now)];
  const played = day?.arcade ?? [];
  const unlimited = arcadeUnlimited(day);
  return {
    unlocked: arcadeUnlocked(day),
    completed: day?.completed.length ?? 0,
    target: DAILY_TASK_TARGET,
    played,
    remaining: unlimited ? [...ARCADE_GAME_IDS] : ARCADE_GAME_IDS.filter((id) => !played.includes(id)),
    unlimited,
  };
}

/** 这一款今天还能不能玩（未解锁 → 都不能；已玩过 → 不能；隐藏彩蛋 → 随便玩） */
export function arcadeAvailable(save: SaveData, gameId: ArcadeGameId, now: number): boolean {
  const day = save.days[dayKey(now)];
  if (!arcadeUnlocked(day) || day === undefined) return false;
  return arcadeUnlimited(day) || !day.arcade.includes(gameId);
}

/** 记录一局：最高分只增不减、总次数 +1、今天玩过。纯函数，落盘由 Manager 负责。 */
export function withArcadePlay(
  save: SaveData,
  gameId: ArcadeGameId,
  score: number,
  now: number,
): SaveData {
  const today = dayKey(now);
  const data = ensureDay(save, now);
  const day = data.days[today]!;
  const safeScore = Math.max(0, Math.floor(score));
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
      },
    },
  };
}
