import { LOCALES } from '@bamboo/content/ids';
import type { Locale } from '@bamboo/content/ids';
import { createTranslator, localeFromSearch } from '@bamboo/i18n';

export const LOCALE_STORAGE_KEY = 'bamboo.locale';

function hashQuery(): string {
  const hash = window.location.hash;
  const index = hash.indexOf('?');
  return index >= 0 ? hash.slice(index + 1) : '';
}

/** ?lang= 优先于上次选择：分享链接可以直接指定语言（search 与 hash query 都认） */
export function localeFromLocation(): Locale | null {
  return (
    localeFromSearch(window.location.search) ??
    localeFromSearch('?' + hashQuery())
  );
}

export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

export function savedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function initialLocale(): { locale: Locale; fromUrl: boolean } {
  const fromUrl = localeFromLocation();
  if (fromUrl !== null) return { locale: fromUrl, fromUrl: true };
  return { locale: savedLocale() ?? 'zh-CN', fromUrl: false };
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 隐私模式写不了：本次会话仍然生效
  }
}

/** 同步 <html lang> 与浏览器标题；两者都应该跟着界面语言走 */
export function applyLocaleDocument(locale: Locale): void {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  document.title = createTranslator(locale)('app.title');
}
