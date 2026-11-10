<script setup lang="ts">
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';

/**
 * 小屋的"第二批内容"：累计里程碑、丰收日提示、请小鸟吃竹笋。
 *
 * 它们不是首屏第一眼要回答的问题（竹竹怎么样 / 今天做什么），
 * 所以从 HomeView 里拆出来懒加载 —— 小屋首帧更快，60 KB 的预算也只留真正要紧的东西。
 * 挂在首屏下方，晚几十毫秒出现，孩子感知不到。
 */
const progress = useProgress();
const { t } = useI18n();
const emit = defineEmits<{ (e: 'flash', message: string): void }>();

async function feedBird(): Promise<void> {
  const outcome = await progress.feedBird();
  if (!outcome) {
    emit('flash', t('complete.saveWarn'));
    return;
  }
  emit('flash', outcome.ok ? t('shop.birdDone') : t('shop.birdNoShoots'));
}
</script>

<template>
  <div class="rounded-3xl border-2 border-cream bg-card p-4">
    <p class="flex flex-wrap items-center gap-x-2 text-base text-inksoft">
      <span data-testid="parent-milestone" class="text-bamboo-deep">
        🌱 {{ t('parent.milestone', { n: progress.totalCompletions }) }}
      </span>
      <span v-if="progress.nextMilestone" data-testid="home-next-milestone" class="text-inksoft">
        {{ t('parent.milestone', { n: progress.nextMilestone.at }) }}
      </span>
      <span v-if="progress.harvestToday" data-testid="home-harvest" class="font-bold text-bamboo-deep">
        🌾 {{ t('harvest.title') }}
      </span>
    </p>

    <!-- 竹笋的轻量消耗出口：请小鸟吃一根竹笋，只给动画与计数，不给数值增益 -->
    <button
      type="button"
      data-testid="home-city-bird"
      class="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cream px-4 py-2 text-base font-bold text-ink active:scale-95 disabled:opacity-50"
      :disabled="progress.pet.shoots < progress.BIRD_FEED_COST"
      @click="feedBird"
    >
      <span aria-hidden="true">🐦</span>
      {{ t('shop.bird', { n: progress.BIRD_FEED_COST }) }}
      <span v-if="progress.birdFeeds > 0" class="text-inksoft">· {{ t('shop.birdCount', { n: progress.birdFeeds }) }}</span>
    </button>
  </div>
</template>
