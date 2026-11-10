<script setup lang="ts">
import type { ArcadeEventMap, ArcadeGameId, ArcadeModule } from '@bamboo/game-kit';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { arcadeRegistry } from '../arcade/registry';
import { navigate } from '../router';
import { createArcadeContext } from '../shell/createArcadeContext';
import { recordDebugError, recordDebugEvent } from '../shell/debug';
import { useModal } from '../shell/modal';
import { platform } from '../shell/platform';
import { startPlayClock } from '../shell/playClock';
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
/** 开局时读一次：无限畅玩（竹林小路）下每局结束后自动接着开下一局，不返回游戏厅 */
let unlimitedMode = false;
/** 正在准备下一局：防止两局事件叠在一起重复开 */
let continuing = false;

let continueTimer: ReturnType<typeof setTimeout> | null = null;

/* 两个全屏浮层：焦点移入、Esc 关闭、关闭后焦点还回去（见 shell/modal） */
const leaveDialog = ref<HTMLElement | null>(null);
const errorDialog = ref<HTMLElement | null>(null);
useModal(leaveDialog, () => {
  leaving.value = false;
});
/** 错误态没有"取消"可言：Esc 与"回游戏厅"按钮一致 */
useModal(errorDialog, () => navigate('/arcade'));

const progress = useProgress();
const settings = useSettings();
const { t, locale } = useI18n();

let disposed = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
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

/**
 * 一局真正结束才写存档：中途退出不消耗当天的机会。
 * 普通模式只结算一次（随后由结算卡回游戏厅）；无限畅玩时每完成一局都写档，
 * 并且不返回游戏厅，直接接着开下一局。
 */
function handleEvent<K extends keyof ArcadeEventMap>(type: K, payload: ArcadeEventMap[K]): void {
  if (type !== 'arcade:complete') return;
  const result = payload as ArcadeEventMap['arcade:complete'];
  void progress.playArcade(props.gameId, result.score).then((outcome) => {
    if (outcome !== null && !outcome.ok && outcome.reason === 'limit') {
      showToast(t('arcade.limitReached', { n: progress.arcadeStatus.dailyLimit }));
    }
    // 无限畅玩：一局结束后直接换上新一局（难度按刚写档后的累计局数重新算）。
    // 即使这次写档失败也不把孩子卡在结束画面上：先接着能玩。
    if (unlimitedMode && result.mode === 'continuous') scheduleNextRound();
  });
}

function scheduleNextRound(): void {
  if (disposed || continuing) return;
  continuing = true;
  continueTimer = setTimeout(() => {
    continueTimer = null;
    void startNextRound();
  }, 900);
}

/** 无限畅玩专用：销毁刚结束的这一局，立刻用同一款游戏开下一局（不经过游戏厅） */
async function startNextRound(): Promise<void> {
  if (disposed || !host.value) return;
  try {
    await mod.value?.unmount();
  } catch {
    // 旧一局销毁失败不阻塞新一局
  }
  mod.value = null;
  if (disposed || !host.value) return;
  try {
    const load = arcadeRegistry[props.gameId];
    if (load === undefined) return;
    const loaded = (await load()).default;
    if (disposed || !host.value) return;
    mod.value = loaded;
    const context = createArcadeContext(
      loaded.manifest,
      host.value,
      { onEvent: handleEvent, onExit: handleExit },
      locale.current,
      progress.arcadeLevel(props.gameId),
      unlimitedMode,
    );
    await loaded.mount(context);
    recordDebugEvent('arcade:start', props.gameId);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    error.value = t('arcade.loadFailed');
    recordDebugError(detail);
    console.error('[bamboo] 小游戏续局失败：' + props.gameId, cause);
  } finally {
    continuing = false;
  }
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
      // 不把内部 id 拼进孩子读的文案：路由已经挡过未知 id，这里只留调试细节
      recordDebugError('arcadeRegistry 缺少小游戏：' + props.gameId);
      error.value = t('arcade.loadFailed');
      return;
    }
    const loaded = (await load()).default;
    if (disposed || !host.value) return;
    mod.value = loaded;
    unlimitedMode = progress.arcadeUnlimited;
    // 难度等级在开局这一刻读一次：这一局内不变，下一局会按新的累计局数重新算
    const context = createArcadeContext(
      loaded.manifest,
      host.value,
      { onEvent: handleEvent, onExit: handleExit },
      locale.current,
      progress.arcadeLevel(props.gameId),
      unlimitedMode,
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
});

// 休息提醒的数据来源：小游戏同样计入玩耍时长（合并落盘，见 playClock）
startPlayClock((seconds) => progress.addSeconds(seconds));

onBeforeUnmount(async () => {
  disposed = true;
  continuing = false;
  if (toastTimer !== null) clearTimeout(toastTimer);
  if (continueTimer !== null) clearTimeout(continueTimer);
  continueTimer = null;
  toastTimer = null;
  releaseLifecycle();
  platform.audio.stopSpeech();
  try {
    await mod.value?.unmount();
  } catch (cause) {
    // 卸载失败不该让路由切换变成未处理拒绝；技术细节留给调试桥
    recordDebugError(cause instanceof Error ? cause.message : String(cause));
  }
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
        :aria-pressed="!settings.muted"
        @click="settings.toggle()"
      >
        {{ settings.muted ? '🔇' : '🔊' }}
      </button>
    </div>

    <div
      v-if="loading && error === null"
      data-testid="arcade-loading"
      role="status"
      aria-live="polite"
      class="absolute inset-0 z-20 flex items-center justify-center bg-paper/95"
    >
      <p class="text-lg font-bold text-bamboo-deep">{{ t('arcade.loading') }}</p>
    </div>

    <div
      v-if="leaving"
      ref="leaveDialog"
      data-testid="arcade-leave-confirm"
      role="dialog"
      aria-modal="true"
      :aria-label="t('arcade.leaveConfirm')"
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
      ref="errorDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="arcade-error-text"
      class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-paper px-6 text-center"
    >
      <p id="arcade-error-text" class="text-base text-ink">{{ error }}</p>
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
