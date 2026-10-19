import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { DESIGN } from '@bamboo/templates/layout';
import { createScrubScene } from '@bamboo/templates/scrub';
import type { ScrubLevel } from '@bamboo/templates/scrub.logic';

const summary = getTaskSummary('bath')!;

/** 洗澡：房间、工具、目标点全部来自内容 JSON 的 levelScript */
export default defineGame({
  manifest: {
    id: 'bath',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createScrubScene(ctx, ctx.task.levelScript as ScrubLevel)],
});
