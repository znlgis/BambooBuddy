<script setup lang="ts">
import { t } from '@bamboo/i18n';
import type { ClothingSlot, RoomSlot } from '@bamboo/game-kit';
import { CLOTHING_SLOTS } from '@bamboo/progress';
import type { CatalogItem } from '@bamboo/progress';
import { computed, onBeforeUnmount, ref } from 'vue';
import PandaBuddy from '../components/PandaBuddy.vue';
import RoomScene from '../components/RoomScene.vue';
import { dressGroups } from '../logic/dressGroups';
import type { DressTab } from '../logic/dressGroups';
import { useProgress } from '../stores/progress';

/**
 * 装扮页：衣服 / 小窝两个 tab，全部用玩出来的竹笋与碎片解锁。
 * 这里没有抽卡、没有付费入口 —— 每张卡片的价格与阶段要求都写在脸上，
 * 孩子能自己看懂"再玩几天就能得到"。
 */
const progress = useProgress();

const tab = ref<DressTab>('clothes');
const groups = computed(() => dressGroups(tab.value));
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function flash(message: string): void {
  toast.value = message;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, 2600);
}

function isClothing(item: CatalogItem): boolean {
  return CLOTHING_SLOTS.includes(item.slot as ClothingSlot);
}

function isActive(item: CatalogItem): boolean {
  return isClothing(item)
    ? progress.equippedId(item.slot as ClothingSlot) === item.id
    : progress.roomId(item.slot as RoomSlot) === item.id;
}

function actionLabel(item: CatalogItem): string {
  if (!progress.owns(item.id)) return t('dress.unlock');
  if (isClothing(item)) return isActive(item) ? t('dress.takeOff') : t('dress.equip');
  return isActive(item) ? t('dress.equipped') : t('dress.equip');
}

function actionClass(item: CatalogItem): string {
  if (!progress.owns(item.id)) return 'bg-gold text-white';
  return isActive(item) ? 'bg-cream text-ink' : 'bg-bamboo-deep text-white';
}

/** 解锁失败也要说人话：分别告诉孩子"竹笋不够 / 碎片不够 / 竹竹还没长大" */
function unlockMessage(reason: string | undefined, item: CatalogItem): string {
  if (reason === 'level') return t('dress.needLevel', { n: item.unlockLevel });
  if (reason === 'noShoots') return t('dress.noShoots');
  if (reason === 'noFragments') return t('dress.noFragments');
  return t('dress.locked');
}

async function act(item: CatalogItem): Promise<void> {
  if (!progress.owns(item.id)) {
    const outcome = await progress.unlock(item.id);
    if (!outcome) return;
    flash(outcome.ok ? t('dress.unlocked') : unlockMessage(outcome.reason, item));
    return;
  }
  const outcome = await progress.equip(item.id);
  if (outcome && !outcome.ok) flash(t('dress.locked'));
}

onBeforeUnmount(() => {
  if (toastTimer !== null) clearTimeout(toastTimer);
});
</script>

<template>
  <section data-testid="dress-view" class="mx-auto w-full max-w-xl px-4 pb-10 pt-3">
    <h1 class="text-2xl font-bold text-bamboo-deep">{{ t('dress.title') }}</h1>

    <!-- 余额与阶段：孩子自己就能判断"还差多少" -->
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card px-4 py-2 text-base">
      <span class="text-ink">🎋 {{ t('home.shoots', { n: progress.pet.shoots }) }}</span>
      <span class="text-ink">🧩 {{ t('home.fragments', { n: progress.pet.fragments }) }}</span>
      <span class="text-inksoft">{{ progress.stage.name }}</span>
    </div>

    <!-- 试穿预览：小窝背景 + 穿上装的竹竹，换什么都能立刻看见 -->
    <div
      data-testid="dress-preview"
      class="relative mt-3 h-56 overflow-hidden rounded-3xl border-2 border-cream bg-paper"
    >
      <RoomScene :room="progress.pet.room" />
      <div class="absolute inset-0 flex items-end justify-center">
        <div class="h-52 w-44">
          <PandaBuddy
            :equipped="progress.pet.equipped"
            :stage-scale="progress.stage.scale"
            mood="happy"
          />
        </div>
      </div>
      <span class="absolute left-2 top-2 rounded-full bg-card/90 px-3 py-1 text-base text-bamboo-deep">
        {{ t('dress.preview') }}
      </span>
    </div>

    <!-- tab -->
    <div class="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        data-testid="dress-tab-clothes"
        class="flex min-h-12 items-center justify-center gap-1 rounded-full px-4 py-2 text-base font-bold active:scale-95"
        :class="tab === 'clothes' ? 'bg-bamboo-deep text-white' : 'bg-card text-ink'"
        @click="tab = 'clothes'"
      >
        👕 {{ t('dress.clothes') }}
      </button>
      <button
        type="button"
        data-testid="dress-tab-room"
        class="flex min-h-12 items-center justify-center gap-1 rounded-full px-4 py-2 text-base font-bold active:scale-95"
        :class="tab === 'room' ? 'bg-bamboo-deep text-white' : 'bg-card text-ink'"
        @click="tab = 'room'"
      >
        🏠 {{ t('dress.room') }}
      </button>
    </div>

    <!-- 按部位分组的目录 -->
    <div v-for="group in groups" :key="group.slot" class="mt-4">
      <h2 class="border-b-2 border-dashed border-cream pb-1 text-base font-bold text-bamboo-deep">
        {{ group.title }}
      </h2>
      <ul class="mt-2 grid grid-cols-2 gap-2">
        <li
          v-for="item in group.items"
          :key="item.id"
          :data-testid="'dress-item-' + item.id"
          class="flex flex-col rounded-2xl border-2 p-3"
          :class="isActive(item) ? 'border-bamboo bg-mint' : 'border-cream bg-card'"
        >
          <div class="flex items-center gap-2">
            <span class="text-2xl" aria-hidden="true">{{ item.emoji }}</span>
            <span class="min-w-0 flex-1 truncate text-base font-bold text-ink">{{ item.name }}</span>
          </div>
          <p class="mt-1 flex flex-wrap gap-x-2 text-base text-inksoft">
            <span v-if="item.costShoots > 0">🎋 {{ t('dress.costShoots', { n: item.costShoots }) }}</span>
            <span v-if="item.costFragments > 0">🧩 {{ t('dress.costFragments', { n: item.costFragments }) }}</span>
            <span v-if="!progress.owns(item.id) && item.unlockLevel > 1" class="text-gold">
              🔒 {{ t('dress.needLevel', { n: item.unlockLevel }) }}
            </span>
          </p>
          <button
            type="button"
            :data-testid="'dress-action-' + item.id"
            class="mt-2 min-h-12 w-full rounded-full px-3 py-2 text-base font-bold active:scale-95"
            :class="actionClass(item)"
            @click="act(item)"
          >
            {{ actionLabel(item) }}
          </button>
        </li>
      </ul>
    </div>

    <p
      v-if="toast"
      data-testid="dress-toast"
      role="status"
      class="fixed inset-x-4 bottom-24 z-30 rounded-2xl bg-ink px-4 py-3 text-center text-base text-white"
    >
      {{ toast }}
    </p>
  </section>
</template>
