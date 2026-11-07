<script setup lang="ts">
import type { ArcadeGameId } from '@bamboo/game-kit';
import { computed, onMounted, ref } from 'vue';
import { ARCADE_CATALOG } from '../arcade/catalog';
import { navigate } from '../router';
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';

/**
 * 竹林游戏厅：隐藏小游戏唯一的入口页。
 * 未解锁直接回小屋（不给孩子一个「锁着的页面」）。
 * 普通模式每天最多 21 局（三款合计）；无限畅玩不设上限，难度随累计局数一路上涨。
 */
const progress = useProgress();
const { t } = useI18n();

const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const games = ARCADE_CATALOG;
const status = computed(() => progress.arcadeStatus);
const remaining = computed(() => status.value.remainingPlays);
const limitText = computed(() => t('arcade.limitReached', { n: status.value.dailyLimit }));

function showToast(text: string): void {
  toast.value = text;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, 2200);
}

function start(gameId: ArcadeGameId): void {
  if (!progress.arcadeAvailable(gameId)) {
    showToast(limitText.value);
    return;
  }
  navigate('/arcade/' + gameId);
}

onMounted(async () => {
  await progress.init();
  await progress.refresh();
  // 小门没出现：这个页面本来就不该存在
  if (!progress.arcadeUnlocked) navigate('/');
});
</script>

<template>
  <section
    data-testid="arcade-view"
    class="mx-auto w-full max-w-xl px-4 pb-10 pt-3"
  >
    <header class="rounded-3xl border-2 border-bamboo bg-mint px-4 py-4">
      <h1 class="text-2xl font-bold text-bamboo-deep">🎋 {{ t('arcade.title') }}</h1>
      <p class="mt-1 text-base text-ink">
        {{ progress.arcadeUnlimited ? t('arcade.unlimitedHint') : t('arcade.subtitle') }}
      </p>
      <p
        v-if="progress.arcadeUnlimited"
        data-testid="arcade-unlimited"
        class="mt-1 rounded-full bg-bamboo-deep px-3 py-1 text-base font-bold text-white"
      >
        ∞ {{ t('arcade.unlimited') }}
      </p>
      <p
        v-else
        data-testid="arcade-plays-left"
        class="mt-1 rounded-full bg-bamboo-deep px-3 py-1 text-base font-bold text-white"
      >
        🎮 {{ t('arcade.playsLeft', { n: remaining }) }}
      </p>
    </header>

    <ul class="mt-4 grid gap-3">
      <li v-for="game in games" :key="game.id">
        <button
          type="button"
          :data-testid="'arcade-card-' + game.id"
          class="flex w-full items-center gap-3 rounded-3xl border-2 border-cream bg-card p-4 text-left active:scale-[0.99]"
          :data-played="progress.arcadeAvailable(game.id) ? 'false' : 'true'"
          @click="start(game.id)"
        >
          <span
            class="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-4xl"
            :style="{ background: game.color }"
            aria-hidden="true"
          >
            {{ game.emoji }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-lg font-bold text-ink">{{ t(game.nameKey) }}</span>
            <span class="block text-base text-inksoft">{{ t(game.descKey) }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-2 text-base">
              <span
                class="rounded-full bg-cream px-2 py-0.5 text-bamboo-deep"
                :data-testid="'arcade-best-' + game.id"
              >
                🏆 {{ t('arcade.best', { n: progress.arcadeBest(game.id) }) }}
              </span>
              <span
                class="rounded-full bg-bamboo-deep px-2 py-0.5 font-bold text-white"
                :data-testid="'arcade-level-' + game.id"
              >
                {{ t('arcade.levelShort', { n: progress.arcadeLevel(game.id) }) }}
              </span>
              <span
                v-if="progress.arcadeUnlimited"
                class="rounded-full bg-bamboo-deep px-2 py-0.5 font-bold text-white"
              >
                ∞ {{ t('arcade.unlimited') }}
              </span>
            </span>
          </span>
          <span class="text-base font-bold text-bamboo" aria-hidden="true">▶</span>
        </button>
      </li>
    </ul>

    <p v-if="toast" class="mt-4 rounded-2xl bg-cream px-4 py-3 text-base text-gold" role="status">
      {{ toast }}
    </p>

    <p
      v-if="remaining === 0 && !progress.arcadeUnlimited"
      data-testid="arcade-limit"
      class="mt-4 rounded-2xl bg-cream px-4 py-3 text-base text-ink"
    >
      🌙 {{ limitText }}
    </p>

    <button
      type="button"
      data-testid="arcade-back"
      class="mt-6 min-h-12 w-full rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95"
      @click="navigate('/')"
    >
      {{ t('arcade.back') }}
    </button>
  </section>
</template>
