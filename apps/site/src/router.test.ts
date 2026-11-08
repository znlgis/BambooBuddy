import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * router.ts 在模块加载时就读 window.location.hash，并注册 hashchange：
 * 先在 node 里给一个最小 window 桩，再动态 import（同 backButton.test.ts 的做法）。
 * sessionStorage 也要给：家长页的一次性令牌存在那里。
 */
const storage = new Map<string, string>();
const listeners: Array<() => void> = [];
vi.stubGlobal('window', {
  location: { hash: '' },
  sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
  addEventListener: (_type: string, cb: () => void) => {
    listeners.push(cb);
  },
});

const { grantParentUnlock, parseRoute, revokeParentUnlock, useRoute } = await import('./router');

beforeEach(() => {
  // 模块内标记也要清：sessionStorage 可用时它不会被写入，但隐私模式分支会用到
  revokeParentUnlock();
  storage.clear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('hash 路由解析', () => {
  it('空 hash 与未知路径都回小屋', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/nope')).toEqual({ name: 'home' });
  });

  it('已知任务 id 进玩法；未知 id 回小屋（不给孩子空白页）', () => {
    expect(parseRoute('#/play/brush')).toEqual({ name: 'player', taskId: 'brush' });
    expect(parseRoute('#/play/not-a-task')).toEqual({ name: 'home' });
  });

  it('畸形百分号序列不抛异常，按未知 id 回落', () => {
    expect(() => parseRoute('#/play/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/play/%E0%A4%A')).toEqual({ name: 'home' });
    expect(() => parseRoute('#/arcade/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/arcade/%E0%A4%A')).toEqual({ name: 'arcade' });
  });

  it('已知小游戏进游戏；未知 id 回游戏厅', () => {
    expect(parseRoute('#/arcade/popstar')).toEqual({ name: 'arcadePlay', arcadeId: 'popstar' });
    expect(parseRoute('#/arcade/not-a-game')).toEqual({ name: 'arcade' });
  });

  it('query 不参与路由：深链参数挂在 ? 之后', () => {
    expect(parseRoute('#/play/brush?autoplay=1')).toEqual({ name: 'player', taskId: 'brush' });
    expect(parseRoute('#/arcade/tetris?autoplay=1&instant=1')).toEqual({
      name: 'arcadePlay',
      arcadeId: 'tetris',
    });
  });

  it('普通页面各自命中', () => {
    expect(parseRoute('#/tasks')).toEqual({ name: 'tasks' });
    expect(parseRoute('#/dress')).toEqual({ name: 'dress' });
    expect(parseRoute('#/diary')).toEqual({ name: 'diary' });
  });

  it('家长页没有令牌时回小屋（后退键 / 直接输地址都进不去）', () => {
    expect(parseRoute('#/parent')).toEqual({ name: 'home' });
  });

  it('长按发令牌后能进；刷新重解析仍然在（会话内有效）', () => {
    grantParentUnlock(Date.now());
    expect(parseRoute('#/parent')).toEqual({ name: 'parent' });
    expect(parseRoute('#/parent')).toEqual({ name: 'parent' });
  });

  it('离开家长页吊销令牌后，后退键再回来就回小屋', () => {
    grantParentUnlock(Date.now());
    expect(parseRoute('#/parent')).toEqual({ name: 'parent' });
    revokeParentUnlock();
    expect(parseRoute('#/parent')).toEqual({ name: 'home' });
  });

  it('过期令牌不认（长按成功后放了太久）', () => {
    grantParentUnlock(Date.now() - 31 * 60 * 1000);
    expect(parseRoute('#/parent')).toEqual({ name: 'home' });
  });

  it('hashchange 后路由状态跟着更新', () => {
    const route = useRoute();
    expect(listeners.length).toBeGreaterThan(0);
    (globalThis as { window: { location: { hash: string } } }).window.location.hash = '#/dress';
    listeners.forEach((listener) => listener());
    expect(route.value).toEqual({ name: 'dress' });
  });
});
