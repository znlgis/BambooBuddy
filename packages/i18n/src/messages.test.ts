import { describe, expect, it } from 'vitest';
import { createTranslator, fillTemplate, messages, zhCN } from './index';

describe('界面文案表', () => {
  it('每条文案都不是空串', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value.trim(), key).not.toHaveLength(0);
    }
  });

  it('只有一份语言表，键集与默认表一致', () => {
    for (const table of Object.values(messages)) {
      expect(Object.keys(table).sort()).toEqual(Object.keys(zhCN).sort());
    }
  });

  it('参数占位符能被替换，缺参数时保留原文而不是 undefined', () => {
    expect(fillTemplate('竹笋 +{n}', { n: 3 })).toBe('竹笋 +3');
    expect(fillTemplate('竹笋 +{n}', {})).toBe('竹笋 +{n}');
  });

  it('缺键回落到键名', () => {
    const tr = createTranslator('zh-CN');
    // @ts-expect-error 故意传一个不存在的键，验证兜底
    expect(tr('not.a.real.key')).toBe('not.a.real.key');
  });

  it('未知参数不会破坏文本', () => {
    expect(fillTemplate('连续 {n} 天', { n: 3, x: 1 })).toBe('连续 3 天');
  });
});
