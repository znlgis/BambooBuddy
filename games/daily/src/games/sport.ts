import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { DESIGN } from '@bamboo/templates/layout';
import { createRhythmScene } from '@bamboo/templates/rhythm';
import type { RhythmLevel } from '@bamboo/templates/rhythm.logic';

const summary = getTaskSummary('sport');
if (!summary) throw new Error('缺少任务内容：sport');

/**
 * 运动：跳竹竿。
 * levelScript 在构建期已由 content:check 用 rhythmLevelSchema 校验过，
 * 运行时直接断言交给模板 —— 已校验的数据不该在每个游戏 chunk 里再跑一遍 zod。
 */
export default defineGame({
  manifest: {
    id: 'sport',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createRhythmScene(ctx, ctx.task.levelScript as RhythmLevel)],
});
