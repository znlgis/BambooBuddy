<script setup lang="ts">
import { computed, ref } from 'vue';
import { useModal } from '../shell/modal';
import { useI18n } from '../shell/useI18n';

/**
 * 成人门：长按标题 3 秒后弹出，答对一道两位数加法才进家长页。
 *
 * 为什么不是"再长按一次"：家长页里有清档，长按对 4–8 岁已经太容易（他们学得会）。
 * Apple 对 Kids 类目要求 parental gate 是 adult-level task；两位数加法既不需要资源、
 * 也不需要联网，家长不费力、孩子大概率算不出。
 *
 * 为什么是屏幕数字键盘，而不是文本输入框：B 站 Toy 把「自由输入框」列为内容安全红线
 * （《Toy 开发者 FAQ》四、内容规范与合规：自由输入需自行接入内容安全审核，匿名 UGC
 * 能力直接禁止）。这里只接受 0–9 与退格，键盘上打得出的字母、汉字、网址一个都进不来，
 * 门里没有可审核的自由文本，也没有能输入 URL 的入口。
 *
 * 连续输错 3 次锁 30 秒：防"孩子一直瞎试"，也防家长手滑。
 */
const props = defineProps<{ question: string; answer: number }>();
const emit = defineEmits<{ (e: 'pass'): void; (e: 'cancel'): void }>();

const { t } = useI18n();
const dialog = ref<HTMLElement | null>(null);

/** 浮层是模态：焦点落进数字键盘、Esc 取消、关掉后焦点还回触发它的那个按钮 */
useModal(dialog, () => emit('cancel'));

/** 两个两位数相加最大 178：三位足够，也顺手挡住"粘一长串"的输入 */
const MAX_DIGITS = 3;
const LOCK_MS = 30_000;
const MAX_TRIES = 3;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const value = ref('');
const wrong = ref(false);
const lockedUntil = ref(0);
const tries = ref(0);
const locked = computed(() => remainingLock() > 0);

function remainingLock(): number {
  return Math.max(0, Math.ceil((lockedUntil.value - Date.now()) / 1000));
}

function append(digit: string): void {
  if (locked.value || value.value.length >= MAX_DIGITS) return;
  value.value += digit;
  wrong.value = false;
}

function backspace(): void {
  if (locked.value) return;
  value.value = value.value.slice(0, -1);
  wrong.value = false;
}

function submit(): void {
  if (locked.value) return;
  if (value.value === '') return;
  if (Number(value.value) === props.answer) {
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
}

/** 桌面端家长用实体键盘也算"屏幕键盘"：只认数字、退格与回车，其余键一律忽略 */
function onKeydown(event: KeyboardEvent): void {
  if (locked.value) return;
  // 焦点停在按钮上时，Enter / 空格已经由浏览器转成 click：这里再拦一次会变成"按一下加两位"
  if (event.target instanceof HTMLElement && event.target.closest('button') !== null) return;
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    append(event.key);
    return;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    backspace();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    submit();
  }
}

</script>

<template>
  <div
    ref="dialog"
    role="dialog"
    aria-modal="true"
    data-testid="adult-gate"
    :data-question="question"
    :data-tries="tries"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6"
    @keydown="onKeydown"
  >
    <div class="w-full max-w-sm rounded-3xl border-2 border-bamboo bg-card p-6">
      <p class="text-xl font-bold text-bamboo-deep">{{ t('gate.title') }}</p>
      <p class="mt-2 text-base text-ink">{{ t('gate.prompt', { q: question }) }}</p>

      <!-- 只显示、不接受键盘输入：内容全部来自下面这些数字键 -->
      <p
        data-testid="adult-gate-display"
        aria-live="polite"
        class="mt-4 flex min-h-12 items-center justify-center rounded-2xl border-2 border-cream bg-paper px-4 text-2xl font-bold tracking-widest text-ink"
      >
        {{ value === '' ? t('gate.placeholder') : value }}
      </p>

      <div class="mt-3 grid grid-cols-3 gap-2">
        <button
          v-for="digit in DIGITS"
          :key="digit"
          type="button"
          :data-testid="'adult-gate-key-' + digit"
          class="min-h-14 rounded-2xl border-2 border-cream bg-paper text-2xl font-bold text-ink active:scale-95 disabled:opacity-50"
          :disabled="locked"
          @click="append(digit)"
        >
          {{ digit }}
        </button>
        <button
          type="button"
          data-testid="adult-gate-clear"
          :aria-label="t('gate.backspace')"
          class="min-h-14 rounded-2xl border-2 border-cream bg-cream text-xl font-bold text-ink active:scale-95 disabled:opacity-50"
          :disabled="locked"
          @click="backspace"
        >
          ⌫
        </button>
        <button
          type="button"
          data-testid="adult-gate-key-0"
          class="col-span-2 min-h-14 rounded-2xl border-2 border-cream bg-paper text-2xl font-bold text-ink active:scale-95 disabled:opacity-50"
          :disabled="locked"
          @click="append('0')"
        >
          0
        </button>
      </div>

      <p v-if="wrong && remainingLock() === 0" data-testid="adult-gate-wrong" class="mt-2 text-base text-gold" role="status">
        {{ t('gate.wrong') }}
      </p>
      <p v-if="remainingLock() > 0" data-testid="adult-gate-locked" class="mt-2 text-base text-gold" role="status">
        {{ t('gate.locked') }}
      </p>

      <div class="mt-4 flex gap-2">
        <button
          type="button"
          data-testid="adult-gate-submit"
          class="min-h-14 flex-1 rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-50"
          :disabled="locked || value === ''"
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
