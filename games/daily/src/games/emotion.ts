import { getTaskSummary } from '@bamboo/content';
import { defineGame } from '@bamboo/templates/core';
import { DESIGN } from '@bamboo/templates/layout';
import { createPickScene } from '@bamboo/templates/pick';
import type { PickLevel } from '@bamboo/templates/pick.logic';

const summary = getTaskSummary('emotion');
if (!summary) throw new Error('缺少任务内容：emotion');

/**
 * 情绪：认脸 + 安慰。
 * levelScript 在构建期已由 content:check 用 pickLevelSchema 校验过，
 * 运行时只做类型断言，避免把 zod 拖进游戏 chunk。
 */
export default defineGame({
  manifest: {
    id: 'emotion',
    title: summary.title,
    version: '0.1.0',
    template: summary.template,
    designSize: { width: DESIGN.width, height: DESIGN.height },
    ageRange: summary.ageRange,
  },
  scenes: (ctx) => [createPickScene(ctx, ctx.task.levelScript as PickLevel)],
});
