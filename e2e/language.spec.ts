import { expect, test } from '@playwright/test';
import { waitTaskComplete } from './shared';

/**
 * 中英文切换的端到端：
 * 英文游戏名 / 副标题 / 角色名 / 任务标题与时长单位都跟着切，
 * 刷新与重新打开链接后保持上次选择；再切回中文也立刻生效。
 */
test('英文界面：标题、副标题、角色名与任务内容都切换，刷新后仍记得', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('app-title')).toContainText('Bamboo Buddy');
  await expect(page.getByTestId('app-title')).toContainText('A Panda’s Day');
  // 角色名：小屋阶段徽章写着 "Bamboo now · Panda Cub"
  await expect(page.getByTestId('home-stage')).toContainText('Bamboo');
  expect(await page.title()).toBe('Bamboo Buddy');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

  await page.getByTestId('nav-tasks').click();
  await expect(page.getByTestId('task-card-brush')).toContainText('Brush Teeth');
  await expect(page.getByTestId('task-card-brush')).toContainText('45 sec');

  // 选择写进 localStorage：直接刷新仍然英文
  expect(await page.evaluate(() => localStorage.getItem('bamboo.locale'))).toBe('en');
  await page.reload();
  await expect(page.getByTestId('task-card-brush')).toContainText('Brush Teeth');

  // 点语言按钮切回中文，标题与内容立即跟着变
  await page.getByTestId('nav-lang').click();
  await expect(page.getByTestId('task-card-brush')).toContainText('刷牙');
  expect(await page.title()).toBe('熊猫宝宝的一天');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');
});

test('英文玩法：内容为英文，完成事件与存档照常', async ({ page }) => {
  await page.goto('/?lang=en#/play/sleep?autoplay=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await waitTaskComplete(page, 'sleep', 40_000);

  const save = await page.evaluate(() => window.__bamboo?.save ?? null);
  expect(save?.tasks.sleep.completions ?? 0).toBeGreaterThanOrEqual(1);
  // 英文会话里标题也应是英文
  expect(await page.title()).toBe('Bamboo Buddy');
});
