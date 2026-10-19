import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  gotoPlay,
  lastError,
  longPress,
  readMuted,
  readShoots,
  saveSnapshot,
  waitEventPrefix,
  waitPlayClosed,
  waitTaskComplete,
} from './shared';

/**
 * 家长页（家长门）。
 *
 * 三条性质：
 * 1. 短按标题进不去（这是给家长的，不是给孩子误触的）；长按 3 秒才进。
 * 2. 声音开关是"这台设备的偏好"，不是存档的一部分：刷新后仍记住（localStorage 'bamboo.muted'）。
 * 3. 清档要长按 3 秒，并且真的回到初始状态（竹笋回 3、任务完成数归零），
 *    更要确认清档后仍然能正常进游戏（存档写坏是这类功能最常见的坑）。
 */

const parentView = (page: Page): Locator =>
  page.locator('[data-testid="parent-view"]:visible, [data-testid="parent"]:visible').first();

const muteButton = (page: Page): Locator =>
  page.locator('[data-testid="parent-mute"]:visible, [data-testid="parent-sound"]:visible').first();

const homeView = (page: Page): Locator => page.getByTestId('home-view');

async function enterParent(page: Page): Promise<void> {
  await longPress(page, page.getByTestId('app-title'), 3200);
  await expect(parentView(page)).toBeVisible({ timeout: 15_000 });
}

test('家长门：短按标题不进，长按 3 秒进入并看得到本周概览', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });

  // 短按：不应该进家长页（否则孩子一碰标题就出去了）
  await page.getByTestId('app-title').click();
  await page.waitForTimeout(600);
  await expect(parentView(page)).toBeHidden();

  await enterParent(page);
  await expect(page.getByTestId('parent-week')).toBeVisible();
  expect(await lastError(page)).toBeUndefined();
});

test('声音开关：切换后写进 localStorage，刷新仍然记得', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  const before = await readMuted(page);

  await enterParent(page);
  await muteButton(page).click();

  const first = await readMuted(page);
  expect(first, '声音开关应该把状态写进 bamboo.muted').toMatch(/^[01]$/);
  if (before !== null) expect(first, '点一下就应该翻转').not.toBe(before);

  // 刷新后仍停在家长页（hash 路由），开关状态必须还在
  await page.reload();
  await expect(parentView(page)).toBeVisible({ timeout: 20_000 });
  expect(await readMuted(page)).toBe(first);

  // 再切一次：两个方向都要记住，不能只是"第一次写死"
  await muteButton(page).click();
  const second = await readMuted(page);
  expect(second).toMatch(/^[01]$/);
  expect(second).not.toBe(first);

  await page.reload();
  await expect(parentView(page)).toBeVisible({ timeout: 20_000 });
  expect(await readMuted(page)).toBe(second);
});

test('清档：长按 3 秒清空存档，回小屋后竹笋回到初始值，之后还能正常玩', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  const initialShoots = await readShoots(page);
  expect(initialShoots).toBe(3);

  // 先赚一点竹笋：证明清档真的清掉了东西，而不是本来就是这个数
  await gotoPlay(page, 'brush', 'autoplay=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await waitTaskComplete(page, 'brush', 40_000);
  await waitEventPrefix(page, 'session:exit:', 20_000);
  await waitPlayClosed(page, 20_000);
  // 完成一局后外壳按设计回任务页（不是小屋）：先确认落点，再回小屋看竹笋
  await expect(page.getByTestId('tasks-view')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('nav-home').click();
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  expect(await readShoots(page), '完成一局后竹笋应该增加').toBeGreaterThan(initialShoots);

  await enterParent(page);
  await expect(page.getByTestId('parent-week')).toBeVisible();

  await longPress(page, page.getByTestId('parent-clear'), 3200);
  // 长按清档完成后仍停在家长页（只把按钮文案变成"已清除"），用存档快照等它真的写完
  await expect
    .poll(async () => {
      const current = await saveSnapshot(page);
      return (current?.tasks.brush.completions ?? 0) === 0 && current?.pet.shoots === initialShoots;
    }, { timeout: 10_000, message: '长按 3 秒后存档应该被清空' })
    .toBe(true);
  await page.getByTestId('parent-back').click();
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  expect(await readShoots(page)).toBe(initialShoots);

  const save = await saveSnapshot(page);
  expect(save?.pet.shoots).toBe(initialShoots);
  expect(save?.tasks.brush.completions).toBe(0);

  // 清档是把当前存档覆盖成空存档：刷新后不能又变回旧进度
  await page.reload();
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  expect(await readShoots(page)).toBe(initialShoots);

  // 清档后还要能玩（清空与"重新初始化"是两件事，后者容易漏）
  await gotoPlay(page, 'brush', 'autoplay=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await waitTaskComplete(page, 'brush', 40_000);
  await waitPlayClosed(page, 20_000);
  const replay = await saveSnapshot(page);
  expect(replay?.tasks.brush.completions ?? 0).toBeGreaterThanOrEqual(1);
});
