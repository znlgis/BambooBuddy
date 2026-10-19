import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { createOrderScene } from '@bamboo/templates/order';
import type { OrderLevel } from '@bamboo/templates/order.logic';
import { DESIGN } from '@bamboo/templates/layout';

const summary = getTaskSummary('sleep');
if (!summary) throw new Error('缺少任务内容：sleep');

/** 睡觉 = 睡前顺序模板（order）：拉窗帘 → 关灯 → 盖被子 → 拍拍睡 */
export default defineGame({
  manifest: {
    id: 'sleep',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createOrderScene(ctx, ctx.task.levelScript as OrderLevel)],
});
