import { describe, expect, it } from 'vitest';
import { suggestForToday } from './parentSuggest';

describe('家长页的亲子建议', () => {
  it('今天什么都没做时不给建议（页面显示通用文案）', () => {
    expect(suggestForToday([])).toBeNull();
  });

  it('优先取今天最后一次完成的任务', () => {
    expect(suggestForToday(['brush', 'tidy'])).toBe('parent.suggest.tidy');
    expect(suggestForToday(['tidy', 'brush'])).toBe('parent.suggest.brush');
  });

  it('每个任务都能映射到一条建议（10 条全部有）', () => {
    const ids = ['brush', 'bath', 'feed', 'sleep', 'emotion', 'sport', 'wash', 'dress', 'tidy', 'learn'] as const;
    const seen = new Set<string>();
    for (const id of ids) {
      const key = suggestForToday([id]);
      expect(key, id).not.toBeNull();
      seen.add(key!);
    }
    expect(seen.size).toBe(ids.length);
  });

  it('不认识的任务 id 被忽略，不抛错', () => {
    expect(suggestForToday(['nope' as never, 'brush'])).toBe('parent.suggest.brush');
  });
});
