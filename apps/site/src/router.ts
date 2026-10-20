import { TASK_IDS } from '@bamboo/content/ids';
import type { TaskId } from '@bamboo/content/ids';
import type { ArcadeGameId } from '@bamboo/game-kit';
import { ARCADE_GAME_IDS } from '@bamboo/game-kit';
import { ref } from 'vue';
import type { Ref } from 'vue';

export interface Route {
  name: 'home' | 'tasks' | 'dress' | 'diary' | 'player' | 'parent' | 'arcade' | 'arcadePlay';
  /** 只有 player 路由带：要玩哪一个日常任务 */
  taskId?: TaskId;
  /** 只有 arcadePlay 路由带：要玩哪一款隐藏小游戏 */
  arcadeId?: ArcadeGameId;
}

function asTaskId(value: string | undefined): TaskId | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  return (TASK_IDS as readonly string[]).includes(decoded) ? (decoded as TaskId) : null;
}

function asArcadeGameId(value: string | undefined): ArcadeGameId | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  return (ARCADE_GAME_IDS as readonly string[]).includes(decoded)
    ? (decoded as ArcadeGameId)
    : null;
}

/**
 * 只用 hash 路由：静态托管（甚至 file:// 打开）不需要任何服务端重写规则，
 * 家长把 dist 拷到 U 盘里也能直接玩。
 * #/ → 小屋；#/tasks / #/dress / #/diary / #/parent；#/play/<id> → 玩法。
 */
export function parseRoute(hash: string): Route {
  // 调试参数也允许挂在 hash 里（'#/play/brush?autoplay=1'，分享链接更干净）：
  // 路由只看 '?' 之前的部分，否则 'brush?autoplay=1' 会被当成一个任务 id。
  const clean = hash.split('?')[0] ?? hash;
  const parts = clean.replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = parts[0];
  if (head === 'play') {
    const taskId = asTaskId(parts[1]);
    // 未知玩法 id 直接回小屋：不给孩子一个空白页
    return taskId ? { name: 'player', taskId } : { name: 'home' };
  }
  // 隐藏小游戏：未知 id 回游戏厅（不给孩子一个空白页）
  if (head === 'arcade') {
    const arcadeId = asArcadeGameId(parts[1]);
    return arcadeId ? { name: 'arcadePlay', arcadeId } : { name: 'arcade' };
  }
  if (head === 'tasks') return { name: 'tasks' };
  if (head === 'dress') return { name: 'dress' };
  if (head === 'diary') return { name: 'diary' };
  // 家长页：长按标题 3 秒进入（孩子点不到），与孩子的主线完全分开
  if (head === 'parent') return { name: 'parent' };
  return { name: 'home' };
}

const route: Ref<Route> = ref(parseRoute(window.location.hash));

window.addEventListener('hashchange', () => {
  route.value = parseRoute(window.location.hash);
});

export function useRoute(): Ref<Route> {
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : '#' + path;
}
