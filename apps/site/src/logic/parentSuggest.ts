import type { TaskId } from '@bamboo/content';
import type { MessageKey } from '@bamboo/i18n';

/**
 * 家长页的「今天可以和孩子一起做的一件事」。
 *
 * 只做一件事：把孩子今天在游戏里玩过的任务，翻译成一句现实生活里可执行的亲子动作。
 * - 不用随机（同一批任务给同一句，家长刷新不会变）；
 * - 不做承诺、不医疗化（文案本身已经写成"可以试试"的语气）；
 * - 没有记录时给一句通用的、不以完成任务为前提的建议。
 *
 * 纯函数、无环境依赖：可以直接单测。
 */
const SUGGESTIONS: Record<TaskId, MessageKey> = {
  brush: 'parent.suggest.brush',
  bath: 'parent.suggest.bath',
  feed: 'parent.suggest.feed',
  sleep: 'parent.suggest.sleep',
  emotion: 'parent.suggest.emotion',
  sport: 'parent.suggest.sport',
  wash: 'parent.suggest.wash',
  dress: 'parent.suggest.dress',
  tidy: 'parent.suggest.tidy',
  learn: 'parent.suggest.learn',
};

export function suggestForToday(completed: readonly TaskId[]): MessageKey | null {
  // 优先今天最后一次完成的任务：家长刚陪完，接着做最自然
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    const id = completed[i];
    if (id !== undefined && id in SUGGESTIONS) return SUGGESTIONS[id];
  }
  return null;
}
