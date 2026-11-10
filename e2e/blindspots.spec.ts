import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSave, todayKey } from './seed';
import { enterParent, saveSnapshot } from './shared';

/**
 * 补盲用例（P2-3）：这三条路径以前只有单测或干脆没有覆盖，
 * 而它们恰好都是"错误时孩子/家长能直接看见"的地方。
 *
 * 1. 装扮解锁：竹笋要真的被扣掉、解锁要真的落进存档（经济不能被连点刷出钱）；
 * 2. 日记朗读：同一个按钮在"读"与"没读"之间切换 aria-pressed（读不完也必须能回来）；
 * 3. 家长页时长：days[今天].seconds 是游戏里真实采集的数据，家长页必须如实显示。
 *
 * 前置状态全部用 seedSave 播进去，不靠"先玩几关"凑；玩法链路由 brush/tidy/sleep 三条真实指针用例覆盖。
 */

/**
 * 浏览器里装一个 Web Speech 桩：speak() 只记录 utterance，不回调。
 *
 * 无头 Chromium 的语音引擎行为不稳定（有的版本没有语音包，onend 可能永远不来），
 * 但这条用例验证的是外壳按钮状态机，不是浏览器语音实现 —— 把"何时念完"变成用例可控，
 * 才能既断言"读的时候按钮是按下态"，又断言"念完会自己恢复"。
 */
async function installSpeechStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class Utterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }
    const synth = {
      speak: (utterance: unknown): void => {
        (window as unknown as { __bambooUtterance?: unknown }).__bambooUtterance = utterance;
      },
      cancel: (): void => undefined,
      resume: (): void => undefined,
      getVoices: (): unknown[] => [],
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  });
}

test('装扮：解锁扣竹笋并写进已解锁列表（不能点几下就白拿）', async ({ page }) => {
  // bib-star：6 根竹笋、阶段 1 就能解锁 —— 不依赖"先玩几天"的前置
  await seedSave(page, { pet: { shoots: 20 } });
  await page.goto('/#/dress');
  await expect(page.getByTestId('dress-view')).toBeVisible({ timeout: 20_000 });
  // 读档是异步的：等外壳真的把种子存档读进来，再点（否则可能点到"还没读档"的空档上）
  await expect
    .poll(async () => (await saveSnapshot(page))?.pet.shoots, {
      timeout: 10_000,
      message: '没有读到种子存档（pet.shoots 应为 20）',
    })
    .toBe(20);

  const action = page.getByTestId('dress-action-bib-star');
  await expect(action).toBeVisible();
  await action.click();

  // 扣费必须落在存档里（界面上的数字只是投影）：20 - 6 = 14
  await expect
    .poll(async () => (await saveSnapshot(page))?.pet.shoots, {
      timeout: 10_000,
      message: '解锁 bib-star 后竹笋应该从 20 扣到 14',
    })
    .toBe(14);
  expect((await saveSnapshot(page))?.pet.unlocked).toContain('bib-star');
});

test('日记：朗读按钮 aria-pressed 随朗读状态切换，念完回到未朗读', async ({ page }) => {
  await installSpeechStub(page);
  // 今天有两件小事，日记页才有内容可念（没有内容时按钮不做事，会把用例测成假绿）
  await seedSave(page, { days: { [todayKey()]: { completed: ['brush', 'wash'] } } });
  await page.goto('/#/diary');
  await expect(page.getByTestId('diary-view')).toBeVisible({ timeout: 20_000 });
  // 没有今天的小事时朗读按钮什么都不做（会把用例测成假绿），先等日记行出现
  await expect(page.getByTestId('diary-line-brush')).toBeVisible({ timeout: 20_000 });

  const play = page.getByTestId('diary-play');
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // 朗读结束：桩触发 onend，同一个按钮必须回到"未朗读"（契约：done 必须 resolve）
  await page.evaluate(() => {
    const utterance = (window as unknown as { __bambooUtterance?: { onend?: (() => void) | null } })
      .__bambooUtterance;
    utterance?.onend?.();
  });
  await expect(play).toHaveAttribute('aria-pressed', 'false');
});

test('家长页：今天 125 秒如实显示为 2 分钟（时长来自存档，不是估算）', async ({ page }) => {
  await seedSave(page, { days: { [todayKey()]: { completed: ['brush'], seconds: 125 } } });
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  // 等读档完成（家长页读的是同一份存档快照）
  await expect
    .poll(async () => (await saveSnapshot(page))?.days[todayKey()]?.seconds ?? 0, { timeout: 10_000 })
    .toBe(125);

  await enterParent(page);
  const today = page.getByTestId('parent-time');
  await expect(today).toBeVisible();
  // 125 秒 → Math.round(125 / 60) = 2 分钟；中英两种文案都接受，避免语言默认值变化误伤
  await expect(today).toContainText(/(今天玩了|Played)\s*2/);
  await expect(page.getByTestId('parent-time-week')).toContainText(/2/);
});
