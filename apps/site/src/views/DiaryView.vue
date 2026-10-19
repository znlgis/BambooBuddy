<script setup lang="ts">
import { getTaskSummary } from '@bamboo/content';
import type { TaskSummary, TaskId } from '@bamboo/content';
import { t } from '@bamboo/i18n';
import { dayKey } from '@bamboo/progress';
import { computed, ref } from 'vue';
import { dayKind, stickerRows } from '../logic/diary';
import type { StickerRow } from '../logic/diary';
import { navigate } from '../router';
import { platform } from '../shell/platform';
import { useProgress } from '../stores/progress';
import { useSettings } from '../stores/settings';

/**
 * 日记页：把今天做过的事串成"竹竹的一天"。
 * 语音按钮把今天所有日记行连起来读一遍 —— 4–8 岁的孩子还读不了长句，听是主要通道。
 * 静音时按钮不做事（不是灰掉：孩子会一直点一个看不懂原因的禁用按钮）。
 */
const progress = useProgress();
const settings = useSettings();

const todayLines = computed(() =>
  progress.todayRecord.completed
    .map((id) => getTaskSummary(id))
    .filter((task): task is TaskSummary => task !== undefined),
);

const stickers = computed(() => stickerRows(progress.pet));
const selected = ref<TaskId | null>(null);
const selectedRow = computed<StickerRow | null>(
  () => stickers.value.find((row) => row.taskId === selected.value) ?? null,
);
const speaking = ref(false);

function playDiary(): void {
  if (settings.muted) return;
  const lines = todayLines.value.map((task) => task.diary);
  if (lines.length === 0) return;
  const handle = platform.audio.speak(lines.join(' '), 'zh-CN');
  speaking.value = true;
  void handle.done.then(() => {
    speaking.value = false;
  });
}

function dayLabel(date: string): string {
  const kind = dayKind(date, dayKey(platform.now()));
  if (kind === 'today') return t('diary.today');
  if (kind === 'yesterday') return t('diary.yesterday');
  return date.slice(5).replace('-', '/');
}

function stickerHint(row: StickerRow): string {
  return row.owned ? t('tasks.sticker') : t('tasks.stickerHint');
}
</script>

<template>
  <section data-testid="diary-view" class="mx-auto w-full max-w-xl px-4 pb-10 pt-3">
    <h1 class="text-2xl font-bold text-bamboo-deep">{{ t('diary.title') }}</h1>

    <!-- 今天：一行一件小事，配一张贴纸 -->
    <section data-testid="diary-today" class="mt-4 rounded-3xl border-2 border-cream bg-card p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-bold text-bamboo-deep">{{ t('diary.today') }}</h2>
        <button
          type="button"
          data-testid="diary-play"
          class="flex min-h-12 items-center gap-1 rounded-full bg-bamboo-deep px-4 py-2 text-base font-bold text-white active:scale-95"
          @click="playDiary"
        >
          <span aria-hidden="true">🔊</span>
          <span>{{ speaking ? t('game.listen') : t('diary.voice') }}</span>
        </button>
      </div>

      <p v-if="todayLines.length === 0" class="mt-2 text-base text-inksoft">
        {{ t('diary.empty') }}
      </p>
      <ul v-else class="mt-2 grid gap-2">
        <li
          v-for="task in todayLines"
          :key="task.id"
          :data-testid="'diary-line-' + task.id"
          class="flex items-start gap-2 rounded-2xl bg-cream px-3 py-2 text-base text-ink"
        >
          <span class="text-2xl" aria-hidden="true">{{ task.emoji }}</span>
          <span class="min-w-0 flex-1">{{ task.diary }}</span>
        </li>
      </ul>

      <p class="mt-3 text-base text-gold">
        {{ t('diary.rewards', { s: progress.todayRecord.rewards.shoots, f: progress.todayRecord.rewards.fragments }) }}
      </p>
      <p class="text-base text-inksoft">
        {{ t('diary.care', { n: progress.todayRecord.care.length }) }}
      </p>
    </section>

    <!-- 贴纸册：十格永远都在，没得到的是剪影 -->
    <section class="mt-4 rounded-3xl border-2 border-cream bg-card p-4">
      <h2 class="text-lg font-bold text-bamboo-deep">🏅 {{ t('diary.stickers') }}</h2>
      <div class="mt-2 grid grid-cols-5 gap-2">
        <button
          v-for="row in stickers"
          :key="row.taskId"
          type="button"
          :data-testid="'diary-sticker-' + row.taskId"
          :data-owned="row.owned ? 'true' : 'false'"
          :aria-label="row.title + ' ' + stickerHint(row)"
          class="flex min-h-12 flex-col items-center justify-center rounded-2xl px-1 py-2 text-base active:scale-95"
          :class="row.owned ? 'bg-mint text-ink' : 'bg-cream text-grey'"
          @click="selected = row.taskId"
        >
          <span class="text-2xl" :class="row.owned ? '' : 'opacity-30 grayscale'" aria-hidden="true">
            {{ row.emoji }}
          </span>
          <span class="text-center leading-tight">{{ row.owned ? row.title : '？' }}</span>
        </button>
      </div>
      <p v-if="selectedRow" class="mt-2 rounded-2xl bg-cream px-3 py-2 text-base text-ink" role="status">
        {{ selectedRow.title }} · {{ stickerHint(selectedRow) }}
      </p>
      <p v-else class="mt-2 text-base text-inksoft">{{ t('diary.noStickers') }}</p>
    </section>

    <!-- 最近七天 -->
    <section data-testid="diary-week" class="mt-4 rounded-3xl border-2 border-cream bg-card p-4">
      <h2 class="text-lg font-bold text-bamboo-deep">{{ t('diary.week') }}</h2>
      <ul class="mt-2 grid gap-2">
        <li
          v-for="day in progress.weekSummary"
          :key="day.date"
          class="flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-base"
          :class="day.isToday ? 'bg-mint' : 'bg-cream'"
        >
          <span class="w-16 shrink-0 font-bold text-ink">{{ dayLabel(day.date) }}</span>
          <span class="flex-1 text-inksoft">✅ {{ day.completed.length }}</span>
          <span class="flex gap-1" aria-hidden="true">
            <span v-for="sticker in day.stickers" :key="sticker">🏅</span>
          </span>
        </li>
      </ul>
    </section>

    <button
      type="button"
      class="mt-4 min-h-12 w-full rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95"
      @click="navigate('/')"
    >
      ← {{ t('parent.back') }}
    </button>
  </section>
</template>
