import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitEvent } from './shared';

/**
 * 隐藏小游戏（竹林小门）的主链路：
 * 1. 隐藏：没完成四件小事时，小屋没有小门，直达 #/arcade 会被送回小屋；
 * 2. 解锁：完成第四件不同的小事 → 结算浮层出现小门 → 进游戏厅；
 * 3. 每日 21 局（2026-11-07 新规则）：普通模式三款合计每天最多 21 局，用完后卡片仍可见但点不进去，
 *    深链也被送回游戏厅；次日（日记录）自动归零；
 * 4. 难度等级：每款独立 Lv.N（由该款累计完成局数派生、跨天保留），卡片直接展示；
 * 5. 无限畅玩（竹林小路）：不受 21 局限制，普通模式已玩满 21 局也仍能进入并完成第 22 局。
 *
 * 存档直接从 IndexedDB 播种（与真实存档同一个 schema），不靠「先玩四关」凑前置，
 * 这样每条用例只验证自己那件事，失败时原因清楚。
 */

const TODAY = (() => {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
})();

interface SeedOptions {
  /** 今天已经完成的任务 id（不同任务） */
  completed: string[];
  /** 今天已经完整玩完几局（三款合计；普通模式上限 7） */
  arcadePlays?: number;
  /** 今天已经玩过的小游戏（日记/家长页用；新规则不再按它拦人） */
  arcade?: string[];
  /** 跨天成绩（id → 累计玩过几次）：决定该款的难度等级 */
  plays?: Record<string, number>;
  /** 今天触发了竹林小路：无限畅玩、不限局数 */
  arcadeSecret?: boolean;
}

/**
 * 把一份最小存档写进 IndexedDB 再刷新：schemaVersion 用最新（4），
 * 缺的字段（pet/tasks/奖励等）由 migrate 的 sanitize 逐条兜底。
 */
async function seedSave(page: Page, options: SeedOptions): Promise<void> {
  const arcade: Record<string, { best: number; plays: number; lastPlayedDay: string }> = {};
  for (const [id, plays] of Object.entries(options.plays ?? {})) {
    arcade[id] = { best: 10, plays, lastPlayedDay: TODAY };
  }
  const save = {
    schemaVersion: 4,
    updatedAt: Date.now(),
    pet: {},
    tasks: {},
    arcade,
    days: {
      [TODAY]: {
        date: TODAY,
        completed: options.completed,
        arcade: options.arcade ?? [],
        arcadePlays: options.arcadePlays ?? 0,
        arcadeSecret: options.arcadeSecret === true,
        rewards: {},
        stickers: [],
        care: [],
        seconds: 0,
        restDismissed: false,
      },
    },
  };

  await page.goto('/');
  await page.evaluate(async (payload) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('bamboobuddy', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      const write = (): void => {
        const db = request.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(payload, 'save');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      };
      request.onsuccess = write;
      request.onerror = () => resolve();
    });
  }, save);
  await page.reload();
}

interface BridgeSave {
  arcade?: Record<string, { plays?: number; best?: number }>;
  days?: Record<string, { arcadePlays?: number }>;
}

/** 等某款累计局数变成期望值（写档成功后外壳会同步 window.__bamboo.save） */
async function waitGamePlays(page: Page, gameId: string, plays: number, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    (args) => {
      const bridge = (window as unknown as { __bamboo?: { save?: BridgeSave } }).__bamboo;
      return bridge?.save?.arcade?.[args.gameId]?.plays === args.plays;
    },
    { gameId, plays },
    { timeout: timeoutMs, polling: 50 },
  );
}

/** 等「今天已完成局数」变成期望值（普通模式 21 局上限、无限模式第 22 局都读它） */
async function waitPlaysToday(page: Page, plays: number, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    (args) => {
      const bridge = (window as unknown as { __bamboo?: { save?: BridgeSave } }).__bamboo;
      return bridge?.save?.days?.[args.today]?.arcadePlays === args.plays;
    },
    { today: TODAY, plays },
    { timeout: timeoutMs, polling: 50 },
  );
}

/**
 * 用深链跑完一局再回到游戏厅。
 * 注意：autoplay 开关只认路由上的 ?autoplay=1&instant=1（readDebugOptions 在挂载时读一次），
 * 所以这里必须带参深链，不能点卡片（点卡片打开的是真实玩法，等不到自动通关）。
 */
async function playOnceFromLobby(page: Page, gameId: string): Promise<void> {
  await page.goto('/#/arcade/' + gameId + '?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  expect(await waitEvent(page, 'arcade:complete:' + gameId, 40_000), gameId + ' 没有完成').toBe(true);
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
}

test('隐藏：没有完成四件小事时，小屋没有小门，直达游戏厅被送回小屋', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('home-arcade')).toHaveCount(0);

  await page.goto('/#/arcade');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('arcade-view')).toHaveCount(0);
});

test('解锁：完成第四件不同的小事 → 小门浮层 → 游戏厅三张卡', async ({ page }) => {
  await seedSave(page, { completed: ['brush', 'wash', 'feed'] });
  await expect(page.getByTestId('home-arcade')).toHaveCount(0);

  // 第四件：学习（autoplay 自动走完；与真实操作同一条逻辑）
  await page.goto('/#/play/learn?autoplay=1&instant=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('play-arcade-reveal')).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('play-arcade-go').click();
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  for (const id of ['popstar', 'bounce', 'tetris']) {
    await expect(page.getByTestId('arcade-card-' + id)).toBeVisible();
  }
  // 头部：普通模式显示今天还剩几局
  await expect(page.getByTestId('arcade-plays-left')).toBeVisible();
});

test('每日 21 局：seed 已满 21 局后卡片仍可见，但点卡片与深链都被拦在游戏厅', async ({ page }) => {
  await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'], arcadePlays: 21 });
  await page.goto('/#/arcade');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 30_000 });

  // 三张卡还在（不是把入口藏起来）
  for (const id of ['popstar', 'bounce', 'tetris']) {
    await expect(page.getByTestId('arcade-card-' + id)).toBeVisible();
  }

  // 点卡片：留在游戏厅，给一句「今天的 21 局玩完啦」
  await page.getByTestId('arcade-card-popstar').click();
  await expect(page.getByTestId('arcade-view')).toBeVisible();
  await expect(page.getByTestId('arcade-play-view')).toHaveCount(0);
  await expect(page.getByTestId('arcade-limit')).toBeVisible();

  // 深链进入：也被送回游戏厅，不会再开一局
  await page.goto('/#/arcade/bounce');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('arcade-play-view')).toHaveCount(0);
});

test('每日 21 局：seed 已玩 20 局 → 还能再玩一局变 21 局，下一局被拦', async ({ page }) => {
  await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'], arcadePlays: 20 });
  await page.goto('/#/arcade');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('arcade-plays-left')).toContainText('1');

  // 第 21 局：可以进去，跑完写档后今天变成 21 局
  await playOnceFromLobby(page, 'popstar');
  await waitPlaysToday(page, 21);
  await waitGamePlays(page, 'popstar', 1);

  // 第 22 局：留在游戏厅，给提示
  await page.getByTestId('arcade-card-tetris').click();
  await expect(page.getByTestId('arcade-view')).toBeVisible();
  await expect(page.getByTestId('arcade-limit')).toBeVisible();
  await expect(page.getByTestId('arcade-play-view')).toHaveCount(0);
});

test('隐藏触发：连点竹竹 7 次，当天小门直接打开、三款无限畅玩', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  // 一件小事都没做：小门本来不该出现
  await expect(page.getByTestId('home-arcade')).toHaveCount(0);

  const panda = page.getByTestId('home-panda');
  for (let tap = 0; tap < 7; tap += 1) {
    await panda.click();
  }
  await expect(page.getByTestId('home-secret')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('home-secret-go').click();

  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('arcade-unlimited')).toBeVisible();
  // 小门也开着了（不用先攒四件小事）
  await expect(page.getByTestId('arcade-card-popstar')).toBeVisible();

  // 同一款连玩两局：两局都要真的完成，总次数累计到 2（无限畅玩不受「每天几局」限制）
  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  expect(await waitEvent(page, 'arcade:complete:popstar', 40_000), '消灭星星没有完成').toBe(true);
  await waitGamePlays(page, 'popstar', 1);
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });

  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  expect(await waitEvent(page, 'arcade:complete:popstar', 40_000), '消灭星星没有完成').toBe(true);
  await waitGamePlays(page, 'popstar', 2);
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
});

test('无限畅玩：普通模式已满 21 局，触发竹林小路后仍能完成第 22 局', async ({ page }) => {
  await seedSave(page, {
    completed: ['brush', 'wash', 'feed', 'dress'],
    arcadePlays: 21,
    arcadeSecret: true,
  });
  await page.goto('/#/arcade');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('arcade-unlimited')).toBeVisible();

  // 无限畅玩不看 21 局上限：还能进，并且完整跑完第 22 局
  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  expect(await waitEvent(page, 'arcade:complete:popstar', 40_000), '消灭星星没有完成').toBe(true);
  await waitPlaysToday(page, 22);
  await waitGamePlays(page, 'popstar', 1);
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
});

test('无限畅玩：一局结束后自动接着下一局、不返回游戏厅，直到自己返回', async ({ page }) => {
  await seedSave(page, {
    completed: ['brush', 'wash', 'feed', 'dress'],
    arcadePlays: 0,
    arcadeSecret: true,
  });
  await page.goto('/#/arcade/popstar');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('arcade-unlimited')).toHaveCount(0); // 游戏厅才有的徽章，玩家页不该出现

  const playsToday = (): Promise<number> =>
    page.evaluate((today) => {
      const bridge = (window as unknown as { __bamboo?: { save?: BridgeSave } }).__bamboo;
      return bridge?.save?.days?.[today]?.arcadePlays ?? 0;
    }, TODAY);

  /** 真实点击棋盘，直到今天完成 target 局（消灭星星一局收满 24 颗即结束） */
  async function playUntil(target: number): Promise<void> {
    for (let i = 0; i < 120; i += 1) {
      const box = await page.getByTestId('arcade-host').boundingBox();
      if (box === null) break;
      const x = box.x + box.width * (0.2 + ((i * 37) % 7) / 10);
      const y = box.y + box.height * (0.25 + ((i * 53) % 8) / 20);
      await page.mouse.click(x, y);
      await page.waitForTimeout(160);
      if ((await playsToday()) >= target) return;
    }
    throw new Error('消灭星星在限定点击内没有完成第 ' + target + ' 局');
  }

  await playUntil(1);
  // 一局结束后不返回游戏厅，约 0.9 秒后自动续上下一局
  await expect(page.getByTestId('arcade-play-view')).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('arcade-play-view')).toBeVisible();
  await expect(page.getByTestId('arcade-view')).toHaveCount(0);

  await playUntil(2);
  await expect(page.getByTestId('arcade-play-view')).toBeVisible();
  await expect(page.getByTestId('arcade-view')).toHaveCount(0);

  // 孩子自己按返回：这时才回游戏厅
  await page.getByTestId('arcade-leave').click();
  await page.getByTestId('arcade-leave-exit').click();
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  expect(await playsToday()).toBe(2);
});

test('难度：跨天累计 4 局显示 Lv.3，再玩两局升到 Lv.4', async ({ page }) => {
  // 跨天记录：消灭星星累计玩过 4 局 → 1 + floor(4 / 2) = Lv.3（今天的局数仍是 0）
  await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'], plays: { popstar: 4 } });
  await page.goto('/#/arcade');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('arcade-level-popstar')).toContainText('Lv.3');
  await expect(page.getByTestId('arcade-level-bounce')).toContainText('Lv.1');

  // 第 5 局：4 → 5 局仍是 Lv.3（每 2 局升 1 级）
  await playOnceFromLobby(page, 'popstar');
  await waitGamePlays(page, 'popstar', 5);
  await expect(page.getByTestId('arcade-level-popstar')).toContainText('Lv.3');

  // 第 6 局：5 → 6 局升到 Lv.4
  await playOnceFromLobby(page, 'popstar');
  await waitGamePlays(page, 'popstar', 6);
  await expect(page.getByTestId('arcade-level-popstar')).toContainText('Lv.4');
});

for (const id of ['popstar', 'bounce', 'tetris'] as const) {
  test('小游戏 ' + id + '：autoplay 一局完成，并把成绩写进存档', async ({ page }) => {
    await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'] });
    await page.goto('/#/arcade/' + id + '?autoplay=1&instant=1');
    await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });

    expect(await waitEvent(page, 'arcade:complete:' + id, 40_000), id + ' 没有完成').toBe(true);
    await waitGamePlays(page, id, 1);
    await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  });
}

test('英文：游戏厅整页英文', async ({ page }) => {
  await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'] });
  await page.goto('/?lang=en#/arcade');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bamboo Arcade')).toBeVisible();
  await expect(page.getByTestId('arcade-card-popstar')).toContainText('Pop the Stars');
});