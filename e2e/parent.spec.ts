import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  enterParent,
  gotoPlay,
  lastError,
  longPress,
  passAdultGate,
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
 * 四条性质：
 * 1. 短按标题进不去（这是给家长的，不是给孩子误触的）；长按 3 秒只会弹出成人门，
 *    答对两位数加法才进家长页 —— 4–8 岁学会长按不算难，学会两位数加法就不一样了。
 * 2. 声音开关是"这台设备的偏好"，不是存档的一部分：刷新后仍记住（localStorage 'bamboo.muted'）。
 * 3. 清档更重：点一下 → 过成人门 → 再按住 3 秒，并且真的回到初始状态
 *    （竹笋回 3、任务完成数归零），更要确认清档后仍然能正常进游戏（存档写坏是这类功能最常见的坑）。
 * 4. 成人门连续输错 3 次会锁 30 秒。
 */

const parentView = (page: Page): Locator =>
  page.locator('[data-testid="parent-view"]:visible, [data-testid="parent"]:visible').first();

const muteButton = (page: Page): Locator =>
  page.locator('[data-testid="parent-mute"]:visible, [data-testid="parent-sound"]:visible').first();

const homeView = (page: Page): Locator => page.getByTestId('home-view');

test('家长门：短按标题不进，长按 3 秒 + 过成人门才能看得到本周概览', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });

  // 短按：不应该进家长页，也不应该叫出成人门（否则孩子一碰标题就弹出题目）
  await page.getByTestId('app-title').click();
  await page.waitForTimeout(600);
  await expect(parentView(page)).toBeHidden();
  await expect(page.getByTestId('adult-gate')).toHaveCount(0);

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

test('清档：点一下 → 过成人门 → 按住 3 秒清空存档，回小屋后竹笋回到初始值，之后还能正常玩', async ({ page }) => {
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

  // 清档是破坏性操作：点一下只会弹成人门，答对之后才开始 3 秒倒计时。
  // 这里不假设"过门即自动开始"还是"过门后还要再按住"：两种实现都按真实用户路径兼容，
  // 免得清档交互再调一次就把这条用例变成假红。
  const clear = page.getByTestId('parent-clear');
  await clear.click();
  await passAdultGate(page);
  const autoHolding = await expect(clear)
    .toHaveText(/继续按住|Keep holding/, { timeout: 1_500 })
    .then(() => true, () => false);
  if (!autoHolding) {
    // 另一种实现：过门后仍要家长自己按住 3 秒（按住期间的 pointerdown 只负责计时，不再弹门）
    await longPress(page, clear, 3200);
  }
  // 倒计时走真实时钟 + setInterval(80ms)，按钮在清档完成时变 disabled（标签变成"已清除"）
  await expect(clear).toBeDisabled({ timeout: 10_000 });
  // 长按清档完成后仍停在家长页，用存档快照等它真的写完
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

test('成人门：连续输错 3 次锁 30 秒，答不对就进不了家长页', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });

  // 长按只负责叫出题目；能不能进家长页由这道题决定
  await longPress(page, page.getByTestId('app-title'), 3200);
  const gate = page.getByTestId('adult-gate');
  await expect(gate).toBeVisible({ timeout: 15_000 });

  // 题目是两个 11–89 的两位数相加（最小 12 + 11 = 23），"1" 一定是错答案
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByTestId('adult-gate-key-1').click();
    await page.getByTestId('adult-gate-submit').click();
  }

  await expect(page.getByTestId('adult-gate-locked')).toBeVisible({ timeout: 10_000 });
  // 锁定期整块键盘都禁用：不是"只是提交按钮灰了"
  await expect(page.getByTestId('adult-gate-key-1')).toBeDisabled();
  await expect(page.getByTestId('adult-gate-submit')).toBeDisabled();
  await expect(parentView(page)).toBeHidden();
});

/**
 * 家长页门禁（会话级令牌）：
 * 家长页里放着「长按 3 秒清档」，而 #/parent 是一个可书写、可后退的地址 ——
 * 所以它不能只靠"入口藏得深"。真实规则是：
 * - 长按标题 + 过成人门才发令牌，进家长页；
 * - 一离开家长页令牌立刻吊销，浏览器后退键再回来必须被弹回小屋；
 * - 直接手输 / 分享 #/parent 同样进不去（没有令牌）。
 * 刷新仍停留在家长页是允许的（令牌在 sessionStorage 里），由上面的用例覆盖。
 */
test('家长门禁：回小屋后按浏览器后退，不能回到家长页；直链 #/parent 也回小屋', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  await enterParent(page);

  // 从家长页正常回小屋：这一步会吊销令牌
  await page.getByTestId('parent-back').click();
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });

  // 浏览器后退：历史里还有 #/parent，但没有令牌，必须被弹回小屋（或至少不再显示家长页）
  await page.goBack();
  await expect(parentView(page)).toBeHidden({ timeout: 15_000 });
  await expect(homeView(page)).toBeVisible({ timeout: 15_000 });

  // 直接输地址同样进不去
  await page.goto('/#/parent');
  await expect(parentView(page)).toBeHidden({ timeout: 15_000 });
  await expect(homeView(page)).toBeVisible({ timeout: 15_000 });
  expect(await lastError(page)).toBeUndefined();
});
