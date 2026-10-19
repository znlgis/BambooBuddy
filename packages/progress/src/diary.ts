import type { DayRecord, SaveData, TaskId } from '@bamboo/game-kit';
import { addDays, dayKey } from './day';
import { emptyDay } from './save';

export interface WeekDay {
  date: string;
  isToday: boolean;
  completed: TaskId[];
  stickers: TaskId[];
  care: number;
  seconds: number;
  exists: boolean;
}

export function todayRecord(save: SaveData, now: number): DayRecord {
  return save.days[dayKey(now)] ?? emptyDay(dayKey(now));
}

/** 最近七天（含今天），由旧到新：日记页与家长页共用同一份口径 */
export function weekSummary(save: SaveData, now: number): WeekDay[] {
  const today = dayKey(now);
  const out: WeekDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const day = save.days[date];
    out.push({
      date,
      isToday: date === today,
      completed: day?.completed ?? [],
      stickers: day?.stickers ?? [],
      care: day?.care.length ?? 0,
      seconds: day?.seconds ?? 0,
      exists: day !== undefined,
    });
  }
  return out;
}

export function weekCompletedCount(save: SaveData, now: number): number {
  return weekSummary(save, now).reduce((sum, day) => sum + day.completed.length, 0);
}

/** 今天完成了多少件不同的事 */
export function todayCompletedCount(save: SaveData, now: number): number {
  return todayRecord(save, now).completed.length;
}
