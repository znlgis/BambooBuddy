import { ensureSummaries } from '@bamboo/content';
import type { Locale } from '@bamboo/content/ids';
import { LOCALE_LABELS, createTranslator, ensureMessages } from '@bamboo/i18n';
import type { MessageKey, MessageParams } from '@bamboo/i18n';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { applyLocaleDocument, initialLocale, persistLocale } from '../logic/locale';

/**
 * 当前语言。优先级：?lang= → 上次选择（localStorage）→ 中文。
 * 切语言会先确保英文内容 chunk 已加载，再换状态 —— 避免界面英文、内容中文的半截状态。
 */
export const useLocale = defineStore('locale', () => {
  const initial = initialLocale();
  const current = ref<Locale>(initial.locale);
  if (initial.fromUrl) persistLocale(current.value);
  applyLocaleDocument(current.value);

  const t = (key: MessageKey, params?: MessageParams): string =>
    createTranslator(current.value)(key, params);

  async function set(next: Locale): Promise<void> {
    if (next === current.value) return;
    await Promise.all([ensureSummaries(next), ensureMessages(next)]);
    current.value = next;
    persistLocale(next);
    applyLocaleDocument(next);
  }

  async function toggle(): Promise<void> {
    await set(current.value === 'en' ? 'zh-CN' : 'en');
  }

  const label = computed(() => LOCALE_LABELS[current.value]);

  return { current, t, set, toggle, label };
});