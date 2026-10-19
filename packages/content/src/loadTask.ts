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

export async function loadTask(
  id: TaskId,
  locale: Locale = DEFAULT_LOCALE,
): Promise<TaskDetail | null> {
  const summary = getTaskSummary(id, locale);
  if (!summary) return null;
  const extra = await ZH_LOADERS[id]();
  if (locale !== 'en') return mergeTaskDetail(summary, extra, undefined);
  try {
    const patch = await EN_LOADERS[id]();
    return mergeTaskDetail(summary, extra, patch);
  } catch {
    // 英文详情缺失时不阻塞游戏：用中文关卡继续（content:check 会在构建期拦住这种漏翻）
    return mergeTaskDetail(summary, extra, undefined);
  }
}
