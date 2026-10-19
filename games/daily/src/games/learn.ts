import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { DESIGN } from '@bamboo/templates/layout';
import { createLearnScene } from '@bamboo/templates/learn';
import type { LearnLevel } from '@bamboo/templates/learn.logic';

const summary = getTaskSummary('learn');
if (!summary) throw new Error('缺少任务内容：learn');

/**
 * 学习：颜色 / 形状 / 数字。
 * levelScript 在构建期已由 content:check 用 learnLevelSchema 校验过，
 * 运行时只做类型断言，避免把 zod 拖进游戏 chunk。
 */
export default defineGame({
  manifest: {
    id: 'learn',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createLearnScene(ctx, ctx.task.levelScript as LearnLevel)],
});
