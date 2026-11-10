import { DEFAULT_LOCALE, LOCALES } from '@bamboo/content/ids';
import type { Locale } from '@bamboo/content/ids';
import { zhCN } from './messages';
import type { MessageKey, MessageParams, SurfaceMessageKey, Translator } from './messages';

/**
 * 文案表：中文核心表常驻首屏；英文表与"懒加载页面的中文文案"各自是独立 chunk。
 *
 * 中文用户不下载英文文案；英文用户在挂载前由 main.ts 的 ensureMessages() 加载；
 * 任务/装扮/日记/家长页/玩法内的中文文案由 ensureSurfaceMessages() 在懒加载视图
 * 挂载前加载 —— 小屋首屏用不到的 170 多条文案没有理由先下载（首屏 60 KB 是硬门槛）。
 */
const tables: Partial<Record<Locale, Record<string, string>>> = { 'zh-CN': zhCN };
let enTable: Record<MessageKey, string> | null = null;
let enLoading: Promise<boolean> | null = null;

/** 懒加载页面的中文文案；未就绪时取词回落到键名 */
let surfaceTable: Record<SurfaceMessageKey, string> | null = null;
let surfaceLoading: Promise<boolean> | null = null;

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

/**
 * 懒加载视图挂载之前调用：保证任务/装扮/日记/家长页/玩法内文案已就位。
 * 失败不抛错（宁可少几条文案，也不白屏）；下次调用会重试。
 */
export function ensureSurfaceMessages(): Promise<boolean> {
  if (surfaceTable !== null) return Promise.resolve(true);
  surfaceLoading ??= import('./messages-surface')
    .then((module) => {
      surfaceTable = module.zhSurface;
      return true;
    })
    .catch(() => {
      surfaceLoading = null;
      return false;
    });
  return surfaceLoading;
}

/** 测试与调试用：某个语言的完整表（中文 = 核心表 + surface 表现拼） */
export function tableFor(locale: Locale): Record<string, string> | null {
  if (locale === 'en') return enTable;
  return surfaceTable === null ? zhCN : { ...zhCN, ...surfaceTable };
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
 * 取词器：缺键回落到中文核心表，再回落到 surface 表，再回落到键名（永不抛错、永不空白）。
 *
 * 每次调用现查表，而不是创建时快照：英文与 surface 两份 chunk 都是懒加载的，
 * 若某处（例如 Phaser 场景）在 chunk 到位前就建了取词器并缓存，整局都会停在中文/键名。
 */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  return (key: MessageKey, params?: MessageParams): string => {
    const en = locale === 'en' ? enTable : null;
    const text: string =
      en?.[key] ??
      (zhCN as Record<string, string>)[key] ??
      (surfaceTable as Record<string, string> | null)?.[key] ??
      key;
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
