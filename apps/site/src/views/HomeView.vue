<script setup lang="ts">
import { taskSummaries } from '@bamboo/content';
import type { TaskId } from '@bamboo/content';
import { CARE_ACTIONS } from '@bamboo/game-kit';
import type { CareAction } from '@bamboo/game-kit';
import { STAT_KEYS } from '@bamboo/content/ids';
import type { MessageKey } from '@bamboo/i18n';
import { currentSlot, dayKey, intimacyLevel, recommendedTasks, statHints } from '@bamboo/progress';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PandaBuddy from '../components/PandaBuddy.vue';
import RoomScene from '../components/RoomScene.vue';
import { CARE_LABELS, STAT_COLORS, STAT_LABEL_KEYS, TASK_HINT_KEYS } from '../logic/labels';
import { moodFromStats } from '../logic/pandaLook';
import { navigate } from '../router';
import { platform } from '../shell/platform';
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';
import { useSettings } from '../stores/settings';

/**
 * 小屋：孩子每天打开的第一屏。
 * 一屏里只回答三件事：竹竹现在怎么样、我能为它做点什么、今天玩什么。
 * 所有提醒都是"邀请"而不是"警告"（状态再低也不会红、不会扣分、不会结束游戏）。
 */
const progress = useProgress();
const settings = useSettings();
const { t, locale } = useI18n();

/** 任务标题随语言切换；逻辑（id/收益/解锁）仍用同一份摘要 */
const tasks = computed(() => taskSummaries(locale.current));

const mood = computed(() => moodFromStats(progress.pet.stats));

/** 打招呼按时段变：早上/中午/晚上各一句，孩子在幼儿园也会对照现实时间 */
const greetingKey = computed<MessageKey>(() => {
  const slot = currentSlot(platform.now());
  if (slot === 'morning') return 'home.greeting.morning';
  if (slot === 'noon') return 'home.greeting.noon';
  return 'home.greeting.evening';
});

/** 小愿望：只取最低的那一项（最多两条），没有低项时给一句温和的邀请 */
const hints = computed(() => statHints(progress.pet.stats));
const hintTask = computed(() => hints.value[0]?.taskId ?? null);
const hintText = computed(() =>
  hints.value[0] ? t(TASK_HINT_KEYS[hints.value[0].taskId]) : t('home.today'),
);

/** 今日推荐只放两个入口：小屋里不摆一整屏卡片，孩子会挑花眼 */
const quickToday = computed(() =>
  recommendedTasks(dayKey(platform.now()), currentSlot(platform.now()), tasks.value, 2),
);

const careFlash = ref<string | null>(null);

/* ---------------- 隐藏彩蛋：连续点竹竹 7 次（5 秒内） ---------------- */

/** 点几下 / 多长时间内点完：孩子能连出来，大人瞎点一般不会凑巧触发 */
const SECRET_TAPS = 7;
const SECRET_WINDOW_MS = 5000;

const secretOpen = ref(false);
const pandaWiggle = ref(false);
let pandaTaps: number[] = [];
let wiggleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 竹竹的小秘密：连点它 7 次，会带你走一条竹林小路 ——
 * 当天小门直接打开（不用先攒四件小事），三款小游戏无限畅玩。
 * 已经触发过的当天再点，只当摸摸头（不重复弹浮层，也不重复写档）。
 */
async function onPandaTap(): Promise<void> {
  pandaWiggle.value = true;
  if (wiggleTimer !== null) clearTimeout(wiggleTimer);
  wiggleTimer = setTimeout(() => {
    pandaWiggle.value = false;
    wiggleTimer = null;
  }, 260);

  if (progress.arcadeUnlimited) return;

  const now = platform.now();
  pandaTaps = [...pandaTaps.filter((at) => now - at < SECRET_WINDOW_MS), now];
  if (pandaTaps.length < SECRET_TAPS) return;
  pandaTaps = [];

  const outcome = await progress.unlockArcadeSecret();
  if (outcome === null || !outcome.ok) return;
  secretOpen.value = true;
  platform.audio.play('unlock');
  if (!settings.muted) {
    void platform.audio.speak(t('arcade.secret.voice'), locale.current).done;
  }
}

onBeforeUnmount(() => {
  if (wiggleTimer !== null) clearTimeout(wiggleTimer);
  wiggleTimer = null;
});

async function doCare(action: CareAction): Promise<void> {
  if (!progress.careAvailable[action]) return;
  const outcome = await progress.care(action);
  if (outcome?.ok) {
    careFlash.value = t('care.level', { n: intimacyLevel(progress.pet.intimacy).level });
  }
}

async function doFeed(): Promise<void> {
  if (progress.pet.shoots < 1) return;
  const outcome = await progress.feed();
  if (outcome?.ok) careFlash.value = t('home.care.feedDone');
}

/** 没到阶段的玩法不能从小屋直接深链进去（任务页会显示"长大一点就能玩啦"） */
function canPlay(taskId: TaskId): boolean {
  const summary = tasks.value.find((item) => item.id === taskId);
  return summary !== undefined && summary.unlockLevel <= progress.stage.id;
}

function play(taskId: TaskId): void {
  navigate(canPlay(taskId) ? '/play/' + taskId : '/tasks');
}

function goHint(): void {
  if (hintTask.value) {
    play(hintTask.value);
    return;
  }
  navigate('/tasks');
}

onMounted(() => {
  // 回到小屋时补一次跨天衰减：应用挂在后台过夜也不会掉两次状态
  void progress.refresh();
});
</script>

<template>
  <section
    data-testid="home-view"
    class="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-3"
  >
    <!-- 小屋场景：房间布置来自存档，竹竹站在地毯前 -->
    <div class="overflow-hidden rounded-3xl border-2 border-cream bg-paper">
      <div class="relative h-64 sm:h-72">
        <RoomScene :room="progress.pet.room" />

        <div
          data-testid="home-panda"
          class="absolute bottom-1 left-1/2 h-60 w-52 -translate-x-1/2 touch-manipulation transition-transform duration-150"
          :class="pandaWiggle ? 'scale-105' : ''"
          @pointerdown="onPandaTap"
        >
          <PandaBuddy
            :mood="mood"
            :stage-scale="progress.stage.scale"
            :equipped="progress.pet.equipped"
          />
        </div>
      </div>

      <!-- 阶段与竹笋/碎片放在场景下面：压在墙上会挡住窗，也挡住竹竹的头 -->
      <div class="flex flex-wrap items-center gap-2 bg-card px-3 pb-1 pt-2">
        <span
          data-testid="home-stage"
          class="rounded-full bg-cream px-3 py-1 text-base font-bold text-bamboo-deep"
        >
          {{ t('home.stage') }} · {{ locale.current === 'en' ? progress.stage.nameEn : progress.stage.name }}
        </span>
        <span data-testid="home-shoots" class="rounded-full bg-cream px-3 py-1 text-base text-ink">
          🎋 {{ t('home.shoots', { n: progress.pet.shoots }) }}
        </span>
        <span data-testid="home-fragments" class="rounded-full bg-cream px-3 py-1 text-base text-ink">
          🧩 {{ t('home.fragments', { n: progress.pet.fragments }) }}
        </span>
      </div>

      <p class="bg-card px-3 py-2 text-base text-inksoft">
        {{ progress.nextStage ? t('home.nextStage', { n: progress.xpToNext }) : t('home.maxStage') }}
      </p>
    </div>

    <!-- 竹林小门：完成今天四件小事后出现，当天有效；上面三款小游戏各玩一次 -->
    <button
      v-if="progress.arcadeUnlocked"
      type="button"
      data-testid="home-arcade"
      class="flex min-h-16 w-full items-center gap-3 rounded-3xl border-2 border-bamboo bg-mint px-4 py-3 text-left active:scale-[0.99]"
      @click="navigate('/arcade')"
    >
      <span
        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-bamboo-deep text-3xl"
        aria-hidden="true"
      >
        🚪
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-base font-bold text-bamboo-deep">
          {{ t('arcade.door') }}
          <span
            v-if="progress.arcadeUnlimited"
            data-testid="home-arcade-unlimited"
            class="ml-1 rounded-full bg-bamboo-deep px-2 py-0.5 text-base text-white"
          >
            ∞ {{ t('arcade.unlimited') }}
          </span>
        </span>
        <span class="block text-base text-ink">
          {{ progress.arcadeUnlimited ? t('arcade.unlimitedHint') : t('arcade.doorHint') + ' · ' + t('arcade.oncePerDay') }}
        </span>
      </span>
      <span class="text-base text-bamboo" aria-hidden="true">▶</span>
    </button>

    <!-- 竹林小路：连点竹竹 7 次后的隐藏彩蛋（当天无限畅玩） -->
    <div
      v-if="secretOpen"
      data-testid="home-secret"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6"
    >
      <div class="w-full max-w-sm rounded-3xl border-2 border-bamboo bg-card p-6 text-center">
        <div class="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-mint text-5xl" aria-hidden="true">
          🐼
        </div>
        <p class="mt-3 text-xl font-bold text-bamboo-deep">{{ t('arcade.secret.title') }}</p>
        <p class="mt-2 text-base text-ink">{{ t('arcade.secret.body') }}</p>
        <button
          type="button"
          data-testid="home-secret-go"
          class="mt-5 min-h-14 w-full rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95"
          @click="secretOpen = false; navigate('/arcade')"
        >
          {{ t('arcade.secret.go') }}
        </button>
        <button
          type="button"
          data-testid="home-secret-later"
          class="mt-2 min-h-12 w-full rounded-full bg-cream px-5 py-3 text-base font-bold text-ink active:scale-95"
          @click="secretOpen = false"
        >
          {{ t('arcade.secret.later') }}
        </button>
      </div>
    </div>

    <!-- 存不上档要说出来：静默丢进度是最坏的结果 -->
    <p
      v-if="progress.unsaved || progress.initError !== null"
      class="rounded-2xl border-2 border-wood bg-cream px-4 py-3 text-base text-gold"
      role="status"
    >
      {{ progress.initError !== null ? t('save.initFailed') : t('save.unsaved') }}
    </p>

    <!-- 20 分钟休息提醒：一天只出现一次，点过就收起 -->
    <div
      v-if="progress.restDue"
      data-testid="home-rest"
      class="rounded-3xl border-2 border-bamboo bg-mint p-4"
    >
      <p class="text-base font-bold text-bamboo-deep">{{ t('rest.title') }}</p>
      <p class="mt-1 text-base text-ink">{{ t('rest.body') }}</p>
      <button
        type="button"
        data-testid="home-rest-ok"
        class="mt-3 min-h-12 rounded-full bg-bamboo-deep px-6 py-2 text-base font-bold text-white active:scale-95"
        @click="progress.dismissRest()"
      >
        {{ t('rest.ok') }}
      </button>
    </div>

    <!-- 五维状态：低值只配一朵小芽，不报警、不倒数 -->
    <div data-testid="home-stats" class="rounded-3xl border-2 border-cream bg-card p-4">
      <p class="text-base font-bold text-bamboo-deep">{{ t(greetingKey) }}</p>
      <div v-for="key in STAT_KEYS" :key="key" class="mt-3">
        <div class="flex items-center justify-between text-base">
          <span class="font-bold text-ink">
            {{ t(STAT_LABEL_KEYS[key]) }}
            <span v-if="progress.pet.stats[key] < 40" class="ml-1" aria-hidden="true">🌱</span>
          </span>
          <span class="text-inksoft">{{ progress.pet.stats[key] }}</span>
        </div>
        <div
          class="mt-1 h-3 w-full overflow-hidden rounded-full bg-cream"
          role="progressbar"
          :aria-valuenow="progress.pet.stats[key]"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t(STAT_LABEL_KEYS[key])"
        >
          <div
            class="h-3 rounded-full"
            :style="{ width: progress.pet.stats[key] + '%', background: STAT_COLORS[key] }"
          />
        </div>
      </div>
    </div>

    <!-- 亲昵：三个动作每天各一次；喂竹笋消耗奖励（让孩子知道竹笋有用，又不是氪金） -->
    <div class="rounded-3xl border-2 border-cream bg-card p-4">
      <p class="text-base font-bold text-bamboo-deep">{{ t('home.today') }}</p>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <button
          v-for="action in CARE_ACTIONS"
          :key="action"
          type="button"
          :data-testid="'home-care-' + action"
          class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-cream px-1 py-2 text-base font-bold text-ink active:scale-95 disabled:opacity-50"
          :disabled="!progress.careAvailable[action]"
          @click="doCare(action)"
        >
          <span class="text-2xl" aria-hidden="true">{{ CARE_LABELS[action].icon }}</span>
          <span class="text-center leading-tight">
            {{ progress.careAvailable[action] ? t(CARE_LABELS[action].key) : t('home.care.done') }}
          </span>
        </button>
      </div>
      <button
        type="button"
        data-testid="home-care-feed"
        class="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-bamboo-light/60 px-4 py-2 text-base font-bold text-bamboo-deep active:scale-95 disabled:opacity-50"
        :disabled="progress.pet.shoots < 1"
        @click="doFeed"
      >
        <span aria-hidden="true">🎋</span>
        {{ progress.pet.shoots > 0 ? t('home.care.feed') : t('home.care.feedDone') }}
      </button>
      <p v-if="careFlash" class="mt-2 text-base text-bamboo-deep" role="status">
        {{ careFlash }}
      </p>
    </div>

    <!-- 小愿望：点一下直接进对应的玩法 -->
    <button
      type="button"
      data-testid="home-hint"
      class="flex min-h-12 w-full items-center gap-3 rounded-3xl border-2 border-dashed border-bamboo-light bg-card px-4 py-3 text-left active:scale-[0.99]"
      @click="goHint"
    >
      <span class="text-2xl" aria-hidden="true">💭</span>
      <span class="min-w-0 flex-1">
        <span class="block text-base font-bold text-bamboo-deep">{{ t('home.hint') }}</span>
        <span class="block text-base text-ink">{{ hintText }}</span>
      </span>
      <span class="text-base text-bamboo" aria-hidden="true">▶</span>
    </button>

    <!-- 今日推荐：只放两个入口 -->
    <div class="rounded-3xl border-2 border-cream bg-card p-4">
      <p class="text-base font-bold text-bamboo-deep">{{ t('tasks.today') }}</p>
      <ul class="mt-2 grid gap-2">
        <li v-for="task in quickToday" :key="task.id">
          <button
            type="button"
            :data-testid="'home-quick-' + task.id"
            class="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-cream px-3 py-2 text-left active:scale-[0.99]"
            @click="play(task.id)"
          >
            <span class="text-2xl" aria-hidden="true">{{ task.emoji }}</span>
            <span class="min-w-0 flex-1 truncate text-base font-bold text-ink">{{ task.title }}</span>
            <span class="text-base text-bamboo" aria-hidden="true">▶</span>
          </button>
        </li>
      </ul>
    </div>

    <button
      type="button"
      data-testid="home-diary"
      class="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-bamboo-deep px-5 py-3 text-base font-bold text-white active:scale-95"
      @click="navigate('/diary')"
    >
      <span aria-hidden="true">📔</span>
      <span data-testid="diary">{{ t('home.diary') }}</span>
    </button>
  </section>
</template>