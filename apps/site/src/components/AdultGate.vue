<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useI18n } from '../shell/useI18n';

/**
 * 成人门：长按标题 3 秒后弹出，答对一道两位数加法才进家长页。
 *
 * 为什么不是"再长按一次"：家长页里有清档，长按对 4–8 岁已经太容易（他们学得会）。
 * Apple 对 Kids 类目要求 parental gate 是 adult-level task；两位数加法既不需要资源、
 * 也不需要联网，家长不费力、孩子大概率算不出。
 *
 * 连续输错 3 次锁 30 秒：防"孩子一直瞎试"，也防家长手滑。
 */
const props = defineProps<{ question: string; answer: number }>();
const emit = defineEmits<{ (e: 'pass'): void; (e: 'cancel'): void }>();

const { t } = useI18n();
const inputRef = ref<HTMLInputElement | null>(null);
const value = ref('');
const wrong = ref(false);
const lockedUntil = ref(0);
const tries = ref(0);
const LOCK_MS = 30_000;
const MAX_TRIES = 3;

function remainingLock(): number {
  return Math.max(0, Math.ceil((lockedUntil.value - Date.now()) / 1000));
}

function submit(): void {
  if (remainingLock() > 0) return;
  // 输入框是文本 + inputmode=numeric：v-model 永远给字符串，这里再兜一层非字符串
  const typed = typeof value.value === 'string' ? value.value : String(value.value ?? '');
  if (Number(typed.trim()) === props.answer) {
    emit('pass');
    return;
  }
  wrong.value = true;
  value.value = '';
  tries.value += 1;
  if (tries.value >= MAX_TRIES) {
    lockedUntil.value = Date.now() + LOCK_MS;
    tries.value = 0;
    window.setTimeout(() => {
      lockedUntil.value = 0;
    }, LOCK_MS);
  }
  inputRef.value?.focus();
}

onMounted(() => {
  void nextTick(() => inputRef.value?.focus());
});
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    data-testid="adult-gate"
    :data-question="question"
    :data-tries="tries"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6"
    @keydown.esc="emit('cancel')"
  >
    <div class="w-full max-w-sm rounded-3xl border-2 border-bamboo bg-card p-6">
      <p class="text-xl font-bold text-bamboo-deep">{{ t('gate.title') }}</p>
      <p class="mt-2 text-base text-ink">{{ t('gate.prompt', { q: question }) }}</p>

      <label class="mt-4 block text-base font-bold text-ink">
        <span class="sr-only">{{ t('gate.placeholder') }}</span>
        <input
          ref="inputRef"
          v-model="value"
          data-testid="adult-gate-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :placeholder="t('gate.placeholder')"
          class="mt-1 min-h-12 w-full rounded-2xl border-2 border-cream bg-paper px-4 text-lg text-ink"
          :disabled="remainingLock() > 0"
          @keydown.enter.prevent="submit"
        />
      </label>

      <p v-if="wrong && remainingLock() === 0" data-testid="adult-gate-wrong" class="mt-2 text-base text-gold" role="status">
        {{ t('gate.wrong') }}
      </p>
      <p v-if="remainingLock() > 0" data-testid="adult-gate-locked" class="mt-2 text-base text-gold" role="status">
        {{ t('gate.locked') }}
      </p>

      <div class="mt-5 flex gap-2">
        <button
          type="button"
          data-testid="adult-gate-submit"
          class="min-h-14 flex-1 rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-50"
          :disabled="remainingLock() > 0"
          @click="submit"
        >
          {{ t('gate.submit') }}
        </button>
        <button
          type="button"
          data-testid="adult-gate-cancel"
          class="min-h-14 rounded-full bg-cream px-5 py-3 text-base font-bold text-ink active:scale-95"
          @click="emit('cancel')"
        >
          {{ t('gate.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>
