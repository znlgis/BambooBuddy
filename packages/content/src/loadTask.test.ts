import { describe, expect, it } from 'vitest';
import { TASK_IDS } from './ids';
import { loadTask, selectLevelScript, type VariantSource } from './loadTask';
import { taskDetails, taskDetailsEn } from './full';
import { findCjk, mergeTaskDetail } from './localize';
import { getTaskSummary } from './tasks';

/**
 * 关卡变体（P1-1）的回归测试：
 * - 选套必须确定性（同一天同一任务永远同一套，不碰 Math.random / Date.now）；
 * - 旧格式（只有 levelScript）原样可读；
 * - 10 条任务中英各 2 套，第二套必须真的不一样、英文变体不得残留中文。
 */

const dayKeyOf = (month: number, day: number): string =>
  '2026-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

/** 选中的是第几套：0 = 第 1 套，1 = 第 2 套（列表只含追加变体，所以下标要 +1） */
function pickedIndex(source: VariantSource, taskId: string, dayKey: string): number {
  const picked = selectLevelScript(source, taskId, { dayKey });
  if (picked === source.levelScript) return 0;
  const index = (source.variants ?? []).indexOf(picked);
  if (index < 0) throw new Error('选中的脚本既不是主脚本也不在 variants 里');
  return index + 1;
}

function detailOf(id: (typeof TASK_IDS)[number]) {
  const found = taskDetails.find((task) => task.id === id);
  if (!found) throw new Error('缺少任务内容：' + id);
  return found;
}

describe('selectLevelScript：确定性选套（纯函数）', () => {
  it('旧格式（只有一份 levelScript）永远返回同一份脚本（向后兼容）', () => {
    const oldFormat: VariantSource = { levelScript: { room: 'kitchen', foods: [] } };
    for (const day of ['2026-11-10', '2026-12-01', '2027-01-15']) {
      expect(selectLevelScript(oldFormat, 'feed', { dayKey: day })).toBe(oldFormat.levelScript);
    }
    expect(selectLevelScript(oldFormat, 'feed', { variantIndex: 99 })).toBe(oldFormat.levelScript);
    expect(selectLevelScript(oldFormat, 'feed')).toBe(oldFormat.levelScript);
  });

  it('显式下标：0/1 正常，越界取模回落，负数也回落', () => {
    const source: VariantSource = { levelScript: 'first', variants: ['second'] };
    expect(selectLevelScript(source, 'feed', { variantIndex: 0 })).toBe('first');
    expect(selectLevelScript(source, 'feed', { variantIndex: 1 })).toBe('second');
    expect(selectLevelScript(source, 'feed', { variantIndex: 2 })).toBe('first');
    expect(selectLevelScript(source, 'feed', { variantIndex: 99 })).toBe('second');
    expect(selectLevelScript(source, 'feed', { variantIndex: -1 })).toBe('second');
    expect(selectLevelScript(source, 'feed', { variantIndex: -3 })).toBe('second');
  });

  it('显式下标非法（小数 / NaN / Infinity）时不崩溃，回落 dayKey / 第 1 套', () => {
    const source: VariantSource = { levelScript: 'first', variants: ['second'] };
    expect(selectLevelScript(source, 'feed', { variantIndex: 1.5 })).toBe('first');
    expect(selectLevelScript(source, 'feed', { variantIndex: Number.NaN })).toBe('first');
    expect(selectLevelScript(source, 'feed', { variantIndex: Number.POSITIVE_INFINITY })).toBe('first');
  });

  it('没有变体的源永远第 1 套，不会出现负数下标', () => {
    const source: VariantSource = { levelScript: 'only' };
    expect(selectLevelScript(source, 'feed', { dayKey: '2026-11-10' })).toBe('only');
    expect(selectLevelScript(source, 'feed', { variantIndex: -5 })).toBe('only');
    expect(selectLevelScript(source, 'feed')).toBe('only');
  });

  it('同日同任务稳定，不同日会换套，taskId 参与种子', () => {
    for (const taskId of TASK_IDS) {
      const source: VariantSource = { levelScript: 'A', variants: ['B'] };
      expect(pickedIndex(source, taskId, '2026-11-10')).toBe(pickedIndex(source, taskId, '2026-11-10'));
      const seen = new Set<number>();
      for (let day = 1; day <= 30; day += 1) {
        seen.add(pickedIndex(source, taskId, dayKeyOf(11, day)));
      }
      expect([...seen].sort(), taskId).toEqual([0, 1]);
    }
    // 10 条任务里两套都会出现（否则等于按天统一变，不是"每条任务自己的变体"）
    const source: VariantSource = { levelScript: 'A', variants: ['B'] };
    const indexes = new Set(TASK_IDS.map((taskId) => pickedIndex(source, taskId, '2026-11-10')));
    expect([...indexes].sort()).toEqual([0, 1]);
  });

  it('空白 dayKey 当作没传，选第 1 套', () => {
    const source: VariantSource = { levelScript: 'A', variants: ['B'] };
    expect(selectLevelScript(source, 'sleep', { dayKey: '   ' })).toBe('A');
    expect(selectLevelScript(source, 'sleep', {})).toBe('A');
  });
});

describe('内容层：10 条任务中英各 2 套', () => {
  it('中文内容每条都有 1 份主脚本 + 1 份追加变体', () => {
    expect(taskDetails).toHaveLength(TASK_IDS.length);
    for (const task of taskDetails) {
      expect(1 + (task.variants?.length ?? 0), task.id).toBe(2);
    }
  });

  it('英文内容每条也有 2 套，且中英套数一致', () => {
    expect(taskDetailsEn).toHaveLength(TASK_IDS.length);
    for (const task of taskDetailsEn) {
      expect(1 + (task.variants?.length ?? 0), task.id).toBe(2);
      expect(task.variants?.length, task.id).toBe(detailOf(task.id).variants?.length);
    }
  });

  it('第二套与第一套不完全相同（点位 / 食物 / 顺序 / 题目）', () => {
    for (const [locale, details] of [['zh-CN', taskDetails], ['en', taskDetailsEn]] as const) {
      for (const task of details) {
        const variant = task.variants?.[0];
        expect(variant, locale + '/' + task.id).toBeDefined();
        expect(JSON.stringify(variant), locale + '/' + task.id).not.toBe(
          JSON.stringify(task.levelScript),
        );
      }
    }
  });

  it('英文变体里没有中文（漏翻守卫）', () => {
    for (const task of taskDetailsEn) {
      expect(findCjk(task.levelScript), task.id).toEqual([]);
      for (const [index, variant] of (task.variants ?? []).entries()) {
        expect(findCjk(variant), task.id + ' 第' + (index + 2) + '套').toEqual([]);
      }
    }
  });
});

describe('loadTask：选中的那套写回 levelScript', () => {
  it('不传第三参时与旧版一致：永远第 1 套', async () => {
    for (const taskId of TASK_IDS) {
      const loaded = await loadTask(taskId, 'zh-CN');
      expect(loaded?.levelScript, taskId).toEqual(detailOf(taskId).levelScript);
      expect(loaded?.levelScript, taskId).toBe(detailOf(taskId).levelScript);
    }
  });

  it('显式 variantIndex 选中第二套，越界按取模回落', async () => {
    const detail = detailOf('sleep');
    const second = await loadTask('sleep', 'zh-CN', { variantIndex: 1 });
    expect(second?.levelScript).toEqual(detail.variants?.[0]);
    const wrapped = await loadTask('sleep', 'zh-CN', { variantIndex: 3 });
    expect(wrapped?.levelScript).toEqual(detail.variants?.[0]);
    const first = await loadTask('sleep', 'zh-CN', { variantIndex: 2 });
    expect(first?.levelScript).toBe(detail.levelScript);
  });

  it('按 dayKey 选择：同一天稳定，且结果一定是两套之一', async () => {
    const detail = detailOf('brush');
    const a = await loadTask('brush', 'zh-CN', { dayKey: '2026-11-10' });
    const b = await loadTask('brush', 'zh-CN', { dayKey: '2026-11-10' });
    expect(a?.levelScript).toEqual(b?.levelScript);
    const options = [detail.levelScript, detail.variants?.[0]];
    expect(options).toContainEqual(a?.levelScript);
  });

  it('英文按日期选到第 2 套时，关卡文案也是英文', async () => {
    let day: string | null = null;
    for (let index = 1; index <= 28; index += 1) {
      const key = dayKeyOf(12, index);
      const loaded = await loadTask('sleep', 'en', { dayKey: key });
      if (JSON.stringify(loaded?.levelScript).includes('Hug teddy')) {
        day = key;
        break;
      }
    }
    expect(day, '12 月里应该有一天会选到第 2 套').not.toBeNull();
    const loaded = await loadTask('sleep', 'en', { dayKey: day ?? undefined });
    expect(JSON.stringify(loaded?.levelScript)).toContain('Hug teddy');
    expect(findCjk(loaded?.levelScript)).toEqual([]);
  });

  it('英文补丁没给 variants 时回落到中文变体（content:check 会拦住漏翻）', () => {
    const summary = getTaskSummary('sleep');
    if (!summary) throw new Error('缺少 sleep 摘要');
    const extra = {
      intro: '中文引导',
      done: '中文夸奖',
      retry: '中文提示',
      levelScript: 'zh-primary',
      variants: ['zh-second'],
    };
    const oldPatch = { intro: 'Intro', done: 'Done', retry: 'Retry', levelScript: 'en-primary' };
    expect(mergeTaskDetail(summary, extra, oldPatch).variants).toEqual(['zh-second']);
    const fullPatch = { ...oldPatch, variants: ['en-second'] };
    expect(mergeTaskDetail(summary, extra, fullPatch).variants).toEqual(['en-second']);
    // 旧格式（双方都没有 variants）：合并结果也没有这个字段，读起来与以前一样
    const oldExtra = { intro: '中文引导', done: '中文夸奖', retry: '中文提示', levelScript: 'zh-primary' };
    expect(mergeTaskDetail(summary, oldExtra, undefined).variants).toBeUndefined();
  });
});
