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
  // 初始语言的落盘与 <html lang>/title 由 main.ts 在挂载前做一次（见 main.ts 的注释）。
  // 这里只读状态，不再重复写 localStorage / 改 document —— 两处都做会让"谁负责初始化"变得含糊。
  const current = ref<Locale>(initialLocale().locale);

  const t = (key: MessageKey, params?: MessageParams): string =>
    createTranslator(current.value)(key, params);

  async function set(next: Locale): Promise<void> {
    if (next === current.value) return;
    // 英文文案 chunk 加载失败时**不要**切过去：否则界面英文状态 + 中文文案 + 把 en
    // 写进 localStorage，下次启动仍是"假英文"，用户也没有入口能发现。
    const messagesReady = await ensureMessages(next);
    await ensureSummaries(next);
    if (!messagesReady) {
      console.warn('[bamboo] 英文文案加载失败，继续使用中文');
      return;
    }
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