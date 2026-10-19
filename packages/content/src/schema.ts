import { z } from 'zod';
import {
  SLOT_LABELS,
  STAT_KEYS,
  TASK_IDS,
  TEMPLATE_IDS,
  TIME_SLOTS,
} from './ids';

export {
  SLOT_LABELS,
  STAT_KEYS,
  TASK_IDS,
  TEMPLATE_IDS,
  TIME_SLOTS,
};
export type { StatKey, Stats, TaskId, TemplateId, TimeSlot } from './ids';

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #rrggbb');

/** 摘要：小屋 / 任务 / 装扮三屏只需要这些字段（首屏只加载它） */
export const TaskSummarySchema = z.object({
  id: z.enum(TASK_IDS),
  title: z.string().min(1).max(12),
  emoji: z.string().min(1).max(8),
  color: hexColor,
  timeSlots: z.array(z.enum(TIME_SLOTS)).min(1).max(3),
  template: z.enum(TEMPLATE_IDS),
  /** 单局目标时长：30–90 秒（儿童注意力） */
  durationHintSec: z.number().int().min(20).max(120),
  ageRange: z.tuple([z.number().int().min(3), z.number().int().max(9)]),
  /** 成长阶段解锁：1 = 一开始就能玩 */
  unlockLevel: z.number().int().min(1).max(4).default(1),
  /** 完成一次带来的状态变化（只增不减，纯正向） */
  stats: z.partialRecord(z.enum(STAT_KEYS), z.number().int().min(1).max(30)),
  reward: z.object({
    shoots: z.number().int().min(1).max(5),
    xp: z.number().int().min(5).max(30),
  }),
  /** 一句话习惯（家长页 / 日记里出现） */
  habit: z.string().min(1).max(30),
  /** 日记里的一行（图标 + 语音回顾；日记页只读摘要，所以放在这一半） */
  diary: z.string().min(1).max(60),
  /** 一句温柔的玩法提示（卡住时才出现） */
  tip: z.string().min(1).max(40),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

/**
 * 详情：只有进入游戏才需要 —— 语音文案、关卡脚本。
 * 拆成两半是为了首屏：三个界面渲染卡片不需要关卡脚本（与 CHAGS 的 content/content-full 同一条规矩）。
 */
export const TaskDetailSchema = TaskSummarySchema.extend({
  /** 进入玩法时念的一句（孩子不用读） */
  intro: z.string().min(1).max(50),
  /** 完成时的夸奖 */
  done: z.string().min(1).max(50),
  /** 做错时的温柔提示（不惩罚） */
  retry: z.string().min(1).max(40),
  /** 各模板自己的关卡脚本，由 templates/schemas 校验 */
  levelScript: z.unknown(),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** 详情里不属于摘要的那一半（loadTask 合并时用） */
export type TaskDetailExtra = Omit<TaskDetail, keyof TaskSummary>;