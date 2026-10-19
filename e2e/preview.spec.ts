import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TASK_IDS } from '../packages/content/src/ids';
import { gotoPlay } from './shared';

/**
 * 生产构建产物守卫：代码分割与懒加载。
 *
 * 为什么必须跑 dist 而不是 dev：dev server 一个文件一个请求，chunk 根本不存在，
 * "首屏不带 Phaser"这件事在 dev 下永远是绿的 —— 只有真实产物能证明它。
 *
 * 断言按 chunk 的**归属**写（文件名里的 game-<id> / vendor-phaser），不数条数：
 * 条数随打包策略变化，而"没进这个玩法就不许下载它"与策略无关。
 *
 * 本文件由 playwright.preview.config.ts 在 5191 上跑（pnpm e2e:dist）。
 * 主配置（pnpm e2e）也会收集到它 —— 那种情况下直接 skip，否则会拿 dev server 的
 * 请求去断言 /assets/ 产物，得到一堆毫无意义的红。
 */
const DIST = join(process.cwd(), 'apps/site/dist');
const ASSETS = join(DIST, 'assets');
const PREVIEW_PORT = '5191';

const isPreview = (baseURL: string | undefined): boolean =>
  baseURL !== undefined && baseURL.includes(':' + PREVIEW_PORT);

function assetFiles(): string[] {
  if (!existsSync(ASSETS)) {
    throw new Error('没有 ' + ASSETS + '：preview.spec 需要先 pnpm build（或 pnpm e2e:dist）');
  }
  return readdirSync(ASSETS);
}

function gameChunkOf(id: string): string | undefined {
  return assetFiles().find((name) => name.startsWith('game-' + id + '-') && name.endsWith('.js'));
}

const alpha = /\/assets\/(?:vendor-phaser|game)-[^/]+\.js$/;

test('产物结构：10 个玩法各有独立 chunk，首屏 index.html 一个都不引', async ({ baseURL }) => {
  test.skip(!isPreview(baseURL), 'preview.spec 只对 dist 产物跑（pnpm e2e:dist）');

  const chunks = new Set<string>();
  for (const id of TASK_IDS) {
    const name = gameChunkOf(id);
    expect(name, '缺少玩法 ' + id + ' 的独立 chunk（文件名应以 game-' + id + '- 开头）').toBeTruthy();
    chunks.add(name!);
  }
  expect(chunks.size, '10 个玩法不能共用一个 chunk').toBe(TASK_IDS.length);

  const phaser = assetFiles().find((name) => name.startsWith('vendor-phaser-') && name.endsWith('.js'));
  expect(phaser, 'Phaser 应该是独立的 vendor-phaser chunk').toBeTruthy();

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  for (const name of chunks) {
    expect(html, '首屏 index.html 不许引用玩法 chunk：' + name).not.toContain(name);
  }
  expect(html, '首屏 index.html 不许引用 Phaser').not.toContain(phaser!);
});

test('真实产物：首屏不下载重 chunk，进哪个玩法才下载哪个 chunk', async ({ page, baseURL }) => {
  test.skip(!isPreview(baseURL), 'preview.spec 只对 dist 产物跑（pnpm e2e:dist）');

  const heavy: string[] = [];
  const failed: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (alpha.test(path)) heavy.push(path);
  });
  page.on('requestfailed', (request) => {
    // 只换了 hash 的导航会取消在途请求，这不是加载失败
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    failed.push(request.url() + ' → ' + (request.failure()?.errorText ?? ''));
  });

  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 30_000 });
  expect(heavy, '首屏不该出现 Phaser / 玩法 chunk').toEqual([]);

  const visited: string[] = [];
  for (const id of TASK_IDS) {
    // 严格按顺序验证"还没进就不许下载"：新增/调换顺序也不能把懒加载偷偷变回全量
    expect(
      heavy.some((path) => path.includes('/game-' + id + '-')),
      '进入 ' + id + ' 之前就下载了它的 chunk',
    ).toBe(false);

    await gotoPlay(page, id, 'autoplay=1');
    await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => heavy.some((path) => path.includes('/game-' + id + '-')), { timeout: 20_000 })
      .toBe(true);

    if (visited.length === 0) {
      expect(
        heavy.some((path) => path.includes('/vendor-phaser-')),
        '进入第一个玩法时才应该加载 Phaser',
      ).toBe(true);
    }
    for (const other of TASK_IDS) {
      if (other === id || visited.includes(other)) continue;
      expect(
        heavy.some((path) => path.includes('/game-' + other + '-')),
        '还没进 ' + other + '，它的 chunk 就不该下载',
      ).toBe(false);
    }
    visited.push(id);
  }

  expect(failed, '产物里不该有加载失败的资源').toEqual([]);
});
