import type { TaskDetail, TaskDetailExtra, TaskId } from './schema';
import { getTaskSummary } from './tasks';

/**
 * 详情走动态 import：Vite 会把每个 <id>.game.json 切成独立 chunk，
 * 只有真的进入那个玩法才下载。外壳拿到的仍然是一份合并好的 TaskDetail，
 * 游戏本身不需要知道"内容被拆过"。
 */
const LOADERS: Record<TaskId, () => Promise<TaskDetailExtra>> = {
  brush: () => import('./details/brush.game.json').then((m) => m.default as TaskDetailExtra),
  wash: () => import('./details/wash.game.json').then((m) => m.default as TaskDetailExtra),
  feed: () => import('./details/feed.game.json').then((m) => m.default as TaskDetailExtra),
  dress: () => import('./details/dress.game.json').then((m) => m.default as TaskDetailExtra),
  bath: () => import('./details/bath.game.json').then((m) => m.default as TaskDetailExtra),
  sleep: () => import('./details/sleep.game.json').then((m) => m.default as TaskDetailExtra),
  tidy: () => import('./details/tidy.game.json').then((m) => m.default as TaskDetailExtra),
  sport: () => import('./details/sport.game.json').then((m) => m.default as TaskDetailExtra),
  emotion: () => import('./details/emotion.game.json').then((m) => m.default as TaskDetailExtra),
  learn: () => import('./details/learn.game.json').then((m) => m.default as TaskDetailExtra),
};

export async function loadTask(id: TaskId): Promise<TaskDetail | null> {
  const summary = getTaskSummary(id);
  if (!summary) return null;
  const extra = await LOADERS[id]();
  return { ...summary, ...extra };
}
