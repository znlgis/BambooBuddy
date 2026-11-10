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
  /** 英文的第 2 套及以后关卡（与中文 variants 一一对应；content:check 保证中英套数一致） */
  variants?: unknown[];
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
  const merged: TaskDetail = {
    ...summary,
    intro: patch.intro ?? extra.intro,
    done: patch.done ?? extra.done,
    retry: patch.retry ?? extra.retry,
    levelScript: patch.levelScript ?? extra.levelScript,
  };
  // 英文补丁给了 variants 就用英文的（关卡里的标签 / 题目是英文），否则回落到中文
  const variants = patch.variants ?? extra.variants;
  if (variants !== undefined) merged.variants = variants;
  return merged;
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

export type { Locale };
