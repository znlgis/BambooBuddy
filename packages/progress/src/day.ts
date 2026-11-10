import type { TimeSlot } from '@bamboo/content';

function pad(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

/**
 * 本地日期的 YYYY-MM-DD（孩子用的是墙钟上的"今天"，不是 UTC 的今天）。
 *
 * 非有限时间戳（NaN / Infinity，来自坏注入时钟）按 1970-01-01 处理：
 * 若不兜底会得到 "NaN-NaN-NaN" 并当成日期键写进存档、参与字典序裁剪，坏得无声无息。
 */
export function dayKey(now: number): string {
  const date = new Date(Number.isFinite(now) ? now : 0);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function localHour(now: number): number {
  return new Date(now).getHours();
}

/** 现实时间段：早上 / 中午 / 晚上（任务推荐按它走） */
export function currentSlot(now: number): TimeSlot {
  const hour = localHour(now);
  if (hour < 11) return 'morning';
  if (hour < 17) return 'noon';
  return 'evening';
}

/** 日期键转 UTC 毫秒：只用于算"相差几天"，不受夏令时影响 */
function dayKeyToUtc(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  // Date.UTC 会把 2026-02-31 归一化成 3 月 3 日：反查一遍，非法日历日一律当坏键
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return utc;
}

/** 日期键是否合法：格式 YYYY-MM-DD 且这个日历日真实存在（2026-02-31 / 2026-99-99 都算坏键） */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && dayKeyToUtc(value) !== null;
}

/** to − from 的整天数；任一日期非法返回 0（坏存档按"没有跨天"处理） */
export function daysBetween(from: string, to: string): number {
  const a = dayKeyToUtc(from);
  const b = dayKeyToUtc(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function addDays(key: string, delta: number): string {
  const base = dayKeyToUtc(key);
  // 坏 delta（NaN / Infinity）同样原样返回坏键：否则会造出 "NaN-NaN-NaN" 这种假日期键
  if (base === null || !Number.isFinite(delta)) return key;
  const date = new Date(base + delta * 86_400_000);
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}

export function yesterdayOf(key: string): string {
  return addDays(key, -1);
}
