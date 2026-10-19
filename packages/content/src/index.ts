/**
 * `@bamboo/content`（外壳侧）：只有常量 / 摘要 + 动态详情加载。
 *
 * ★ 这里**刻意不导出** schema.ts 的运行时对象：zod 的 z.object(...) 是真实副作用，
 * 只要主入口引用它，zod 就会跟着进首屏（CHAGS 实测 24.7 KB gzip / 首屏的 29%）。
 * 需要 zod 的地方走 '@bamboo/content/full'（Node CLI 与测试）。
 *
 * 小屋 / 任务 / 装扮 / 日记只读摘要；进入玩法时才走 loadTask() 动态 import 详情
 * （语音文案 / 关卡脚本）。英文摘要是另一个动态 chunk，切语言时才下载。
 */
export * from './ids';
export type { TaskDetail, TaskDetailExtra, TaskSummary } from './schema';
export type { DetailPatch, SummaryPatch } from './localize';
export {
  TASKS,
  getTaskSummary,
  taskSummaries,
  ensureSummaries,
  allTaskIds,
} from './tasks';
export { loadTask } from './loadTask';
