import type { TaskSummary } from '@bamboo/content';
import type { TimeSlot } from '@bamboo/content/ids';
import { TIME_SLOTS } from '@bamboo/content/ids';

/** FNV-1a：同一天同一时段永远推荐同一组任务（可复现，测试不需要随机数） */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：小而确定的伪随机（纯逻辑层禁止 Math.random） */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

export function tasksForSlot(tasks: readonly TaskSummary[], slot: TimeSlot): TaskSummary[] {
  return tasks.filter((task) => task.timeSlots.includes(slot));
}

export function slotIndex(slot: TimeSlot): number {
  return TIME_SLOTS.indexOf(slot);
}

export function neighbourSlots(slot: TimeSlot): TimeSlot[] {
  const index = slotIndex(slot);
  return [TIME_SLOTS[index - 1], TIME_SLOTS[index + 1]].filter(
    (item): item is TimeSlot => item !== undefined,
  );
}

/**
 * 今日推荐：3–5 个任务里取 4 个 —— 两个来自当前时段，前后时段各一个，
 * 不够再从剩下的（含其它时段）补齐。**确定性**：日期 + 时段是种子，
 * 同一天刷多少次都一样（不会每刷新一次就换一批任务让孩子困惑）。
 */
export function recommendedTasks(
  dateKey: string,
  slot: TimeSlot,
  tasks: readonly TaskSummary[],
  count = 4,
): TaskSummary[] {
  if (tasks.length === 0) return [];
  const target = Math.min(Math.max(1, count), tasks.length);
  const random = seededRandom(hashString(dateKey + '|' + slot));
  const picked: TaskSummary[] = [];
  const seen = new Set<string>();

  const take = (candidates: readonly TaskSummary[], limit: number): void => {
    if (limit <= 0) return;
    const pool = shuffled(candidates, random);
    for (const task of pool) {
      if (picked.length >= target || limit <= 0) break;
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      picked.push(task);
      limit -= 1;
    }
  };

  take(tasksForSlot(tasks, slot), 2);
  for (const other of neighbourSlots(slot)) take(tasksForSlot(tasks, other), 1);
  take(tasks, target - picked.length);

  // 最终顺序按"当前时段优先、其余按内容表顺序"，卡片排布稳定
  const order = new Map(tasks.map((task, index) => [task.id, index]));
  return picked.sort((a, b) => {
    const aCurrent = a.timeSlots.includes(slot) ? 0 : 1;
    const bCurrent = b.timeSlots.includes(slot) ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}
