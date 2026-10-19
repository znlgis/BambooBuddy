import type { TimeSlot } from '@bamboo/content';

function pad(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

/** 本地日期的 YYYY-MM-DD（孩子用的是墙钟上的"今天"，不是 UTC 的今天） */
export function dayKey(now: number): string {
  const date = new Date(now);
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
  return Date.UTC(year, month - 1, day);
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
  if (base === null) return key;
  const date = new Date(base + delta * 86_400_000);
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}

export function yesterdayOf(key: string): string {
  return addDays(key, -1);
}

/** 由旧到新的一串日期（含首尾） */
export function dayRange(from: string, to: string): string[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const out: string[] = [];
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}
