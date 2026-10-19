import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { createTidyScene } from '@bamboo/templates/tidy';
import type { TidyLevel } from '@bamboo/templates/tidy.logic';
import { DESIGN } from '@bamboo/templates/layout';

const summary = getTaskSummary('tidy');
if (!summary) throw new Error('缺少任务内容：tidy');

/** 整理 = 分类模板（tidy）：按类别把玩具送回箱子 */
export default defineGame({
  manifest: {
    id: 'tidy',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createTidyScene(ctx, ctx.task.levelScript as TidyLevel)],
});
