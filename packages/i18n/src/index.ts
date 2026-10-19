import { messages, zhCN } from './messages';
import type { Locale, MessageKey, MessageParams, Translator } from './messages';

export * from './messages';

export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALES: readonly Locale[] = ['zh-CN'];

export function fillTemplate(text: string, params: MessageParams): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** 取词器：缺键回落到键名（永不抛错、永不空白）；带 {参数} 的句子传第二个参数 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const table = messages[locale] ?? zhCN;
  return (key: MessageKey, params?: MessageParams): string => {
    const text: string = table[key] ?? zhCN[key] ?? key;
    return params === undefined ? text : fillTemplate(text, params);
  };
}

/** 给组件用的便捷函数（固定中文；保留 locale 参数让将来加语言时调用点不用改） */
export function t(key: MessageKey, params?: MessageParams, locale: Locale = DEFAULT_LOCALE): string {
  return createTranslator(locale)(key, params);
}
