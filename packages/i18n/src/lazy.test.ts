import { describe, expect, it, vi } from 'vitest';

/**
 * 懒加载表的两条失败/时序语义：
 * 1. 取词器必须**每次现查表**：英文表与 surface 表都是 lazy chunk，
 *    若某处（Phaser 场景）在 chunk 到位前建好取词器并缓存，整局会停在中文/键名；
 * 2. ensureMessages 加载失败必须能返回 false（而不是"假装成功然后 resolve"），
 *    否则调用方会把语言切成 en 并持久化，用户下次打开仍是"假英文"；失败后要允许重试。
 *
 * 这个文件刻意**不**在 beforeAll 里预加载：模块首次求值时两份表都还没就位。
 */

describe('懒加载文案表：时序与失败语义', () => {
  it('中文 surface 表加载前取词器回落键名，加载完成后同一个取词器立即取到中文', async () => {
    const { createTranslator, ensureSurfaceMessages } = await import('./index');
    const tr = createTranslator('zh-CN');
    // 还没加载 surface chunk：回落键名（不是空白，也不是 undefined）
    expect(tr('dress.title')).toBe('dress.title');
    expect(await ensureSurfaceMessages()).toBe(true);
    // 关键：同一个取词器（创建于加载之前）现在必须能取到新文案
    expect(tr('dress.title')).toBe('竹竹的装扮');
    expect(tr('parent.title')).toBe('家长中心');
  });

  it('英文表加载前的取词器先出中文，ensureMessages 成功后同一个取词器立即出英文', async () => {
    const { createTranslator, ensureMessages } = await import('./index');
    const tr = createTranslator('en');
    expect(tr('app.title')).toBe('熊猫宝宝的一天');
    expect(await ensureMessages('en')).toBe(true);
    expect(tr('app.title')).toBe('Bamboo Buddy');
    expect(tr('home.shoots', { n: 2 })).toBe('Shoots 2');
  });

  it('ensureMessages 加载失败：返回 false、不把英文表标成就位、取词器回落中文，之后还能重试成功', async () => {
    vi.resetModules();
    vi.doMock('./en', () => {
      throw new Error('offline');
    });
    const broken = await import('./index');
    // 失败必须可感知：调用方据此不切语言
    await expect(broken.ensureMessages('en')).resolves.toBe(false);
    expect(broken.tableFor('en')).toBeNull();
    // 界面上仍是中文（而不是键名/空白）
    expect(broken.createTranslator('en')('app.title')).toBe('熊猫宝宝的一天');

    vi.doUnmock('./en');
    vi.resetModules();
    const retry = await import('./index');
    // 失败不是永久结论：下一次切语言还有机会成功
    await expect(retry.ensureMessages('en')).resolves.toBe(true);
    expect(retry.createTranslator('en')('app.title')).toBe('Bamboo Buddy');
    expect(retry.tableFor('en')?.['app.title']).toBe('Bamboo Buddy');
  });
});
