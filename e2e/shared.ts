import type { Locator, Page, PlaywrightTestConfig } from '@playwright/test';
import type { SaveData } from '../packages/game-kit/src/contract';
import { TASK_IDS } from '../packages/content/src/ids';
import type { TaskId } from '../packages/content/src/ids';
import { DESIGN } from '@bamboo/templates/layout';

export { TASK_IDS };
export type { TaskId };

/**
 * 四份 Playwright 配置的共同基线（dev / preview；以后要加 shots、audit 也只 import 这里）。
 *
 * 为什么是"共享基线"而不是每份配置各写一份：以前 CHAGS 的 shots/audit 各抄一份，
 * 结果 audit 没截图没轨迹、expect.timeout 漏了 —— 出事时最难查的那两份恰好没有证据。
 * 证据策略、节奏、期望超时只在这里改一次；差异（testMatch / baseURL / webServer）
 * 留在各自的配置文件里，那些正是"这份配置为什么存在"。
 *
 * 注意：这里**不要**写 projects。main config 在 use 里放了 devices['Pixel 5']，
 * project 级的 use 会盖掉它（Playwright 的合并顺序），手机模拟就静默失效了。
 */
export const retries = process.env.CI ? 2 : 0;

/** 开发服务器：vite dev（apps/site 的 vite.config.ts 固定 5190） */
export const devBaseURL = 'http://127.0.0.1:5190';
export const previewBaseURL = 'http://127.0.0.1:5191';

export const devServer = {
  command: 'pnpm dev',
  url: devBaseURL,
  // 本地重复跑时复用已开着的 dev server；CI 上必须每次全新，避免旧产物污染体积/懒加载断言
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
} as const;

export const baseline = {
  testDir: './e2e',
  // 每条用例自己开 page/context；实测 2 个 worker 会放大长按/时序类断言的不稳定，
  // 而这里的用例大多数在等 Phaser 的 6 秒自动通关，串行反而更好定位问题
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 20_000 },
  reporter: [['list']] as const,
  use: {
    baseURL: devBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
} satisfies PlaywrightTestConfig;

/* ------------------------------------------------------------------ *
 * 调试桥（window.__bamboo）
 *
 * e2e 不读 DOM 结构去猜玩法进度：外壳在 DEV / webdriver 下把事件轨迹与存档快照
 * 挂到 window.__bamboo。事件是扁平字符串（'task:complete:brush'），
 * 这样断言不用关心 payload 类型，也不受 SaveData 迁移影响。
 * ------------------------------------------------------------------ */

export interface BambooDebugBridge {
  /** 按发生顺序累积的事件名，如 'session:start'、'task:complete:brush' */
  events: string[];
  /** 当前 SaveData 快照（每次变更后外壳同步成新对象） */
  save: SaveData;
  /** 页面级技术错误（有值说明游戏根本没起来） */
  lastError?: string;
}

interface BambooWindow {
  __bamboo?: BambooDebugBridge;
}

/** 事件轨迹（拷贝一份，避免后续变化影响已经取到的数组） */
export const events = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as unknown as BambooWindow).__bamboo?.events ?? []).slice());

/** 存档快照：任务完成数、竹笋、五维状态都从这里断言，不依赖界面文案 */
export const saveSnapshot = (page: Page): Promise<SaveData | null> =>
  page.evaluate(() => (window as unknown as BambooWindow).__bamboo?.save ?? null);

/** 页面上的技术错误（有就说明游戏没起来，报告里要带出来） */
export const lastError = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as BambooWindow).__bamboo?.lastError);

/**
 * 等某个事件名出现，返回是否等到。
 *
 * 为什么不用 expect.poll：轮询在 Node 侧，一次往返可能上百毫秒；像"刷牙来回刷"
 * 这种节奏游戏，几次 poll 的间隔就足以让场景自己推进过去。waitForFunction
 * 把轮询放进页面里（50ms 一次），往返只有一次，也就能读到真正的时间点。
 */
export async function waitEvent(page: Page, name: string, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (expected) => ((window as unknown as BambooWindow).__bamboo?.events ?? []).includes(expected),
      name,
      { timeout: timeoutMs, polling: 50 },
    );
    return true;
  } catch {
    return false;
  }
}

/** 等某前缀的事件（'task:retry' 带步骤后缀、'scene:enter' 带场景名，精确匹配会漏） */
export async function waitEventPrefix(page: Page, prefix: string, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (expected) =>
        ((window as unknown as BambooWindow).__bamboo?.events ?? []).some((event) =>
          event.startsWith(expected),
        ),
      prefix,
      { timeout: timeoutMs, polling: 50 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 等这一局通关，失败时把最近事件与 lastError 一起抛出来。
 *
 * 只丢一句 "timeout" 对多 agent 并行开发没有诊断价值：卡在哪一幕、场景有没有起来，
 * 全在这两样里。
 */
export async function waitTaskComplete(page: Page, id: TaskId, timeoutMs = 30_000): Promise<void> {
  const ok = await waitEvent(page, 'task:complete:' + id, timeoutMs);
  if (ok) return;
  const [seen, error] = await Promise.all([events(page), lastError(page)]);
  throw new Error(
    '没有等到 task:complete:' + id +
      '；最近事件：' + (seen.slice(-10).join(', ') || '(空)') +
      '；lastError：' + (error ?? '无'),
  );
}

/* ------------------------------------------------------------------ *
 * 设计坐标 → 屏幕坐标
 *
 * 游戏统一 750×1334（Scale.FIT + CENTER_BOTH）。这里做它的逆运算：
 * 内容 JSON 里的 0–1 坐标先按场景导出的 stage 矩形换算成设计坐标，
 * 再由 toScreen 换算成鼠标坐标。所有真实指针用例都走这条链路，
 * 不出现"魔法数字点这里"。
 * ------------------------------------------------------------------ */

/** 设计坐标 → 屏幕坐标（canvas 可能在页面里被 letterbox） */
export async function toScreen(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 20_000 });
  // boundingBox 偶尔会读到 0×0 / null：元素刚被替换、Phaser 正在重建 canvas，
  // 或者页面还在从 letterbox 过渡。给它 2 秒稳定下来，比"偶发找不到 canvas"好查得多。
  let box = await canvas.boundingBox();
  for (let attempt = 0; attempt < 20 && (!box || box.width < 10 || box.height < 10); attempt += 1) {
    await page.waitForTimeout(100);
    box = await canvas.boundingBox();
  }
  if (!box || box.width < 10 || box.height < 10) {
    throw new Error('canvas 尺寸异常（玩法没加载起来或正在重建）：' + JSON.stringify(box));
  }
  const scale = Math.min(box.width / DESIGN.width, box.height / DESIGN.height);
  const ox = box.x + (box.width - DESIGN.width * scale) / 2;
  const oy = box.y + (box.height - DESIGN.height * scale) / 2;
  return { x: ox + x * scale, y: oy + y * scale };
}

/** 点一下设计坐标 */
export async function clickDesign(page: Page, x: number, y: number): Promise<void> {
  const point = await toScreen(page, x, y);
  await page.mouse.click(point.x, point.y);
}

/** 真·拖拽：按下 → 分步移动 → 松手（Phaser 的 drag 依赖 pointermove 轨迹，一步跳到终点会丢） */
export async function dragDesign(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** 连点若干次（间隔可调）：刷牙、冲水、拍睡这类"点够次数"的玩法 */
export async function tapDesign(
  page: Page,
  x: number,
  y: number,
  times: number,
  gapMs = 130,
): Promise<void> {
  const p = await toScreen(page, x, y);
  for (let i = 0; i < times; i += 1) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(gapMs);
  }
}

/**
 * 按住状态下移动到设计坐标（不松手）。
 *
 * 刷洗类玩法的判定在 pointermove 上，而且有"移动够远才算一下"的节流：
 * 一步跳到终点只会被记成一下，必须分步移动才有"来回刷"的效果。
 */
export async function moveDesign(page: Page, x: number, y: number, steps = 8): Promise<void> {
  const point = await toScreen(page, x, y);
  await page.mouse.move(point.x, point.y, { steps });
}

/** 按住不放（家长页长按入口、需要持续按压的动作） */
export async function holdDesign(page: Page, x: number, y: number, ms: number): Promise<void> {
  const p = await toScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** DOM 元素长按（家长页入口 / 清档按钮是普通按钮，不是 canvas） */
export async function longPress(page: Page, locator: Locator, ms = 3200): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('长按目标不可见：' + (await locator.toString()));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/* ------------------------------------------------------------------ *
 * 路由与页面级小工具
 * ------------------------------------------------------------------ */

/**
 * 进入某个玩法。
 *
 * 开关挂在 hash 里（'/#/play/brush?autoplay=1'）：外壳的路由按 '?' 截断后
 * 再解析任务 id，readDebugOptions 同时认 search 与 hash query。
 * 这样分享链接更干净（不会出现 '/?autoplay=1#/play/brush'），刷新 hash 也会原样保留。
 */
export const gotoPlay = (page: Page, id: TaskId, query = 'autoplay=1'): Promise<unknown> =>
  page.goto('/#/play/' + id + (query ? '?' + query : ''));

/** 等这一局卸载（session:exit 之后外壳会离开 play 路由） */
export async function waitPlayClosed(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="play-view"]') === null,
    undefined,
    { timeout: timeoutMs },
  );
}

/** 回任务页（不猜路由字符串，点底栏；外壳换了路由名这条用例也不用改） */
export async function openTasks(page: Page): Promise<void> {
  await page.getByTestId('nav-tasks').click();
}

/** 读小屋里的竹笋数字（home-shoots 的文本里带数字） */
export async function readShoots(page: Page): Promise<number> {
  const text = (await page.getByTestId('home-shoots').textContent()) ?? '';
  const match = /\d+/.exec(text);
  if (!match) throw new Error('home-shoots 里读不到数字：' + text);
  return Number(match[0]);
}

/** 当前 localStorage 里的静音开关（'1' / '0'；没写过时返回 null） */
export const readMuted = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem('bamboo.muted'));

/** 清掉本地存档与静音开关：用例开始前需要"全新孩子"时用 */
export async function resetLocalState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('bamboobuddy');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}
