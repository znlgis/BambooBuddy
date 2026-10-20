<script setup lang="ts">
import type { ArcadeEventMap, ArcadeGameId, ArcadeModule } from '@bamboo/game-kit';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { arcadeRegistry } from '../arcade/registry';
import { navigate } from '../router';
import { createArcadeContext } from '../shell/createArcadeContext';
import { recordDebugError, recordDebugEvent } from '../shell/debug';
import { platform } from '../shell/platform';
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';
import { useSettings } from '../stores/settings';

/**
 * 隐藏小游戏的宿主：与 PlayView 同构，但目标是 ArcadeModule（没有任务内容）。
 * 三条纪律与日常玩法一致：先等读档、unmount 必须销毁 Phaser、切后台保存暂停/恢复。
 * 另外多一条：只有「已解锁 + 今天没玩过」才允许开局（深链也拦）。
 */
const props = defineProps<{ gameId: ArcadeGameId }>();

const host = ref<HTMLDivElement | null>(null);
const mod = shallowRef<ArcadeModule | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const leaving = ref(false);
const toast = ref<string | null>(null);
const recorded = ref(false);

const progress = useProgress();
const settings = useSettings();
const { t, locale } = useI18n();

let disposed = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let offPause: (() => void) | null = null;
let offResume: (() => void) | null = null;

function showToast(text: string): void {
  toast.value = text;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, 2200);
}

/** 一局真正结束才写存档：中途退出不消耗当天的机会 */
function handleEvent<K extends keyof ArcadeEventMap>(type: K, payload: ArcadeEventMap[K]): void {
  if (type !== 'arcade:complete') return;
  if (recorded.value) return;
  recorded.value = true;
  const result = payload as ArcadeEventMap['arcade:complete'];
  void progress.playArcade(props.gameId, result.score).then((outcome) => {
    if (outcome !== null && !outcome.ok) showToast(t('arcade.playedToday'));
  });
}

function handleExit(): void {
  navigate('/arcade');
}

function bindLifecycle(): void {
  offPause = platform.lifecycle.onPause(() => {
    mod.value?.pause();
    platform.audio.stopSpeech();
  });
  offResume = platform.lifecycle.onResume(() => {
    mod.value?.resume();
  });
}

function releaseLifecycle(): void {
  offPause?.();
  offResume?.();
  offPause = null;
  offResume = null;
}

async function start(): Promise<void> {
  if (disposed || !host.value) return;
  loading.value = true;
  error.value = null;
  try {
    await progress.init();
    // 深链也要拦：没解锁回小屋，今天玩过回游戏厅
    if (!progress.arcadeUnlocked) {
      navigate('/');
      return;
    }
    if (!progress.arcadeAvailable(props.gameId)) {
      navigate('/arcade');
      return;
    }
    const load = arcadeRegistry[props.gameId];
    if (load === undefined) {
      error.value = t('arcade.notFound') + props.gameId;
      return;
    }
    const loaded = (await load()).default;
    if (disposed || !host.value) return;
    mod.value = loaded;
    const context = createArcadeContext(
      loaded.manifest,
      host.value,
      { onEvent: handleEvent, onExit: handleExit },
      locale.current,
    );
    if (disposed || !host.value) return;
    await loaded.mount(context);
    bindLifecycle();
    // 事件桥与 e2e 的起点（照旧只记事件名，不含任何个人信息）
    recordDebugEvent('arcade:start', props.gameId);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    error.value = t('arcade.loadFailed');
    recordDebugError(detail);
    console.error('[bamboo] 小游戏载入失败：' + props.gameId, cause);
  } finally {
    loading.value = false;
  }
}

function leaveNow(): void {
  platform.audio.stopSpeech();
  recordDebugEvent('arcade:exit', 'quit');
  navigate('/arcade');
}

onMounted(() => {
  void start();
  playTimer = setInterval(() => {
    void progress.addSeconds(30);
  }, 30_000);
});

onBeforeUnmount(async () => {
  disposed = true;
  if (playTimer !== null) clearInterval(playTimer);
  if (toastTimer !== null) clearTimeout(toastTimer);
  playTimer = null;
  toastTimer = null;
  releaseLifecycle();
  platform.audio.stopSpeech();
  await mod.value?.unmount();
  mod.value = null;
});
</script>

<template>
  <div data-testid="arcade-play-view" class="relative h-full w-full overflow-hidden bg-ink">
    <div ref="host" data-testid="arcade-host" class="game-host h-full w-full" />

    <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
      <button
        type="button"
        data-testid="arcade-leave"
        class="pointer-events-auto flex min-h-14 min-w-14 items-center gap-1 rounded-2xl bg-ink/75 px-4 text-base font-bold text-white active:scale-95"
        :aria-label="t('arcade.leave')"
        @click="leaving = true"
      >
        <span class="text-2xl" aria-hidden="true">←</span>
        <span>{{ t('arcade.leave') }}</span>
      </button>
      <button
        type="button"
        data-testid="arcade-sound"
        class="pointer-events-auto flex min-h-14 min-w-14 items-center justify-center rounded-2xl bg-ink/75 px-3 text-2xl text-white active:scale-95"
        :aria-label="settings.muted ? t('sound.off') : t('sound.on')"
        @click="settings.toggle()"
      >
        {{ settings.muted ? '🔇' : '🔊' }}
      </button>
    </div>

    <div
      v-if="loading && error === null"
      data-testid="arcade-loading"
      class="absolute inset-0 z-20 flex items-center justify-center bg-paper/95"
    >
      <p class="text-lg font-bold text-bamboo-deep">{{ t('arcade.loading') }}</p>
    </div>

    <div
      v-if="leaving"
      data-testid="arcade-leave-confirm"
      class="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-6"
    >
      <div class="w-full max-w-sm rounded-3xl bg-card p-6 text-center">
        <p class="text-lg font-bold text-ink">{{ t('arcade.leaveConfirm') }}</p>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="arcade-leave-stay"
            class="min-h-14 flex-1 rounded-full bg-bamboo px-4 py-3 text-base font-bold text-white active:scale-95"
            @click="leaving = false"
          >
            {{ t('arcade.leaveStay') }}
          </button>
          <button
            type="button"
            data-testid="arcade-leave-exit"
            class="min-h-14 flex-1 rounded-full bg-warm-red px-4 py-3 text-base font-bold text-white active:scale-95"
            @click="leaveNow"
          >
            {{ t('arcade.leave') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="error !== null"
      class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-paper px-6 text-center"
    >
      <p class="text-base text-ink">{{ error }}</p>
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-testid="arcade-retry"
          class="min-h-14 rounded-full bg-bamboo-deep px-8 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-60"
          :disabled="loading"
          @click="start"
        >
          {{ t('arcade.retry') }}
        </button>
        <button
          type="button"
          data-testid="arcade-back"
          class="min-h-14 rounded-full bg-warm-red px-8 py-3 text-base font-bold text-white active:scale-95"
          @click="navigate('/arcade')"
        >
          {{ t('arcade.back') }}
        </button>
      </div>
    </div>

    <div
      v-if="toast"
      data-testid="arcade-toast"
      role="status"
      class="absolute inset-x-4 bottom-6 z-30 rounded-3xl bg-card px-4 py-3 text-base text-ink shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
