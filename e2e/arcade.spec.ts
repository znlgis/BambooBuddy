import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitEvent } from './shared';

/**
 * 隐藏小游戏（竹林小门）的三条主链路：
 * 1. 隐藏：没完成四件小事时，小屋没有小门，直达 #/arcade 会被送回小屋；
 * 2. 解锁：完成第四件不同的小事 → 结算浮层出现小门 → 进游戏厅；
 * 3. 每天每款一次：玩过之后卡片变「今天玩过啦」，再点与深链都被拦。
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
  /** 今天已经玩过的小游戏 */
  arcade?: string[];
  /** 跨天成绩（id → 玩过几次） */
  plays?: Record<string, number>;
}

/** 把一份最小存档写进 IndexedDB 再刷新：migrate 会给缺的字段兜底，所以只写用得到的部分 */
async function seedSave(page: Page, options: SeedOptions): Promise<void> {
  const arcade: Record<string, { best: number; plays: number; lastPlayedDay: string }> = {};
  for (const [id, plays] of Object.entries(options.plays ?? {})) {
    arcade[id] = { best: 10, plays, lastPlayedDay: TODAY };
  }
  const save = {
    schemaVersion: 2,
    updatedAt: Date.now(),
    pet: {},
    tasks: {},
    arcade,
    days: {
      [TODAY]: {
        date: TODAY,
        completed: options.completed,
        arcade: options.arcade ?? [],
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
});

test('每天每款一次：玩过之后变成「今天玩过啦」，再点与深链都被拦', async ({ page }) => {
  await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'] });
  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });

  expect(await waitEvent(page, 'arcade:complete:popstar', 40_000), '消灭星星没有完成').toBe(true);
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('arcade-played-popstar')).toBeVisible();

  // 再点一次：留在游戏厅，并给一句「今天玩过啦」
  await page.getByTestId('arcade-card-popstar').click();
  await expect(page.getByTestId('arcade-view')).toBeVisible();

  // 深链进入：也被送回游戏厅，不会再开一局
  await page.goto('/#/arcade/popstar');
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
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

  // 同一款连玩两局：两局都要真的完成，总次数累计到 2
  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const bridge = (window as unknown as { __bamboo?: { save?: { arcade?: Record<string, { plays?: number }> } } }).__bamboo;
      return bridge?.save?.arcade?.popstar?.plays === 1;
    },
    undefined,
    { timeout: 40_000 },
  );
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });

  await page.goto('/#/arcade/popstar?autoplay=1&instant=1');
  await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const bridge = (window as unknown as { __bamboo?: { save?: { arcade?: Record<string, { plays?: number }> } } }).__bamboo;
      return bridge?.save?.arcade?.popstar?.plays === 2;
    },
    undefined,
    { timeout: 40_000 },
  );
  await expect(page.getByTestId('arcade-view')).toBeVisible({ timeout: 20_000 });
});

for (const id of ['popstar', 'bounce', 'tetris'] as const) {
  test('小游戏 ' + id + '：autoplay 一局完成，并把成绩写进存档', async ({ page }) => {
    await seedSave(page, { completed: ['brush', 'wash', 'feed', 'dress'] });
    await page.goto('/#/arcade/' + id + '?autoplay=1&instant=1');
    await expect(page.getByTestId('arcade-play-view')).toBeVisible({ timeout: 30_000 });

    expect(await waitEvent(page, 'arcade:complete:' + id, 40_000), id + ' 没有完成').toBe(true);
    await page.waitForFunction(
      (gameId) => {
        const bridge = (window as unknown as { __bamboo?: { save?: { arcade?: Record<string, { plays?: number; best?: number }> } } }).__bamboo;
        return (bridge?.save?.arcade?.[gameId]?.plays ?? 0) === 1;
      },
      id,
      { timeout: 15_000 },
    );
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
