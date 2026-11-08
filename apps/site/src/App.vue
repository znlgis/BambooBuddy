<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { grantParentUnlock, navigate, revokeParentUnlock, useRoute } from './router';
import { installBackButtonHandler } from './shell/backButton';
import { platform } from './shell/platform';
import { useI18n } from './shell/useI18n';
import { useProgress } from './stores/progress';
import { useSettings } from './stores/settings';
import HomeView from './views/HomeView.vue';
import TasksView from './views/TasksView.vue';

/**
 * 玩法页、家长页、日记页都按路由懒加载：首屏只留小屋/任务/装扮，
 * Phaser 引擎要等孩子真的点开一个玩法才下载（体积门禁盯的就是这条）。
 * 日记页也走懒加载：它只在点开时看，把这部分模板从首屏预算里挪出去。
 */
const PlayView = defineAsyncComponent(() => import('./views/PlayView.vue'));
const ParentView = defineAsyncComponent(() => import('./views/ParentView.vue'));
const DiaryView = defineAsyncComponent(() => import('./views/DiaryView.vue'));
// 装扮页也是"点开才看"：它不在首屏可视区，挪出首屏预算（首屏 gzip 已贴着 60 KB 上限）
const DressView = defineAsyncComponent(() => import('./views/DressView.vue'));
// 隐藏小游戏：游戏厅与小游戏宿主都按需加载（小游戏 chunk 里才有 Phaser 场景）
const ArcadeView = defineAsyncComponent(() => import('./views/ArcadeView.vue'));
const ArcadePlayView = defineAsyncComponent(() => import('./views/ArcadePlayView.vue'));

const { t, locale } = useI18n();
const route = useRoute();
const progress = useProgress();
const settings = useSettings();

/** 玩法页全屏（不要顶栏底栏），家长页与隐藏小游戏也独立成页 */
const isFullScreen = computed(
  () =>
    route.value.name === 'player' ||
    route.value.name === 'parent' ||
    route.value.name === 'arcadePlay',
);

/**
 * 路由切换要把主滚动区拉回顶部：
 * 从滚到一半的小屋点"任务"，新页面如果保持旧 scrollTop，会直接停在半张卡片上。
 */
const mainRef = ref<HTMLElement | null>(null);
let previousRouteName = route.value.name;
watch(
  () => route.value.name + ':' + (route.value.taskId ?? ''),
  () => {
    // 离开家长页就吊销令牌：浏览器后退键再回来时没有令牌，回落小屋
    if (previousRouteName === 'parent' && route.value.name !== 'parent') {
      revokeParentUnlock();
    }
    previousRouteName = route.value.name;
    void nextTick(() => {
      mainRef.value?.scrollTo({ top: 0 });
    });
  },
);

/* ---------------- 家长页入口：长按标题 3 秒（孩子不会无意点进来） ---------------- */

let holdTimer: ReturnType<typeof setTimeout> | null = null;
/** 长按真正生效的时刻：只用来吃掉紧随其后的那一次 click */
let holdFiredAt = 0;
/** 长按后浏览器补的 click 通常在同一帧/下一帧内；给足余量但别吃掉下一次正常点击 */
const HOLD_CLICK_WINDOW_MS = 800;

function startParentHold(): void {
  if (holdTimer !== null) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    holdFiredAt = platform.now();
    // 家长页要一次性令牌：没有它，#/parent 直接输地址或浏览器后退都进不去
    grantParentUnlock(platform.now());
    navigate('/parent');
  }, 3000);
}

function cancelParentHold(): void {
  if (holdTimer === null) return;
  clearTimeout(holdTimer);
  holdTimer = null;
}

/** 长按结束后浏览器还会补一次 click：那一次不能再把小屋盖过去 */
function onTitleClick(): void {
  if (holdFiredAt !== 0 && platform.now() - holdFiredAt < HOLD_CLICK_WINDOW_MS) {
    holdFiredAt = 0;
    return;
  }
  holdFiredAt = 0;
  navigate('/');
}

function unlockAudio(): void {
  void platform.audio.unlock();
}

let offResume: (() => void) | null = null;

onMounted(() => {
  settings.init();
  // 安卓实体返回键：先回小屋，再按才退出应用（浏览器里是空操作）
  installBackButtonHandler(route);
  void progress.init();
  // iOS / 微信：音频必须由一次用户手势解锁（只解一次，之后不再监听）
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  // 从后台回来补一次跨天刷新：应用可能在平板上挂了一整夜
  offResume = platform.lifecycle.onResume(() => {
    void progress.refresh();
  });
});

onBeforeUnmount(() => {
  cancelParentHold();
  window.removeEventListener('pointerdown', unlockAudio);
  offResume?.();
  offResume = null;
});

function navClass(active: boolean): string {
  return active ? 'bg-bamboo-deep text-white' : 'bg-card text-ink';
}
</script>

<template>
  <div class="flex h-full flex-col bg-cream">
    <header v-if="!isFullScreen" class="flex items-center justify-between gap-2 px-4 py-2">
      <button
        type="button"
        data-testid="app-title"
        class="min-h-12 min-w-0 flex-1 rounded-2xl text-left active:scale-[0.99]"
        :title="t('app.parentHint')"
        @click="onTitleClick"
        @pointerdown="startParentHold"
        @pointerup="cancelParentHold"
        @pointerleave="cancelParentHold"
        @pointercancel="cancelParentHold"
      >
        <span class="block truncate text-lg font-bold text-bamboo-deep">{{ t('app.title') }}</span>
        <span class="block truncate text-base text-inksoft">{{ t('app.subtitle') }}</span>
      </button>

      <nav class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid="nav-lang"
          class="flex min-h-12 min-w-12 items-center justify-center rounded-full bg-card px-3 text-base font-bold text-bamboo-deep active:scale-95"
          :aria-label="t('locale.aria')"
          @click="locale.toggle()"
        >
          {{ locale.current === 'zh-CN' ? 'EN' : '中文' }}
        </button>
        <button
          type="button"
          data-testid="nav-diary"
          class="flex min-h-12 min-w-12 items-center justify-center gap-1 rounded-full bg-card px-3 text-base font-bold text-ink active:scale-95"
          :aria-label="t('nav.diary')"
          @click="navigate('/diary')"
        >
          <span aria-hidden="true">📔</span>
          <span class="hidden sm:inline">{{ t('nav.diary') }}</span>
        </button>
        <button
          type="button"
          data-testid="nav-sound"
          class="flex min-h-12 min-w-12 items-center justify-center rounded-full bg-card px-3 text-2xl active:scale-95"
          :aria-label="settings.muted ? t('sound.off') : t('sound.on')"
          :aria-pressed="!settings.muted"
          @click="settings.toggle()"
        >
          {{ settings.muted ? '🔇' : '🔊' }}
        </button>
      </nav>
    </header>

    <main
      ref="mainRef"
      class="min-h-0 flex-1"
      :class="isFullScreen ? 'overflow-hidden' : 'overflow-y-auto'"
    >
      <ArcadePlayView
        v-if="route.name === 'arcadePlay' && route.arcadeId"
        :key="route.arcadeId + ':' + locale.current"
        :game-id="route.arcadeId"
      />
      <PlayView
        v-else-if="route.name === 'player' && route.taskId"
        :key="route.taskId + ':' + locale.current"
        :task-id="route.taskId"
      />
      <ArcadeView v-else-if="route.name === 'arcade'" />
      <ParentView v-else-if="route.name === 'parent'" />
      <DiaryView v-else-if="route.name === 'diary'" />
      <DressView v-else-if="route.name === 'dress'" />
      <TasksView v-else-if="route.name === 'tasks'" />
      <HomeView v-else />
    </main>

    <!-- 底部三个大入口：孩子的主线只有这三个 -->
    <nav
      v-if="!isFullScreen"
      class="grid grid-cols-3 gap-2 border-t border-cream bg-paper px-3 py-2"
    >
      <button
        type="button"
        data-testid="nav-home"
        class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-base font-bold active:scale-95"
        :class="navClass(route.name === 'home')"
        @click="navigate('/')"
      >
        <span class="text-xl" aria-hidden="true">🏡</span>
        <span>{{ t('nav.home') }}</span>
      </button>
      <button
        type="button"
        data-testid="nav-tasks"
        class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-base font-bold active:scale-95"
        :class="navClass(route.name === 'tasks')"
        @click="navigate('/tasks')"
      >
        <span class="text-xl" aria-hidden="true">✅</span>
        <span>{{ t('nav.tasks') }}</span>
      </button>
      <button
        type="button"
        data-testid="nav-dress"
        class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-base font-bold active:scale-95"
        :class="navClass(route.name === 'dress')"
        @click="navigate('/dress')"
      >
        <span class="text-xl" aria-hidden="true">👕</span>
        <span>{{ t('nav.dress') }}</span>
      </button>
    </nav>
  </div>
</template>