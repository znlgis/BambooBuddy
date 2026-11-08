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
let enLoading: Promise<boolean> | null = null;

export const messages = tables;

/**
 * 切到英文前调用；失败时保留中文（宁可语言不完整，也不白屏）。
 *
 * 返回值是**成功与否**，不再无条件 resolve：
 * 以前 catch 里吞掉错误后照样 resolve，调用方以为英文已就位，于是把语言切成了 en、
 * 持久化进 localStorage、把 <html lang> 改成 en，而整站文案还是中文 ——
 * 用户下次打开仍是"假英文"，且没有任何入口能发现。现在调用方可以据此回落到中文。
 * （不 reject：启动流程用 Promise.all + finally 兜底，reject 会变成 unhandled rejection。）
 */
export function ensureMessages(locale: Locale): Promise<boolean> {
  if (locale !== 'en') return Promise.resolve(true);
  if (enTable !== null) return Promise.resolve(true);
  enLoading ??= import('./en')
    .then((module) => {
      enTable = module.enUS;
      tables.en = enTable;
      return true;
    })
    .catch(() => {
      // 保留一次重试机会：万一只是这次网络/缓存抖动，下次切语言还能再试
      enLoading = null;
      return false;
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
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    // 键存在但值为 undefined/null 时保留占位符：以前会渲染出字面量 "undefined"
    const value = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
    return value === undefined || value === null ? whole : String(value);
  });
}

/**
 * 取词器：缺键回落到中文，再回落到键名（永不抛错、永不空白）；带 {参数} 的句子传第二个参数。
 *
 * 每次调用现查表，而不是创建时快照：英文 chunk 是懒加载的，
 * 若某处（例如 Phaser 场景）在 chunk 到位前就建了取词器并缓存，整局都会停在中文。
 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  return (key: MessageKey, params?: MessageParams): string => {
    const table = locale === 'en' ? enTable : null;
    const text: string = table?.[key] ?? zhCN[key] ?? key;
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