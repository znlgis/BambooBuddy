import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTranslator,
  ensureMessages,
  ensureSurfaceMessages,
  fillTemplate,
  localeFromSearch,
  messages,
  tableFor,
  zhCN,
} from './index';
import type { MessageParams } from './messages';

const CJK = /[\u4e00-\u9fff]/;

beforeAll(async () => {
  await Promise.all([ensureMessages('en'), ensureSurfaceMessages()]);
});

/** 中文整表 = 常驻首屏的核心表 + 懒加载页面的 surface 表 */
function mergedZh(): Record<string, string> {
  const table = tableFor('zh-CN');
  if (table === null) throw new Error('中文表不可用');
  return table;
}

describe('界面文案表', () => {
  it('中英两份表的键集完全一致（类型之外再用运行期守一道）', () => {
    expect(Object.keys(messages.en!).sort()).toEqual(Object.keys(mergedZh()).sort());
  });

  it('核心表 + surface 表合起来覆盖全部中文键（拆表不许丢键）', () => {
    for (const [key, value] of Object.entries(mergedZh())) {
      expect(typeof value, key).toBe('string');
    }
    // 核心表确实比整表小：否则拆表没有意义
    expect(Object.keys(zhCN).length).toBeLessThan(Object.keys(mergedZh()).length);
  });

  it('每条文案都不是空串', () => {
    for (const [key, value] of Object.entries(mergedZh())) {
      expect(value.trim(), key).not.toHaveLength(0);
    }
    for (const [key, value] of Object.entries(messages.en!)) {
      expect(value.trim(), key).not.toHaveLength(0);
    }
  });

  it('英文表里没有漏翻的中文（locale.switch 是“切回中文”的按钮，例外）', () => {
    for (const [key, value] of Object.entries(messages.en!)) {
      if (key === 'locale.switch') continue;
      expect(CJK.test(value), key + ' = ' + value).toBe(false);
    }
  });

  it('英文不是中文的复制粘贴（抽样）', () => {
    expect(messages.en!['app.title']).not.toBe(mergedZh()['app.title']);
    expect(messages.en!['tasks.start']).not.toBe(mergedZh()['tasks.start']);
    expect(messages.en!['hint.brush']).not.toBe(mergedZh()['hint.brush']);
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

  it('参数里出现 undefined / null 时保留占位符，不渲染出字面量 undefined', () => {
    // 运行期可能来自残缺 JSON / 可选字段：类型上是 string | number，这里故意越界验证兜底
    const withUndefined = { n: undefined } as unknown as MessageParams;
    const withNull = { n: null } as unknown as MessageParams;
    expect(fillTemplate('竹笋 +{n}', withUndefined)).toBe('竹笋 +{n}');
    expect(fillTemplate('竹笋 +{n}', withNull)).toBe('竹笋 +{n}');
    expect(fillTemplate('竹笋 +{n}', { n: 0 })).toBe('竹笋 +0');
  });

  it('ensureMessages 的返回值能区分"已就位"与"没有这份语言"', async () => {
    // 中文常驻，永远可用；英文在上面的 beforeAll 里已加载成功
    expect(await ensureMessages('zh-CN')).toBe(true);
    expect(await ensureMessages('en')).toBe(true);
  });

  it('ensureSurfaceMessages 幂等且加载完成后取词器能取到 surface 键', async () => {
    expect(await ensureSurfaceMessages()).toBe(true);
    expect(await ensureSurfaceMessages()).toBe(true);
    const tr = createTranslator('zh-CN');
    // 挑一个只属于 surface 的键（任务页/装扮页等懒加载页面用）
    expect(tr('dress.title')).toBe('竹竹的装扮');
    expect(tr('parent.title')).toBe('家长中心');
  });

  it('中英同一键的占位符集合一致（翻译时不能漏掉 {n} / {total} / {done}）', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    const zh = mergedZh();
    const en = messages.en!;
    for (const key of Object.keys(zh)) {
      expect(placeholders(en[key] ?? ''), key + ' = ' + en[key]).toEqual(placeholders(zh[key]!));
    }
  });

  it('fillTemplate 只替换已知占位符，未知 / 缺失 / 重复 / 多个都能处理', () => {
    // 多个占位符各替换各的，顺序不影响结果
    expect(fillTemplate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2');
    // 同一个占位符出现两次，两处都要替换
    expect(fillTemplate('{n} / {n}', { n: 3 })).toBe('3 / 3');
    // 未知占位符保留原文（宁可露出 {x}，也不要渲染出 undefined）
    expect(fillTemplate('{n} + {x}', { n: 3 })).toBe('3 + {x}');
    // 没有占位符时原样返回
    expect(fillTemplate('没有占位符', {})).toBe('没有占位符');
    // 占位符名字里的连字符目前不用；出现了也应原样保留而不是变成半截文本
    expect(fillTemplate('{day-of-week}', {})).toBe('{day-of-week}');
    // 字符串与 0 都是合法值（0 不能被当成"没传"）
    expect(fillTemplate('{n}', { n: 0 })).toBe('0');
    expect(fillTemplate('{name}', { name: 'Bamboo' })).toBe('Bamboo');
    // 花括号不成对时不做替换，也不吞字
    expect(fillTemplate('{n', { n: 3 })).toBe('{n');
    expect(fillTemplate('n}', { n: 3 })).toBe('n}');
  });
});
