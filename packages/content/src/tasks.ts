import type { TaskId, TaskSummary } from './schema';
import { TASK_IDS } from './ids';

import bath from './tasks/bath.json';
import brush from './tasks/brush.json';
import dress from './tasks/dress.json';
import emotion from './tasks/emotion.json';
import feed from './tasks/feed.json';
import learn from './tasks/learn.json';
import sleep from './tasks/sleep.json';
import sport from './tasks/sport.json';
import tidy from './tasks/tidy.json';
import wash from './tasks/wash.json';

/**
 * 摘要表：**唯一的事实来源是 tasks/ 下的 JSON**。
 * 这里刻意不在运行时跑 zod 校验（那会把 zod 拖进首屏）——
 * 构建期有 `pnpm content:check` 逐条校验，出错不会走到运行时；
 * 开发期如果 JSON 写坏了，第一个读字段的地方会立刻炸，也好定位。
 */
const RAW: Record<TaskId, unknown> = {
  brush, wash, feed, dress, bath, sleep, tidy, sport, emotion, learn,
};

export const TASKS: readonly TaskSummary[] = TASK_IDS.map((id) => {
  const task = RAW[id] as TaskSummary;
  if (task.id !== id) throw new Error('任务内容 ' + id + ' 的 id 写成了 ' + task.id);
  return task;
});

const BY_ID = new Map<TaskId, TaskSummary>(TASKS.map((task) => [task.id, task]));

export function getTaskSummary(id: string): TaskSummary | undefined {
  return BY_ID.get(id as TaskId);
}

export function allTaskIds(): TaskId[] {
  return TASKS.map((task) => task.id);
}
