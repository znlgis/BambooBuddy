import { createTranslator } from '@bamboo/i18n';
import type { MessageKey, MessageParams } from '@bamboo/i18n';
import { useLocale } from '../stores/locale';

/**
 * 组件里统一的取词入口：每次调用都读当前语言，模板渲染时因此会订阅语言状态。
 * 游戏内不用它 —— Phaser 场景走 ctx.locale 自己建取词器。
 */
export function useI18n() {
  const locale = useLocale();
  const t = (key: MessageKey, params?: MessageParams): string =>
    createTranslator(locale.current)(key, params);
  return { locale, t };
}
