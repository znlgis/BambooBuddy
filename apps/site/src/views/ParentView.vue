<script setup lang="ts">
import { getTaskSummary } from '@bamboo/content';
import { weekCompletedCount } from '@bamboo/progress';
import { computed, onBeforeUnmount, ref } from 'vue';
import sitePkg from '../../package.json';
import { navigate } from '../router';
import { platform } from '../shell/platform';
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';
import { useSettings } from '../stores/settings';

/**
 * 家长页（#/parent）：入口是小屋标题**长按 3 秒**，孩子不会误入。
 *
 * 这一页只回答家长最关心的四件事：
 * 1. 安全边界（不联网 / 无广告内购 / 存档只在本机）；
 * 2. 这周完成了几件小事、练到了哪些生活习惯（全部来自本机存档）；
 * 3. 声音开关、清除本机存档（长按 3 秒防误触）；
 * 4. 版本号与回小屋。
 */
const progress = useProgress();
const settings = useSettings();
const { t, locale } = useI18n();

const version = (sitePkg as { version?: string }).version ?? '0.0.0';

const weekCount = computed(() => weekCompletedCount(progress.save, platform.now()));

/** 孩子这周练过的习惯（去重，按第一次出现的顺序排） */
const habits = computed(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of progress.weekSummary) {
    for (const id of day.completed) {
      const task = getTaskSummary(id, locale.current);
      if (task && !seen.has(task.habit)) {
        seen.add(task.habit);
        out.push(task.habit);
      }
    }
  }
  return out;
});

/* ---------------- 清除存档：按住 3 秒，按住时有进度 ---------------- */

const HOLD_MS = 3000;
const holding = ref(false);
const holdProgress = ref(0);
const cleared = ref(false);
let ticker: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

function stopHold(): void {
  holding.value = false;
  holdProgress.value = 0;
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

async function finishClear(): Promise<void> {
  await progress.clear();
  cleared.value = true;
  holding.value = false;
  holdProgress.value = 100;
}

function startHold(): void {
  if (cleared.value || ticker !== null) return;
  holding.value = true;
  holdProgress.value = 0;
  startedAt = platform.now();
  ticker = setInterval(() => {
    const pct = Math.min(100, ((platform.now() - startedAt) / HOLD_MS) * 100);
    holdProgress.value = pct;
    if (pct >= 100) {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
      void finishClear();
    }
  }, 80);
}

const clearLabel = computed(() => {
  if (cleared.value) return t('parent.cleared');
  if (holding.value) return t('parent.clearHold');
  return t('parent.clear');
});

onBeforeUnmount(stopHold);
</script>

<template>
  <section data-testid="parent" class="mx-auto w-full max-w-xl px-4 pb-10 pt-4">
    <div data-testid="parent-view">
      <h1 class="text-2xl font-bold text-bamboo-deep">{{ t('parent.title') }}</h1>
      <p class="mt-2 text-base leading-relaxed text-ink">{{ t('parent.intro') }}</p>

      <ul class="mt-4 grid gap-2 text-base">
        <li class="rounded-2xl bg-card px-4 py-3 text-ink">✅ {{ t('parent.noNetwork') }}</li>
        <li class="rounded-2xl bg-card px-4 py-3 text-ink">✅ {{ t('parent.noAds') }}</li>
        <li class="rounded-2xl bg-card px-4 py-3 text-ink">✅ {{ t('parent.local') }}</li>
      </ul>

      <div class="mt-5 rounded-3xl border-2 border-cream bg-card p-4">
        <p data-testid="parent-week" class="text-base font-bold text-bamboo-deep">
          {{ t('parent.week', { n: weekCount }) }}
        </p>
        <p class="mt-2 text-base text-inksoft">{{ t('parent.learned') }}</p>
        <p v-if="habits.length === 0" class="mt-1 text-base text-gold">{{ t('parent.none') }}</p>
        <ul v-else class="mt-2 flex flex-wrap gap-2">
          <li
            v-for="habit in habits"
            :key="habit"
            class="rounded-full bg-mint px-3 py-1 text-base text-bamboo-deep"
          >
            {{ habit }}
          </li>
        </ul>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="parent-sound"
          class="flex min-h-12 items-center gap-2 rounded-full bg-bamboo-deep px-6 py-3 text-base font-bold text-white active:scale-95"
          @click="settings.toggle()"
        >
          <span data-testid="parent-mute" aria-hidden="true">{{ settings.muted ? '🔇' : '🔊' }}</span>
          <span>{{ settings.muted ? t('sound.off') : t('sound.on') }}</span>
        </button>

        <!--
          宽度必须固定：文案会在"清除本机存档（长按 3 秒）"和"继续按住…"之间变化，
          如果按钮跟着缩，按住时指针会落到按钮外触发 pointerleave，长按永远到不了 3 秒。
        -->
        <button
          type="button"
          data-testid="parent-clear"
          class="relative min-h-12 min-w-64 overflow-hidden whitespace-nowrap rounded-full border-2 border-warm-red px-6 py-3 text-base font-bold text-warm-red active:scale-95"
          @pointerdown="startHold"
          @pointerup="stopHold"
          @pointerleave="stopHold"
          @pointercancel="stopHold"
        >
          <span
            v-if="holding"
            class="absolute inset-y-0 left-0 bg-warm-red/25"
            :style="{ width: holdProgress + '%' }"
            aria-hidden="true"
          />
          <span class="relative">{{ clearLabel }}</span>
        </button>
      </div>

      <p class="mt-6 text-base text-inksoft">{{ t('parent.version', { v: version }) }}</p>

      <button
        type="button"
        data-testid="parent-back"
        class="mt-5 min-h-12 w-full rounded-full bg-bamboo-deep px-6 py-3 text-base font-bold text-white active:scale-95"
        @click="navigate('/')"
      >
        {{ t('parent.back') }}
      </button>
    </div>
  </section>
</template>