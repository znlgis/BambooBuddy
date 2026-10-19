import type { Locale, TaskId } from './ids';
import { DEFAULT_LOCALE, TASK_IDS } from './ids';
import type { TaskSummary } from './schema';
import type { SummaryPatch } from './localize';
import { localizeSummary } from './localize';

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
 * 摘要表：**唯一的事实来源是 tasks/ 下的 JSON**（中文原文）。
 * 英文补丁单独一个小 chunk（i18n/en/summaries），由 ensureSummaries() 在切语言时动态加载 ——
 * 中文用户不付这份体积，英文用户也不会在启动时闪一屏中文。
 *
 * 运行时刻意不跑 zod（那会把 zod 拖进首屏）；构建期由 `pnpm content:check` 逐条校验。
 */
const RAW: Record<TaskId, unknown> = {
  brush, wash, feed, dress, bath, sleep, tidy, sport, emotion, learn,
};

export const TASKS: readonly TaskSummary[] = TASK_IDS.map((id) => {
  const task = RAW[id] as TaskSummary;
  if (task.id !== id) throw new Error('任务内容 ' + id + ' 的 id 写成了 ' + task.id);
  return task;
});

let enSummaries: Record<TaskId, SummaryPatch> | null = null;
let enLoading: Promise<void> | null = null;

const cache: Partial<Record<Locale, readonly TaskSummary[]>> = { 'zh-CN': TASKS };
const maps: Partial<Record<Locale, Map<TaskId, TaskSummary>>> = {
  'zh-CN': new Map(TASKS.map((task) => [task.id, task])),
};

/** 切到英文前调用一次；已经加载过则立即 resolve。失败时保留中文，不让界面白屏。 */
export function ensureSummaries(locale: Locale): Promise<void> {
  if (locale !== 'en' || enSummaries !== null) return Promise.resolve();
  enLoading ??= import('./i18n/en/summaries')
    .then((module) => {
      enSummaries = module.EN_SUMMARY_PATCHES;
      const localized = TASKS.map((task) => localizeSummary(task, enSummaries?.[task.id]));
      cache.en = localized;
      maps.en = new Map(localized.map((task) => [task.id, task]));
    })
    .catch(() => {
      // 英文补丁加载失败（离线/资源被清）时回落到中文，比空白页好
      enLoading = null;
    });
  return enLoading;
}

export function taskSummaries(locale: Locale = DEFAULT_LOCALE): readonly TaskSummary[] {
  return cache[locale] ?? TASKS;
}

export function getTaskSummary(
  id: string,
  locale: Locale = DEFAULT_LOCALE,
): TaskSummary | undefined {
  return maps[locale]?.get(id as TaskId) ?? maps[DEFAULT_LOCALE]?.get(id as TaskId);
}

export function allTaskIds(): TaskId[] {
  return TASKS.map((task) => task.id);
}
