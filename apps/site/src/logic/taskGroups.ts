import type { TaskSummary, TimeSlot } from '@bamboo/content';
import { TIME_SLOTS } from '@bamboo/content/ids';

export interface TaskSlotGroup {
  slot: TimeSlot;
  tasks: TaskSummary[];
}

/**
 * "全部玩法"按早/中/晚分组。
 * 每个任务只出现在**第一个时段**里：十个任务分成三组，卡片总数仍是十张 ——
 * 若按"包含的每个时段都列一次"，洗手会在三组里各出现一遍，孩子会以为是三个不同的玩法。
 */
export function groupTasksBySlot(tasks: readonly TaskSummary[]): TaskSlotGroup[] {
  const groups: TaskSlotGroup[] = TIME_SLOTS.map((slot) => ({ slot, tasks: [] }));
  for (const task of tasks) {
    const slot = task.timeSlots[0] ?? 'morning';
    const group = groups.find((candidate) => candidate.slot === slot);
    if (group) group.tasks.push(task);
  }
  return groups.filter((group) => group.tasks.length > 0);
}
