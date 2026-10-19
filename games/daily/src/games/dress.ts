import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { createDressScene } from '@bamboo/templates/dress';
import type { DressLevel } from '@bamboo/templates/dress.logic';
import { DESIGN } from '@bamboo/templates/layout';

const summary = getTaskSummary('dress');
if (!summary) throw new Error('缺少任务内容：dress');

/**
 * 穿衣：关卡脚本在构建期由 content:check 用 dressLevelSchema 校验过，
 * 运行时只把 levelScript 断言成对应类型，不在浏览器里重跑一遍校验。
 */
export default defineGame({
  manifest: {
    id: 'dress',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createDressScene(ctx, ctx.task.levelScript as DressLevel)],
});
