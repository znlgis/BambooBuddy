import type { TaskSummary } from '@bamboo/content';
import type { PetState, TaskId } from '@bamboo/game-kit';
import { addDays } from '@bamboo/progress';

export interface StickerRow {
  taskId: TaskId;
  emoji: string;
  title: string;
  owned: boolean;
}

/** 贴纸册永远是十格：得到的亮起来，没得到的是剪影（孩子能看见"还有几张"） */
export function stickerRows(pet: PetState, tasks: readonly TaskSummary[]): StickerRow[] {
  const owned = new Set<TaskId>(pet.stickers);
  return tasks.map((task) => ({
    taskId: task.id,
    emoji: task.emoji,
    title: task.title,
    owned: owned.has(task.id),
  }));
}

export type DayKind = 'today' | 'yesterday' | 'earlier';

/** 最近七天里的一行该显示"今天/昨天/日期"（日期本身由调用方按本地习惯切片） */
export function dayKind(date: string, today: string): DayKind {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return 'earlier';
}