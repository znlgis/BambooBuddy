<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { navigate } from '../router';
import { useI18n } from '../shell/useI18n';

/**
 * 「竹林小路」彩蛋浮层：连点竹竹 7 次才出现，绝大多数会话都不会用到。
 * 因此单独做成一个懒加载组件 —— 它的模板与文案不该占小屋首屏的 60 KB 预算。
 */
const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useI18n();
const TITLE_ID = 'home-secret-title';
const goRef = ref<HTMLButtonElement | null>(null);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(async () => {
  // 浮层是模态：打开时把焦点交给主按钮，Esc 能关
  await Promise.resolve();
  goRef.value?.focus();
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    data-testid="home-secret"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="TITLE_ID"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6"
  >
    <div class="w-full max-w-sm rounded-3xl border-2 border-bamboo bg-card p-6 text-center">
      <div class="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-mint text-5xl" aria-hidden="true">
        🐼
      </div>
      <p :id="TITLE_ID" class="mt-3 text-xl font-bold text-bamboo-deep">{{ t('arcade.secret.title') }}</p>
      <p class="mt-2 text-base text-ink">{{ t('arcade.secret.body') }}</p>
      <button
        ref="goRef"
        type="button"
        data-testid="home-secret-go"
        class="mt-5 min-h-14 w-full rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95"
        @click="emit('close'); navigate('/arcade')"
      >
        {{ t('arcade.secret.go') }}
      </button>
      <button
        type="button"
        data-testid="home-secret-later"
        class="mt-2 min-h-12 w-full rounded-full bg-cream px-5 py-3 text-base font-bold text-ink active:scale-95"
        @click="emit('close')"
      >
        {{ t('arcade.secret.later') }}
      </button>
    </div>
  </div>
</template>
