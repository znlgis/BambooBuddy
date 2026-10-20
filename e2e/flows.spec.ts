import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { COMPLETE_LAYOUT, ORDER_LAYOUT, SCRUB_LAYOUT, TIDY_LAYOUT } from '@bamboo/templates/layout';
import type { Point, Rect } from '@bamboo/templates/layout';
import { loadLevel } from './content';
import type { OrderLevelData, ScrubLevelData, TidyLevelData } from './content';
import {
  clickDesign,
  dragDesign,
  events,
  moveDesign,
  toScreen,
  waitEvent,
  waitEventPrefix,
  waitPlayClosed,
  waitTaskComplete,
} from './shared';

/**
 * 真实指针操作的三条主链路：刷牙 / 整理 / 睡觉。
 *
 * 这里刻意**不带 ?autoplay=1**：autoplay 只证明"场景能自动走完"，
 * 证明不了孩子点得动。坐标全部来自 @bamboo/templates/layout 的布局常量
 * 与内容 JSON，不在用例里写魔法数字（布局改了只需要改一处，用例自动跟上）。
 */
const at = (stage: Rect, point: Point): Point => ({
  x: stage.x + point.x * stage.w,
  y: stage.y + point.y * stage.h,
});

/** 进入玩法，等场景真的开始（canvas 可见 + scene:enter 事件） */
async function enterGame(page: Page, id: 'brush' | 'tidy' | 'sleep'): Promise<void> {
  await page.goto('/#/play/' + id + '?instant=1');
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  expect(
    await waitEventPrefix(page, 'scene:enter:', 30_000),
    id + '：场景没有进入（?instant=1 应立即开始）',
  ).toBe(true);
}

/**
 * 收下完成卡片并回到外壳。
 *
 * 真实操作不会自动退出（只有 autoplay 会自动走）：完成卡片是 Phaser 里画的，
 * 没有 DOM testid，只能按 COMPLETE_LAYOUT 的设计坐标点「收下」。
 * 点之前等一下 popIn 动画，否则按钮的命中区域还在缩放中。
 */
async function acceptCompletion(page: Page): Promise<void> {
  await page.waitForTimeout(420);
  await clickDesign(page, COMPLETE_LAYOUT.accept.x, COMPLETE_LAYOUT.accept.y);
  await waitPlayClosed(page, 20_000);
}

test('刷牙：按住牙刷在牙齿区来回刷干净 6 处，再点冲水，task:complete', async ({ page }) => {
  const level = loadLevel('brush') as ScrubLevelData;
  await enterGame(page, 'brush');

  // 牙刷必须先"抓住"才有判定：场景只在 dragging 时把 pointermove 换算成刷洗
  // （scrub.ts 的 handleMove 有 grabbing 门槛）。所以整条刷牙是一条按住不放的手势，
  // 松手后工具弹回 toolHome，中途不能抬手。
  const toolHome = await toScreen(page, SCRUB_LAYOUT.toolHome.x, SCRUB_LAYOUT.toolHome.y);
  await page.mouse.move(toolHome.x, toolHome.y);
  await page.mouse.down();
  await page.waitForTimeout(120);

  // 每个点两轮"左 18px → 回到中心"：每步 18 设计像素，刚好越过场景 10px 的节流阈值，
  // 所以每一步都稳定记一下（scenes-a 实测过的真实指针路径）。步骤之间留 55ms，
  // 让 Phaser 把指针事件队列处理完 —— 一帧里连发多次 move 会被节流合并。
  for (const spot of level.spots) {
    const p = at(SCRUB_LAYOUT.stage, spot);
    for (let round = 0; round < level.rubs; round += 1) {
      await moveDesign(page, p.x - 18, p.y, 1);
      await page.waitForTimeout(55);
      await moveDesign(page, p.x, p.y, 1);
      await page.waitForTimeout(55);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  // 刷干净只是"该冲水了"：冲水之前绝不能自己结束（否则真实操作就退化成看动画）
  expect(await events(page), '还没冲水就完成了').not.toContain('task:complete:brush');

  const taps = level.finish?.taps ?? 0;
  expect(taps, '刷牙关卡应该要求冲水收尾').toBeGreaterThan(0);
  for (let i = 0; i < taps; i += 1) {
    // 刻意不点正中心：孩子会按到按钮的右下部分。命中区必须覆盖整颗按钮，
    // 而不是只有"中心点恰好落在命中区边界上"才算数。
    await clickDesign(page, SCRUB_LAYOUT.finish.x + 120, SCRUB_LAYOUT.finish.y + 30);
    await page.waitForTimeout(120);
  }

  await waitTaskComplete(page, 'brush', 20_000);
  await acceptCompletion(page);
});

test('整理：把玩具按类别拖进对应箱子，task:complete', async ({ page }) => {
  const level = loadLevel('tidy') as TidyLevelData;
  await enterGame(page, 'tidy');

  // 说明里写"至少 3 件"，那是覆盖下限；模板的完成条件是全部归位，所以全部拖完
  let index = 0;
  for (const item of level.items) {
    const bin = TIDY_LAYOUT.bins[item.kind];
    expect(bin, '布局里缺少 ' + item.kind + ' 箱子的坐标').toBeTruthy();
    await dragDesign(page, at(TIDY_LAYOUT.stage, item), bin);
    index += 1;
    await page.waitForTimeout(180);
    if (index === 3) {
      // 拖到第 3 件时还不到终点：防止"拖一件就算完成"的假阳性
      expect(await events(page), '只整理 3 件就完成了').not.toContain('task:complete:tidy');
    }
  }

  await waitTaskComplete(page, 'tidy', 20_000);
  await acceptCompletion(page);
});

test('睡觉：先点错一个只提示不结束，再按顺序点 4 个道具通关', async ({ page }) => {
  const level = loadLevel('sleep') as OrderLevelData;
  await enterGame(page, 'sleep');

  // 故意先点最后一步：应该出现 task:retry（温柔提示），但进度与结局都不受影响
  const wrongStep = level.steps[level.steps.length - 1];
  if (!wrongStep) throw new Error('睡觉关卡没有步骤');
  const wrong = ORDER_LAYOUT.steps.find((step) => step.id === wrongStep.id);
  if (!wrong) throw new Error('布局里缺少 ' + wrongStep.id + ' 的坐标');
  await clickDesign(page, wrong.x, wrong.y);
  expect(await waitEventPrefix(page, 'task:retry', 10_000), '点错应先给 task:retry 提示').toBe(true);
  expect(await events(page), '点错不该直接通关').not.toContain('task:complete:sleep');

  // 按内容 JSON 的顺序依次点：curtain → lamp → blanket → pat
  for (const step of level.steps) {
    const spot = ORDER_LAYOUT.steps.find((entry) => entry.id === step.id);
    if (!spot) throw new Error('布局里缺少 ' + step.id + ' 的坐标');
    await clickDesign(page, spot.x, spot.y);
    await page.waitForTimeout(220);
  }

  await waitTaskComplete(page, 'sleep', 20_000);
  await acceptCompletion(page);
});

/**
 * 回归：完成卡片的「收下」按钮，点右下 1/4 区域也必须生效。
 *
 * 之前的命中区是从 (-w/2, -h/2) 起算的 Rectangle，而 Phaser 的命中测试会再加上
 * Container 的 displayOrigin（= size/2），于是可点区域缩到左上 1/4；
 * 点正中时恰好压在边界上，表现为"点好几下才偶尔有反应"。
 * 孩子真实按的是按钮中心偏下的位置，这条用例盯的就是这个位置。
 */
test('完成卡片：点「收下」的右下区域也能离开这一局', async ({ page }) => {
  const level = loadLevel('sleep') as OrderLevelData;
  await enterGame(page, 'sleep');

  for (const step of level.steps) {
    const spot = ORDER_LAYOUT.steps.find((entry) => entry.id === step.id);
    if (!spot) throw new Error('布局里缺少 ' + step.id + ' 的坐标');
    await clickDesign(page, spot.x, spot.y);
    await page.waitForTimeout(220);
  }
  await waitTaskComplete(page, 'sleep', 20_000);

  // 等 popIn 结束，再点按钮右下区域（不是正中心）
  await page.waitForTimeout(420);
  await clickDesign(page, COMPLETE_LAYOUT.accept.x + 90, COMPLETE_LAYOUT.accept.y + 30);
  expect(
    await waitEvent(page, 'session:exit:complete', 8_000),
    '点「收下」的右下区域没有退出：命中区没有覆盖整颗按钮',
  ).toBe(true);
  await waitPlayClosed(page, 20_000);
});
