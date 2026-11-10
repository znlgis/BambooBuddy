import { describe, expect, it, vi } from 'vitest';

/**
 * 英文摘要补丁是 lazy chunk：ensureSummaries 的返回值要能区分
 * 「英文已就位」与「加载失败、先看中文」—— 与 @bamboo/i18n 的 ensureMessages 同一口径。
 * content:check 只能在构建期拦住漏翻，运行期的失败路径（离线 / chunk 被清）必须自己兜住。
 */

describe('ensureSummaries：英文摘要的懒加载与失败语义', () => {
  it('成功：返回 true，英文标题与中文不同，中文表不受影响', async () => {
    vi.resetModules();
    const fresh = await import('./tasks');
    await expect(fresh.ensureSummaries('en')).resolves.toBe(true);
    const en = fresh.taskSummaries('en');
    const zh = fresh.taskSummaries('zh-CN');
    expect(en).toHaveLength(zh.length);
    expect(en[0]?.title).not.toBe(zh[0]?.title);
    expect(fresh.getTaskSummary('brush', 'en')?.title).toBe(en[0]?.title);
    // 再调用一次不会重复加载，立即 true
    await expect(fresh.ensureSummaries('en')).resolves.toBe(true);
    // 中文请求永远立即成功（常驻表，不需要 chunk）
    await expect(fresh.ensureSummaries('zh-CN')).resolves.toBe(true);
  });

  it('失败：返回 false、英文表回落到中文，下次调用还能重试成功', async () => {
    vi.resetModules();
    vi.doMock('./i18n/en/summaries', () => {
      throw new Error('offline');
    });
    const broken = await import('./tasks');
    await expect(broken.ensureSummaries('en')).resolves.toBe(false);
    // 界面不白屏：英文请求回落中文标题（而不是 undefined / 键名）
    expect(broken.taskSummaries('en')[0]?.title).toBe(broken.taskSummaries('zh-CN')[0]?.title);

    vi.doUnmock('./i18n/en/summaries');
    vi.resetModules();
    const retry = await import('./tasks');
    // 失败不是永久结论：下一次切语言还有机会成功
    await expect(retry.ensureSummaries('en')).resolves.toBe(true);
    expect(retry.taskSummaries('en')[0]?.title).not.toBe(retry.taskSummaries('zh-CN')[0]?.title);
  });
});
