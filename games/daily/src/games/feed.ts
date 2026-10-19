import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { DESIGN } from '@bamboo/templates/layout';
import { createFeedScene } from '@bamboo/templates/feed';
import type { FeedLevel } from '@bamboo/templates/feed.logic';

const summary = getTaskSummary('feed')!;

/** 吃饭：食物种类/位置/口数与均衡目标全部来自内容 JSON 的 levelScript */
export default defineGame({
  manifest: {
    id: 'feed',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createFeedScene(ctx, ctx.task.levelScript as FeedLevel)],
});
