import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  TASK_IDS,
  events,
  gotoPlay,
  lastError,
  openTasks,
  saveSnapshot,
  waitEventPrefix,
  waitPlayClosed,
  waitTaskComplete,
} from './shared';
import type { TaskId } from './shared';

const homeView = (page: Page) => page.getByTestId('home-view');

/**
 * 任务卡上的"完成标记"。
 *
 * 两种实现都认：task-done-<id> 是专门的勾，task-stars-<id> 是星级文案。
 * 只认一种的话，外壳换个展示方式就会红一片假失败；但也不能只判"元素存在"——
 * 星级元素在所有卡片上都有，必须里面真的出现了 1–3 或星形字符。
 */
async function expectTaskDone(page: Page, id: TaskId): Promise<void> {
  const done = page.getByTestId('task-done-' + id);
  const stars = page.getByTestId('task-stars-' + id);
  await expect
    .poll(
      async () => {
        if ((await done.count()) > 0 && (await done.isVisible())) return true;
        if ((await stars.count()) === 0) return false;
        const text = (await stars.textContent()) ?? '';
        return /[1-3]/.test(text) || /[★⭐]/.test(text);
      },
      { timeout: 10_000, message: '任务 ' + id + ' 的卡片上应该出现完成标记' },
    )
    .toBe(true);
}

/**
 * autoplay 打完一局并等外壳收尾。
 *
 * 只等 task:complete 不够：外壳还要写存档、发奖励、卸载 PlayView。
 * 先等 session:exit（场景确认退出），再等 play-view 消失，才去读存档 ——
 * 否则会读到完成前的那份快照，出现"偶发少 1 次完成"的假失败。
 */
async function playAutoplayToEnd(page: Page, id: TaskId): Promise<void> {
  await gotoPlay(page, id, 'autoplay=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await waitTaskComplete(page, id, 40_000);
  await waitEventPrefix(page, 'session:exit:', 20_000);
  await waitPlayClosed(page, 20_000);
}

test('首页：竹竹在，底部三个标签与日记入口都能进', async ({ page }) => {
  await page.goto('/');
  await expect(homeView(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('home-panda')).toBeVisible();
  expect(await lastError(page), '首屏不该有技术错误').toBeUndefined();

  await page.getByTestId('nav-tasks').click();
  await expect(page.getByTestId('tasks-view')).toBeVisible();

  await page.getByTestId('nav-home').click();
  await expect(homeView(page)).toBeVisible();

  await page.getByTestId('nav-dress').click();
  await expect(page.getByTestId('dress-view')).toBeVisible();

  await page.getByTestId('nav-home').click();
  await expect(homeView(page)).toBeVisible();

  // 日记入口同时兼容两种 testid：底栏的 nav-diary，或小屋里的 diary 别名
  await page.locator('[data-testid="nav-diary"]:visible, [data-testid="diary"]:visible').first().click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
});

// 数据驱动：任务清单来自 @bamboo/content/ids 的 TASK_IDS，新增/改名都不用手改用例。
// 每个任务一条用例（而不是循环塞进一条）：挂在哪一个玩法一眼就能看出来。
for (const id of TASK_IDS) {
  test('玩法 · ' + id + '：autoplay 能通关，任务卡打勾，存档计数增加', async ({ page }) => {
    await playAutoplayToEnd(page, id);

    const save = await saveSnapshot(page);
    expect(save?.tasks[id].completions ?? 0, '存档里 ' + id + ' 的完成次数应该 ≥1').toBeGreaterThanOrEqual(1);
    expect(save?.tasks[id].stars ?? 0, '通关至少给 1 颗星').toBeGreaterThanOrEqual(1);

    await openTasks(page);
    await expect(page.getByTestId('task-card-' + id)).toBeVisible();
    await expectTaskDone(page, id);
  });
}

test('刷新后进度还在：任务卡完成标记与存档都保留', async ({ page }) => {
  await playAutoplayToEnd(page, 'brush');

  const before = await saveSnapshot(page);
  expect(before?.tasks.brush.completions ?? 0).toBeGreaterThanOrEqual(1);

  await openTasks(page);
  await expectTaskDone(page, 'brush');

  // hash 路由 + IndexedDB：刷新后仍停在任务页，进度必须还在
  await page.reload();
  await expect(page.getByTestId('tasks-view')).toBeVisible({ timeout: 30_000 });

  const after = await saveSnapshot(page);
  expect(after?.tasks.brush.completions).toBe(before?.tasks.brush.completions);
  expect(after?.tasks.brush.stars).toBe(before?.tasks.brush.stars);
  expect(await lastError(page), '刷新后不该有技术错误').toBeUndefined();

  await expectTaskDone(page, 'brush');
  // events 是本次页面加载的新数组：刷新后不该再看到上一局的事件（脏状态会误导后续断言）
  expect(await events(page)).not.toContain('task:complete:brush');

  // 再进一次仍然能玩（存档写入失败过以后，PlayView 可能永远停在加载态）
  await playAutoplayToEnd(page, 'brush');
  const again = await saveSnapshot(page);
  expect(again?.tasks.brush.completions ?? 0).toBeGreaterThan(before?.tasks.brush.completions ?? 0);
});
