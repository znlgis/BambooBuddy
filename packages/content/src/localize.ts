import type { Locale } from './ids';
import type { TaskDetail, TaskDetailExtra, TaskSummary } from './schema';

/** 英文摘要补丁：只翻"人读的"字段，结构字段（id/emoji/时段/收益）不重复维护 */
export type SummaryPatch = Partial<Pick<TaskSummary, 'title' | 'habit' | 'diary' | 'tip'>>;

/** 英文详情补丁：语音文案 + 整份英文关卡脚本 */
export interface DetailPatch {
  intro?: string;
  done?: string;
  retry?: string;
  levelScript?: unknown;
}

export function hasSummaryPatch(patch: SummaryPatch): boolean {
  return patch.title !== undefined || patch.habit !== undefined || patch.diary !== undefined || patch.tip !== undefined;
}

export function localizeSummary(summary: TaskSummary, patch: SummaryPatch | undefined): TaskSummary {
  if (patch === undefined) return summary;
  return {
    ...summary,
    title: patch.title ?? summary.title,
    habit: patch.habit ?? summary.habit,
    diary: patch.diary ?? summary.diary,
    tip: patch.tip ?? summary.tip,
  };
}

/**
 * 合并详情。英文补丁必须给全 intro/done/retry 与 levelScript（content:check 会逐条拦），
 * 运行期仍然逐字段回落到中文 —— 少一个字段也不该把整局游戏弄崩。
 */
export function mergeTaskDetail(
  summary: TaskSummary,
  extra: TaskDetailExtra,
  patch: DetailPatch | undefined,
): TaskDetail {
  if (patch === undefined) return { ...summary, ...extra };
  return {
    ...summary,
    intro: patch.intro ?? extra.intro,
    done: patch.done ?? extra.done,
    retry: patch.retry ?? extra.retry,
    levelScript: patch.levelScript ?? extra.levelScript,
  };
}

/** 内容体检用：递归找出仍然含中文的字段路径（英文补丁漏翻的守卫） */
export function findCjk(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    return /[\u4e00-\u9fff]/.test(value) ? [path || '(root)'] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findCjk(item, path + '[' + index + ']'));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      findCjk(item, path === '' ? key : path + '.' + key),
    );
  }
  return [];
}

/** 只保留图片/emoji 的字段不做翻译检查（内容里没有位图，但 emoji 含扩展区字符） */
export const LOCALIZED_ONLY_FIELDS = ['title', 'habit', 'diary', 'tip', 'intro', 'done', 'retry'] as const;

export type { Locale };
