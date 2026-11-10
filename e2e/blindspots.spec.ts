import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSave, todayKey } from './seed';
import { enterParent, lastError, saveSnapshot } from './shared';

/**
 * 补盲用例（P2-3）：这三条路径以前只有单测或干脆没有覆盖，
 * 而它们恰好都是"错误时孩子/家长能直接看见"的地方。
 *
 * 1. 装扮解锁：竹笋要真的被扣掉、解锁要真的落进存档（经济不能被连点刷出钱）；
 * 2. 日记朗读：同一个按钮在"读"与"没读"之间切换 aria-pressed（读不完也必须能回来）；
 * 3. 家长页时长：days[今天].seconds 是游戏里真实采集的数据，家长页必须如实显示；
 * 4. 休息提醒：玩够 20 分钟 / 30 分钟的卡片真的出现、点过之后真的写进当天的日记录；
 * 5. 存档不可用：写档失败必须明说"这次可能没存上"，静默丢进度是最坏的结果。
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

test('休息提醒：玩够 20 分钟出现卡片，点过之后写进当天日记录、刷新不再出现', async ({ page }) => {
  // 1900 秒同时越过 20 分钟提醒线与 30 分钟收尾线：两张卡片都该出现
  await seedSave(page, { days: { [todayKey()]: { completed: ['brush'], seconds: 1900 } } });
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId('home-rest')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('home-rest-wrap')).toBeVisible();

  // 点「知道啦」：状态必须落进当天日记录，而不只是内存里收起来
  await page.getByTestId('home-rest-ok').click();
  await expect(page.getByTestId('home-rest')).toHaveCount(0);
  await expect
    .poll(async () => (await saveSnapshot(page))?.days[todayKey()]?.restDismissed, {
      timeout: 10_000,
      message: '点过 20 分钟提醒后 days[今天].restDismissed 应为 true',
    })
    .toBe(true);

  await page.getByTestId('home-rest-wrap-ok').click();
  await expect(page.getByTestId('home-rest-wrap')).toHaveCount(0);
  await expect
    .poll(async () => (await saveSnapshot(page))?.days[todayKey()]?.restWrapDismissed, {
      timeout: 10_000,
      message: '点过 30 分钟收尾卡片后 days[今天].restWrapDismissed 应为 true',
    })
    .toBe(true);

  // 刷新后同一天不再打扰（判断来自存档，不是内存里的 ref）
  await page.reload();
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('home-rest')).toHaveCount(0);
  await expect(page.getByTestId('home-rest-wrap')).toHaveCount(0);
  expect(await lastError(page)).toBeUndefined();
});

test('存档不可用：写档失败会明说「这次可能没存上」，不静默丢进度', async ({ page }) => {
  // 每次 indexedDB.open 都失败：等价于"存储被系统禁用 / 隐私模式"，但页面本身照常打开
  await page.addInitScript(() => {
    const factory = window.indexedDB;
    if (!factory) return;
    Object.defineProperty(factory, 'open', {
      configurable: true,
      value: () => {
        const request: Record<string, unknown> = {};
        setTimeout(() => (request.onerror as (() => void) | undefined)?.(), 0);
        return request;
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });

  // 摸一下竹竹：这条写档链路必须失败，而且失败要能被孩子/家长看见
  const pat = page.getByTestId('home-care-pat');
  await expect(pat).toBeEnabled();
  await pat.click();

  await expect(page.getByText(/这次可能没存上|may not have been saved/)).toBeVisible({
    timeout: 15_000,
  });
});

test('读档失败：首页明说「存档读取失败」，而不是静默当成新玩家', async ({ page }) => {
  // 存档读取那一步直接报错：这不是"没有存档"（新玩家），而是真的读不出来。
  // 平台层必须 reject 到这里，外壳才会给出提示、manager 才会拒绝写入（防止空档覆盖真实进度）。
  await page.addInitScript(() => {
    const realGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'kv' && query === 'save') throw new Error('模拟读档失败');
      return realGet.call(this, query);
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/存档读取失败|could not be read/i)).toBeVisible({ timeout: 15_000 });
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
