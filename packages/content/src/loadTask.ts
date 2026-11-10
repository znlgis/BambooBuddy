import type { Locale, TaskId } from './ids';
import { DEFAULT_LOCALE } from './ids';
import type { TaskDetail, TaskDetailExtra } from './schema';
import type { DetailPatch } from './localize';
import { mergeTaskDetail } from './localize';
import { getTaskSummary } from './tasks';

/**
 * 详情走动态 import：Vite 会把每个 <id>.game.json 切成独立 chunk，
 * 只有真的进入那个玩法才下载。英文详情是另一份补丁，中文用户永远不下载。
 * 外壳拿到的仍然是一份合并好的 TaskDetail，游戏本身不需要知道"内容被拆过"。
 */
const ZH_LOADERS: Record<TaskId, () => Promise<TaskDetailExtra>> = {
  brush: () => import('./details/brush.game.json').then((m) => m.default as TaskDetailExtra),
  wash: () => import('./details/wash.game.json').then((m) => m.default as TaskDetailExtra),
  feed: () => import('./details/feed.game.json').then((m) => m.default as TaskDetailExtra),
  dress: () => import('./details/dress.game.json').then((m) => m.default as TaskDetailExtra),
  bath: () => import('./details/bath.game.json').then((m) => m.default as TaskDetailExtra),
  sleep: () => import('./details/sleep.game.json').then((m) => m.default as TaskDetailExtra),
  tidy: () => import('./details/tidy.game.json').then((m) => m.default as TaskDetailExtra),
  sport: () => import('./details/sport.game.json').then((m) => m.default as TaskDetailExtra),
  emotion: () => import('./details/emotion.game.json').then((m) => m.default as TaskDetailExtra),
  learn: () => import('./details/learn.game.json').then((m) => m.default as TaskDetailExtra),
};

const EN_LOADERS: Record<TaskId, () => Promise<DetailPatch>> = {
  brush: () => import('./i18n/en/brush.game.json').then((m) => m.default as DetailPatch),
  wash: () => import('./i18n/en/wash.game.json').then((m) => m.default as DetailPatch),
  feed: () => import('./i18n/en/feed.game.json').then((m) => m.default as DetailPatch),
  dress: () => import('./i18n/en/dress.game.json').then((m) => m.default as DetailPatch),
  bath: () => import('./i18n/en/bath.game.json').then((m) => m.default as DetailPatch),
  sleep: () => import('./i18n/en/sleep.game.json').then((m) => m.default as DetailPatch),
  tidy: () => import('./i18n/en/tidy.game.json').then((m) => m.default as DetailPatch),
  sport: () => import('./i18n/en/sport.game.json').then((m) => m.default as DetailPatch),
  emotion: () => import('./i18n/en/emotion.game.json').then((m) => m.default as DetailPatch),
  learn: () => import('./i18n/en/learn.game.json').then((m) => m.default as DetailPatch),
};

/** 一套关卡 + 追加变体的最小形状：选择逻辑与单测都只看它 */
export interface VariantSource {
  readonly levelScript: unknown;
  readonly variants?: readonly unknown[];
}

/** loadTask 的选套参数（第三参，可选 —— 不传时行为与旧版完全一致，永远第 1 套） */
export interface LoadTaskOptions {
  /** 本地日期键 YYYY-MM-DD（progress 的 dayKey 格式）：同一天 + 同一任务永远同一套 */
  dayKey?: string;
  /** 显式指定变体下标（0 起）：越界按取模回落；非法值回落 dayKey / 第 1 套 */
  variantIndex?: number;
}

/**
 * 从「第 1 套 + variants」里挑一套（纯函数）。
 * 确定性：显式下标 → dayKey + taskId 哈希 → 第 1 套；绝不读时钟、绝不随机。
 * 旧格式（只有 levelScript）永远返回 levelScript，向后兼容。
 */
export function selectLevelScript(
  source: VariantSource,
  taskId: string,
  options: LoadTaskOptions = {},
): unknown {
  const count = 1 + (source.variants?.length ?? 0);
  const explicit = options.variantIndex;
  let index = 0;
  if (count > 1 && explicit !== undefined && Number.isInteger(explicit)) {
    index = ((explicit % count) + count) % count;
  } else if (count > 1 && (options.dayKey?.trim() ?? '') !== '') {
    // 32 位滚动哈希：跨平台一致，不碰 Math.random / Date.now
    const key = (options.dayKey as string).trim() + '|' + taskId;
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    index = Math.abs(hash) % count;
  }
  return index === 0 ? source.levelScript : (source.variants?.[index - 1] ?? source.levelScript);
}

export async function loadTask(
  id: TaskId,
  locale: Locale = DEFAULT_LOCALE,
  options: LoadTaskOptions = {},
): Promise<TaskDetail | null> {
  const summary = getTaskSummary(id, locale);
  if (!summary) return null;
  const extra = await ZH_LOADERS[id]();
  let detail: TaskDetail;
  if (locale === 'en') {
    // 英文详情缺失时不阻塞游戏：用中文关卡继续（content:check 会在构建期拦住这种漏翻）
    const patch = await EN_LOADERS[id]().catch(() => undefined);
    detail = mergeTaskDetail(summary, extra, patch);
  } else {
    detail = mergeTaskDetail(summary, extra, undefined);
  }
  // 选中的那套写回 levelScript：玩法代码（ctx.task.levelScript）不需要知道变体存在
  const levelScript = selectLevelScript(detail, id, options);
  return levelScript === detail.levelScript ? detail : { ...detail, levelScript };
}
