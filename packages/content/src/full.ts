/**
 * `@bamboo/content/full`：Node 侧（content:check / 单测）使用的完整内容。
 * 外壳禁止 import 这个入口（eslint 规则），否则首屏会把全部关卡脚本一起下载。
 */
import type { TaskDetail, TaskId } from './schema';
import { TaskDetailSchema } from './schema';
import { TASKS } from './tasks';

import bath from './details/bath.game.json';
import brush from './details/brush.game.json';
import dress from './details/dress.game.json';
import emotion from './details/emotion.game.json';
import feed from './details/feed.game.json';
import learn from './details/learn.game.json';
import sleep from './details/sleep.game.json';
import sport from './details/sport.game.json';
import tidy from './details/tidy.game.json';
import wash from './details/wash.game.json';

const EXTRA: Record<TaskId, unknown> = {
  brush, wash, feed, dress, bath, sleep, tidy, sport, emotion, learn,
};

export const taskDetails: readonly TaskDetail[] = TASKS.map((summary) => {
  const parsed = TaskDetailSchema.safeParse({ ...summary, ...(EXTRA[summary.id] as object) });
  if (!parsed.success) {
    throw new Error('任务详情 ' + summary.id + ' 不符合 schema：' + parsed.error.issues[0]?.message);
  }
  return parsed.data;
});

export { TaskDetailSchema, TaskSummarySchema } from './schema';
export type { TaskDetail, TaskSummary } from './schema';
