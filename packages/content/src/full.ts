/**
 * `@bamboo/content/full`：Node 侧（content:check / 单测）使用的完整内容（中英两份）。
 * 外壳禁止 import 这个入口（eslint 规则），否则首屏会把全部关卡脚本一起下载。
 */
import type { Locale, TaskId } from './ids';
import type { TaskDetail, TaskDetailExtra } from './schema';
import { TaskDetailSchema } from './schema';
import type { DetailPatch } from './localize';
import { localizeSummary, mergeTaskDetail } from './localize';
import { TASKS } from './tasks';
import { EN_SUMMARY_PATCHES } from './i18n/en/summaries';

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

import bathEn from './i18n/en/bath.game.json';
import brushEn from './i18n/en/brush.game.json';
import dressEn from './i18n/en/dress.game.json';
import emotionEn from './i18n/en/emotion.game.json';
import feedEn from './i18n/en/feed.game.json';
import learnEn from './i18n/en/learn.game.json';
import sleepEn from './i18n/en/sleep.game.json';
import sportEn from './i18n/en/sport.game.json';
import tidyEn from './i18n/en/tidy.game.json';
import washEn from './i18n/en/wash.game.json';

const ZH_EXTRA: Record<TaskId, unknown> = {
  brush, wash, feed, dress, bath, sleep, tidy, sport, emotion, learn,
};

const EN_DETAIL_PATCHES: Record<TaskId, DetailPatch> = {
  brush: brushEn,
  wash: washEn,
  feed: feedEn,
  dress: dressEn,
  bath: bathEn,
  sleep: sleepEn,
  tidy: tidyEn,
  sport: sportEn,
  emotion: emotionEn,
  learn: learnEn,
};

function buildDetails(locale: Locale): readonly TaskDetail[] {
  return TASKS.map((summary) => {
    const extra = ZH_EXTRA[summary.id] as TaskDetailExtra;
    const localized =
      locale === 'en' ? localizeSummary(summary, EN_SUMMARY_PATCHES[summary.id]) : summary;
    const patch = locale === 'en' ? EN_DETAIL_PATCHES[summary.id] : undefined;
    const parsed = TaskDetailSchema.safeParse(mergeTaskDetail(localized, extra, patch));
    if (!parsed.success) {
      throw new Error(
        '任务详情 ' + summary.id + '（' + locale + '）不符合 schema：' +
          parsed.error.issues[0]?.message,
      );
    }
    return parsed.data;
  });
}

/** 中文完整内容 */
export const taskDetails: readonly TaskDetail[] = buildDetails('zh-CN');
/** 英文完整内容（摘要补丁 + 详情补丁合并后重新过 schema） */
export const taskDetailsEn: readonly TaskDetail[] = buildDetails('en');

export { TaskDetailSchema, TaskSummarySchema } from './schema';
export { EN_SUMMARY_PATCHES } from './i18n/en/summaries';
export { findCjk } from './localize';
export type { DetailPatch, SummaryPatch } from './localize';
export type { TaskDetail, TaskSummary } from './schema';
