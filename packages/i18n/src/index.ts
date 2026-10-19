import { DEFAULT_LOCALE, LOCALES } from '@bamboo/content/ids';
import type { Locale } from '@bamboo/content/ids';
import { zhCN } from './messages';
import type { MessageKey, MessageParams, Translator } from './messages';

/**
 * 文案表：中文常驻，英文是独立 chunk（约 4 KB gzip）。
 * 中文用户不下载英文文案；英文用户在挂载前由 main.ts 的 ensureMessages() 加载。
 */
const tables: Partial<Record<Locale, Record<MessageKey, string>>> = { 'zh-CN': zhCN };
let enTable: Record<MessageKey, string> | null = null;
let enLoading: Promise<void> | null = null;

export const messages = tables;

/** 切到英文前调用；失败时保留中文（宁可语言不完整，也不白屏） */
export function ensureMessages(locale: Locale): Promise<void> {
  if (locale !== 'en' || enTable !== null) return Promise.resolve();
  enLoading ??= import('./en')
    .then((module) => {
      enTable = module.enUS;
      tables.en = enTable;
    })
    .catch(() => {
      enLoading = null;
    });
  return enLoading;
}

export * from './messages';
export { DEFAULT_LOCALE, LOCALES };
export type { Locale };

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '中文',
  en: 'English',
};

export function fillTemplate(text: string, params: MessageParams): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** 取词器：缺键回落到中文，再回落到键名（永不抛错、永不空白）；带 {参数} 的句子传第二个参数 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const table = locale === 'en' ? (enTable ?? zhCN) : zhCN;
  return (key: MessageKey, params?: MessageParams): string => {
    const text: string = table[key] ?? zhCN[key] ?? key;
    return params === undefined ? text : fillTemplate(text, params);
  };
}

/** 给组件用的便捷函数；游戏内用 ctx.locale 建自己的取词器 */
export function t(
  key: MessageKey,
  params?: MessageParams,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)(key, params);
}

/** ?lang= 解析：'en' / 'en-US' → en；'zh' / 'zh-CN' → zh-CN；其它返回 null */
export function localeFromSearch(search: string): Locale | null {
  const value = new URLSearchParams(search).get('lang');
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
  return null;
}