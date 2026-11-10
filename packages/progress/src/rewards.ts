import type { TaskSummary } from '@bamboo/content';
import type { StatKey } from '@bamboo/content/ids';
import type { PetState, Stars } from '@bamboo/game-kit';
import { daysBetween, yesterdayOf } from './day';

/** 非负整数兜底：NaN / Infinity / 负数 / 小数都在这里变成安全值（纯逻辑层不信任任何外部输入） */
function nonNegativeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/* ------------------------------------------------------------------ *
 * 丰收日：每周固定一天竹笋 ×2（P1-3，对应 Toca 周五邮局）
 * ------------------------------------------------------------------ */

/** 丰收日固定在每周六：确定性、可预期，孩子一周里知道有一天可以多收一点 */
export const HARVEST_WEEKDAY = 6;

/** 1970-01-01 是周四（4）：日期算术只借 day.ts 的 daysBetween，不读隐式时钟、不受时区/夏令时影响 */
const EPOCH_WEEKDAY = 4;

/** 日期键是星期几（0=周日 … 6=周六）；坏日期返回 -1（永远不是丰收日） */
function weekdayOf(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return -1;
  // daysBetween 对非法日历日（2026-02-31）返回 0 → 落到周四，不误判成丰收日
  const diff = daysBetween('1970-01-01', day);
  return (((EPOCH_WEEKDAY + diff) % 7) + 7) % 7;
}

/** 这一天是不是丰收日（每周六）：只做日历判断，不读时钟 —— 日期键由调用方用 dayKey(now) 传进来 */
export function isHarvestDay(day: string): boolean {
  return weekdayOf(day) === HARVEST_WEEKDAY;
}

/** 丰收日倍率：周六 2，其余 1（纯函数；在 completionReward 之上叠乘，奖励数值仍然只有这一份实现） */
export function harvestMultiplier(day: string): 1 | 2 {
  return isHarvestDay(day) ? 2 : 1;
}

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

/**
 * 当天第一次完成给全份奖励；重复玩给一半（最低 1 根竹笋、3 点成长值）。
 * 丰收日（multiplier = 2）只把**竹笋**翻倍：成长值不翻，避免一天把四个阶段全部冲完。
 */
export function completionReward(
  task: TaskSummary,
  firstToday: boolean,
  multiplier: 1 | 2 = 1,
): CompletionReward {
  const baseShoots = firstToday
    ? task.reward.shoots
    : Math.max(1, Math.floor(task.reward.shoots / 2));
  const shoots = Math.max(1, baseShoots) * multiplier;
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

/* ------------------------------------------------------------------ *
 * 进步反馈（P1-7）：只在"比上次少错"时夸一句，从不显示退步
 * ------------------------------------------------------------------ */

export interface ProgressHint {
  /** 比上一次少错了几次；没有更好就是 0 */
  better: number;
}

/**
 * 完成卡的"比上次少错 X 次"：只有 mistakes < lastMistakes 时才返回差值。
 * 没做过（lastMistakes 为 0）不算进步 —— 没有"上一次"可比，也避免第一次就自夸。
 * 持平与更差都返回 0：孩子看到的永远是"继续玩"，不是"退步了"。
 */
export function progressFor(mistakes: number, lastMistakes: number): ProgressHint {
  // 坏输入（NaN / 负数）不参与比较：宁可不夸，也不给出一个假的"进步"
  if (!Number.isFinite(mistakes) || !Number.isFinite(lastMistakes)) return { better: 0 };
  if (mistakes < 0 || lastMistakes < 0) return { better: 0 };
  const current = Math.floor(mistakes);
  const previous = Math.floor(lastMistakes);
  if (previous <= 0 || current >= previous) return { better: 0 };
  return { better: previous - current };
}

/* ------------------------------------------------------------------ *
 * 喂小鸟（P1-5）：竹笋的一个轻量消耗出口，只给动画与计数，不给数值增益
 * ------------------------------------------------------------------ */

/** 喂小鸟一次花几根竹笋 */
export const BIRD_FEED_COST = 1;

/** 只取存档里的两个字段：判定不依赖 PetState 的其它部分（少一个耦合面） */
export type BirdFeedSource = Pick<PetState, 'shoots' | 'birdFeeds'>;

export interface BirdFeedResult {
  ok: boolean;
  reason?: 'noShoots';
  /** 喂完（或现状）的竹笋：永远是 0 或正数 */
  shoots: number;
  /** 喂完（或现状）的喂小鸟次数 */
  birdFeeds: number;
  /** 这一次花掉几根（被拒绝时是 0） */
  spent: number;
}

/**
 * 喂小鸟的判定（纯函数）：竹笋够才扣，扣完不可能为负。
 * 判定永远只有这一份实现 —— Manager 只负责 await ready() 与「判定即落档」。
 */
export function feedBird(source: BirdFeedSource, cost: number = BIRD_FEED_COST): BirdFeedResult {
  const shoots = nonNegativeInt(source.shoots);
  const birdFeeds = nonNegativeInt(source.birdFeeds);
  // 花销不合法（0 / 负数 / NaN）时按 1 根算：不给"免费喂"的口子，也不让坏参数白送竹笋
  const price = Math.max(1, nonNegativeInt(cost));
  if (shoots < price) return { ok: false, reason: 'noShoots', shoots, birdFeeds, spent: 0 };
  return { ok: true, shoots: shoots - price, birdFeeds: birdFeeds + 1, spent: price };
}
