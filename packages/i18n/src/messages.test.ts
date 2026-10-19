import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTranslator,
  ensureMessages,
  fillTemplate,
  localeFromSearch,
  messages,
  zhCN,
} from './index';

const CJK = /[\u4e00-\u9fff]/;

beforeAll(async () => {
  await ensureMessages('en');
});

describe('界面文案表', () => {
  it('中英两份表的键集完全一致（类型之外再用运行期守一道）', () => {
    expect(Object.keys(messages.en!).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('每条文案都不是空串', () => {
    for (const table of Object.values(messages)) {
      if (!table) continue;
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), key).not.toHaveLength(0);
      }
    }
  });

  it('英文表里没有漏翻的中文（locale.switch 是“切回中文”的按钮，例外）', () => {
    for (const [key, value] of Object.entries(messages.en!)) {
      if (key === 'locale.switch') continue;
      expect(CJK.test(value), key + ' = ' + value).toBe(false);
    }
  });

  it('英文不是中文的复制粘贴（抽样）', () => {
    expect(messages.en!['app.title']).not.toBe(zhCN['app.title']);
    expect(messages.en!['tasks.start']).not.toBe(zhCN['tasks.start']);
    expect(messages.en!['hint.brush']).not.toBe(zhCN['hint.brush']);
  });

  it('参数占位符能被替换，缺参数时保留原文而不是 undefined', () => {
    expect(fillTemplate('竹笋 +{n}', { n: 3 })).toBe('竹笋 +3');
    expect(fillTemplate('竹笋 +{n}', {})).toBe('竹笋 +{n}');
  });

  it('英文取词器返回英文', () => {
    const tr = createTranslator('en');
    expect(tr('app.title')).toBe('Bamboo Buddy');
    expect(tr('app.subtitle')).toBe('A Panda’s Day');
    expect(tr('home.shoots', { n: 2 })).toBe('Shoots 2');
  });

  it('缺键回落到键名', () => {
    const tr = createTranslator('zh-CN');
    // @ts-expect-error 故意传一个不存在的键，验证兜底
    expect(tr('not.a.real.key')).toBe('not.a.real.key');
  });

  it('?lang= 解析中英文', () => {
    expect(localeFromSearch('?lang=en')).toBe('en');
    expect(localeFromSearch('?lang=en-US')).toBe('en');
    expect(localeFromSearch('?lang=zh')).toBe('zh-CN');
    expect(localeFromSearch('?lang=zh-TW')).toBe('zh-CN');
    expect(localeFromSearch('?lang=fr')).toBeNull();
    expect(localeFromSearch('')).toBeNull();
  });
});
