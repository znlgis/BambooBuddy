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

/**
 * 安全解码一个 URL 片段：畸形百分号序列（例如 '#/play/%E0%A4%A'）会让
 * decodeURIComponent 抛 URIError。hashchange 回调里抛异常会中断路由更新，
 * 孩子看到的就是一屏白；解不开就按"没有这个 id"处理，由调用方回落到安全页面。
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function asTaskId(value: string | undefined): TaskId | null {
  if (!value) return null;
  const decoded = safeDecode(value);
  if (decoded === null) return null;
  return (TASK_IDS as readonly string[]).includes(decoded) ? (decoded as TaskId) : null;
}

function asArcadeGameId(value: string | undefined): ArcadeGameId | null {
  if (!value) return null;
  const decoded = safeDecode(value);
  if (decoded === null) return null;
  return (ARCADE_GAME_IDS as readonly string[]).includes(decoded)
    ? (decoded as ArcadeGameId)
    : null;
}

/* ---------------- 家长页门禁：会话内令牌 ---------------- */

/**
 * 家长页的承诺是「孩子点不到」，但 #/parent 本身是个可书写的地址：
 * 长按进入后浏览器后退键、或直接把地址发给别人，都能回到这一页 —— 而这一页有
 * 「长按 3 秒清档」。所以进入家长页需要一个**长按才发的令牌**：
 *
 * - 长按标题成功 → 写入令牌 → 跳家长页；
 * - 解析到 parent 时校验令牌（有效期 30 分钟）；
 * - **一旦离开家长页就立刻吊销**，后退键再回来时没有令牌，回落小屋。
 *
 * 令牌放 sessionStorage（关掉标签页即失效），只存时间戳，不含任何用户信息。
 */
export const PARENT_UNLOCK_KEY = 'bamboo.parentUnlock';
/** 令牌有效期：够家长看完报告/切个后台，又不是"永久解锁" */
const PARENT_UNLOCK_TTL_MS = 30 * 60 * 1000;

let parentUnlockAt = 0;

export function grantParentUnlock(now = Date.now()): void {
  parentUnlockAt = now;
  try {
    window.sessionStorage.setItem(PARENT_UNLOCK_KEY, String(now));
  } catch {
    // 隐私模式写不了 sessionStorage：模块内标记仍然有效（本次会话内）
  }
}

/** 离开家长页时调用：后退键 / 直接输地址都再也进不去 */
export function revokeParentUnlock(): void {
  parentUnlockAt = 0;
  try {
    window.sessionStorage.removeItem(PARENT_UNLOCK_KEY);
  } catch {
    // 同上
  }
}

function isParentUnlocked(now = Date.now()): boolean {
  let at = parentUnlockAt;
  try {
    const raw = window.sessionStorage.getItem(PARENT_UNLOCK_KEY);
    if (raw !== null) at = Math.max(at, Number(raw) || 0);
  } catch {
    // 读不了就用模块内标记
  }
  return at !== 0 && now - at <= PARENT_UNLOCK_TTL_MS;
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
  // 家长页：长按标题 3 秒进入（孩子点不到），与孩子的主线完全分开。
  // 没有一次性令牌（后退键 / 直接输地址）一律回小屋。
  if (head === 'parent') return isParentUnlocked() ? { name: 'parent' } : { name: 'home' };
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
