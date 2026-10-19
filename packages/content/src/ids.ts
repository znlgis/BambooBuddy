/**
 * 不含 zod、不含任何 JSON 的常量层。
 *
 * 为什么单独一个入口：progress 包的纯逻辑要用 TASK_IDS / STAT_KEYS 做运行时校验，
 * 如果从 '@bamboo/content' 主入口取，就会把 zod 与十条内容的摘要一起拖进单测与首屏 ——
 * 这正是 CHAGS 在 `@chags/content` 与 `@chags/content/full` 之间踩过的坑。
 */

/** 十个日常主题：id 同时是内容 id、存档键、游戏包导出名 —— 只在这里定义一次 */
export const TASK_IDS = [
  'brush',
  'wash',
  'feed',
  'dress',
  'bath',
  'sleep',
  'tidy',
  'sport',
  'emotion',
  'learn',
] as const;
export type TaskId = (typeof TASK_IDS)[number];

/**
 * 玩法模板 id 的唯一事实来源。
 * templates 包的 schema 注册表用 Record<TemplateId, ZodType> 约束，
 * 少登记一个模板在 typecheck 就报；内容里写错模板在 content:check 就报。
 */
export const TEMPLATE_IDS = ['scrub', 'feed', 'dress', 'order', 'tidy', 'rhythm', 'pick', 'learn'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** 五维状态：低于阈值只给温柔提示，不扣命、不结束 */
export const STAT_KEYS = ['fullness', 'energy', 'clean', 'mood', 'health'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

/** 现实时间段：任务按它推荐（早上 / 中午 / 晚上） */
export const TIME_SLOTS = ['morning', 'noon', 'evening'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** 任务卡上展示的时段名 */
export const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '早上',
  noon: '中午',
  evening: '晚上',
};
