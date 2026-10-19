import { beforeAll, describe, expect, it } from 'vitest';
import { taskDetails, taskDetailsEn, findCjk } from './full';
import { getTaskSummary, loadTask, taskSummaries } from './index';
import { ensureSummaries } from './tasks';

beforeAll(async () => {
  await ensureSummaries('en');
});

describe('内容双语', () => {
  it('中英各 10 条，结构字段一致（id / emoji / 模板 / 收益）', () => {
    expect(taskDetailsEn).toHaveLength(taskDetails.length);
    for (const [index, zh] of taskDetails.entries()) {
      const en = taskDetailsEn[index]!;
      expect(en.id).toBe(zh.id);
      expect(en.emoji).toBe(zh.emoji);
      expect(en.template).toBe(zh.template);
      expect(en.stats).toEqual(zh.stats);
      expect(en.reward).toEqual(zh.reward);
      expect(en.timeSlots).toEqual(zh.timeSlots);
    }
  });

  it('英文标题与文案全部是英文，没有漏翻的中文', () => {
    for (const task of taskDetailsEn) {
      const leaks = findCjk({
        title: task.title,
        habit: task.habit,
        diary: task.diary,
        tip: task.tip,
        intro: task.intro,
        done: task.done,
        retry: task.retry,
        levelScript: task.levelScript,
      });
      expect(leaks, task.id).toEqual([]);
    }
  });

  it('英文关卡脚本里的可读文案也翻译了（睡觉 / 情绪 / 学习）', () => {
    const sleep = taskDetailsEn.find((task) => task.id === 'sleep')!;
    expect(JSON.stringify(sleep.levelScript)).toContain('Pull curtain');
    const emotion = taskDetailsEn.find((task) => task.id === 'emotion')!;
    expect(JSON.stringify(emotion.levelScript)).toContain('How does Bamboo feel now');
    const learn = taskDetailsEn.find((task) => task.id === 'learn')!;
    expect(JSON.stringify(learn.levelScript)).toContain('Which one is red');
  });

  it('英文摘要加载后，taskSummaries / getTaskSummary 返回英文', () => {
    const tasks = taskSummaries('en');
    expect(tasks.find((task) => task.id === 'brush')?.title).toBe('Brush Teeth');
    expect(getTaskSummary('brush', 'en')?.title).toBe('Brush Teeth');
    expect(getTaskSummary('brush')?.title).toBe('刷牙');
  });

  it('loadTask 按语言返回摘要 + 详情（英文关卡脚本）', async () => {
    const sleep = await loadTask('sleep', 'en');
    expect(sleep?.title).toBe('Bedtime');
    expect(sleep?.intro).toContain('dark');
    expect(JSON.stringify(sleep?.levelScript)).toContain('Tuck in');

    const zh = await loadTask('sleep', 'zh-CN');
    expect(zh?.title).toBe('睡觉');
    expect(JSON.stringify(zh?.levelScript)).toContain('盖被子');
  });
});
