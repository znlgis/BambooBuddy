<script setup lang="ts">
import type { TaskId } from '@bamboo/content';
import type { GameEventMap, GameModule, Stars } from '@bamboo/game-kit';
import { t } from '@bamboo/i18n';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { navigate } from '../router';
import { registry } from '../registry';
import { createGameContext } from '../shell/createGameContext';
import { recordDebugError } from '../shell/debug';
import { platform } from '../shell/platform';
import { useProgress } from '../stores/progress';
import { useSettings } from '../stores/settings';

/**
 * 玩法宿主：外壳与十个玩法之间唯一的接缝。
 *
 * 生命周期纪律：
 * - 挂载前必须先 await 读档（深链直达时，秒通关的写入不能被旧快照盖掉）；
 * - unmount 必须真的 dispose Phaser 实例，否则路由切换会残留 canvas 与 rAF 循环；
 * - 切后台要 pause + 停朗读，前台回来再 resume；
 * - 出错只给孩子一句人话 + 两个出口，技术细节进控制台与 window.__bamboo.lastError。
 */
const props = defineProps<{ taskId: TaskId }>();

const host = ref<HTMLDivElement | null>(null);
/** ★ 必须用 shallowRef：ref 会深度代理整个 Phaser 对象图 */
const mod = shallowRef<GameModule | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const leaving = ref(false);
const toast = ref<string[] | null>(null);

const progress = useProgress();
const settings = useSettings();

let disposed = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let exitTimer: ReturnType<typeof setTimeout> | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let offPause: (() => void) | null = null;
let offResume: (() => void) | null = null;

function showToast(lines: string[]): void {
  toast.value = lines;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, 2600);
}

/** task:complete → 写存档 → 把"竹笋 +n / 碎片 +n / 新贴纸"给出来 */
async function finishTask(stars: Stars): Promise<void> {
  const outcome = await progress.completeTask(props.taskId, stars);
  if (!outcome) {
    showToast([t('complete.saveWarn')]);
    return;
  }
  const lines: string[] = [t('complete.reward', { n: outcome.shoots })];
  if (outcome.fragments > 0) lines.push(t('complete.fragments', { n: outcome.fragments }));
  if (outcome.sticker) lines.push(t('complete.sticker'));
  if (progress.unsaved) lines.push(t('complete.saveWarn'));
  showToast(lines);
}

function handleEvent<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void {
  if (type !== 'task:complete') return;
  const result = payload as GameEventMap['task:complete'];
  void finishTask(result.stars);
}

/**
 * 退出：complete → 回任务页；replay → 原地重开。
 * 奖励 toast 至少露 1.2 秒再走 —— 否则孩子刚做到就跳页，根本看不见竹笋 +2。
 */
function handleExit(reason?: 'quit' | 'replay'): void {
  if (reason === 'replay') {
    void restart();
    return;
  }
  if (toast.value === null) {
    navigate('/tasks');
    return;
  }
  if (exitTimer !== null) clearTimeout(exitTimer);
  exitTimer = setTimeout(() => {
    navigate('/tasks');
  }, 1200);
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
    // 先等读档完成，再挂游戏：见文件顶部说明
    await progress.init();
    const load = registry[props.taskId];
    if (!load) {
      error.value = t('play.notFound') + props.taskId;
      return;
    }
    const loaded = (await load()).default;
    if (disposed || !host.value) return;
    mod.value = loaded;
    const context = await createGameContext(
      loaded.manifest,
      host.value,
      { onExit: handleExit, onEvent: handleEvent },
      progress.completedBefore(props.taskId),
    );
    if (disposed || !host.value) return;
    await loaded.mount(context);
    bindLifecycle();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    error.value = t('play.loadFailed');
    recordDebugError(detail);
    console.error('[bamboo] 玩法载入失败：' + props.taskId, cause);
  } finally {
    loading.value = false;
  }
}

/** 原地再来一局：卸掉旧 Phaser 实例再挂一次（不刷新页面、不回任务页） */
async function restart(): Promise<void> {
  if (disposed) return;
  releaseLifecycle();
  await mod.value?.unmount();
  mod.value = null;
  if (host.value) host.value.innerHTML = '';
  await start();
}

function leaveNow(): void {
  platform.audio.stopSpeech();
  navigate('/tasks');
}

onMounted(() => {
  void start();
  // 休息提醒的数据来源：每 30 秒记一次玩耍时长（只统计游戏时间）
  playTimer = setInterval(() => {
    void progress.addSeconds(30);
  }, 30_000);
});

onBeforeUnmount(async () => {
  disposed = true;
  if (playTimer !== null) clearInterval(playTimer);
  if (toastTimer !== null) clearTimeout(toastTimer);
  if (exitTimer !== null) clearTimeout(exitTimer);
  playTimer = null;
  toastTimer = null;
  exitTimer = null;
  releaseLifecycle();
  // 中途退出还在念旁白 = 回到任务页继续有人说话（场景自己不一定停）
  platform.audio.stopSpeech();
  await mod.value?.unmount();
  mod.value = null;
});
</script>

<template>
  <div data-testid="play-view" class="relative h-full w-full overflow-hidden bg-ink">
    <!-- Phaser 画布容器：尺寸完全由 CSS 与 ScaleManager 决定 -->
    <div ref="host" data-testid="play-host" class="game-host h-full w-full" />

    <!-- 顶部两个大按钮：孩子随时能退出，家长随时能静音 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
      <button
        type="button"
        data-testid="play-leave"
        class="pointer-events-auto flex min-h-14 min-w-14 items-center gap-1 rounded-2xl bg-ink/75 px-4 text-base font-bold text-white active:scale-95"
        :aria-label="t('play.leave')"
        @click="leaving = true"
      >
        <span class="text-2xl" aria-hidden="true">←</span>
        <span>{{ t('play.leave') }}</span>
      </button>
      <button
        type="button"
        data-testid="play-sound"
        class="pointer-events-auto flex min-h-14 min-w-14 items-center justify-center rounded-2xl bg-ink/75 px-3 text-2xl text-white active:scale-95"
        :aria-label="settings.muted ? t('sound.off') : t('sound.on')"
        @click="settings.toggle()"
      >
        {{ settings.muted ? '🔇' : '🔊' }}
      </button>
    </div>

    <div
      v-if="loading && error === null"
      data-testid="play-loading"
      class="absolute inset-0 z-20 flex items-center justify-center bg-paper/95"
    >
      <p class="text-lg font-bold text-bamboo-deep">{{ t('play.loading') }}</p>
    </div>

    <!-- 退出确认：误触不会直接中断这一局 -->
    <div
      v-if="leaving"
      data-testid="play-leave-confirm"
      class="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-6"
    >
      <div class="w-full max-w-sm rounded-3xl bg-card p-6 text-center">
        <p class="text-lg font-bold text-ink">{{ t('play.leaveConfirm') }}</p>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="play-leave-stay"
            class="min-h-14 flex-1 rounded-full bg-bamboo px-4 py-3 text-base font-bold text-white active:scale-95"
            @click="leaving = false"
          >
            {{ t('play.leaveStay') }}
          </button>
          <button
            type="button"
            data-testid="play-leave-exit"
            class="min-h-14 flex-1 rounded-full bg-warm-red px-4 py-3 text-base font-bold text-white active:scale-95"
            @click="leaveNow"
          >
            {{ t('play.leave') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 错误态：只给孩子一句人话 + 两个出口 -->
    <div
      v-if="error !== null"
      class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-paper px-6 text-center"
    >
      <p class="text-base text-ink">{{ error }}</p>
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-testid="play-retry"
          class="min-h-14 rounded-full bg-bamboo-deep px-8 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-60"
          :disabled="loading"
          @click="start"
        >
          {{ t('play.retry') }}
        </button>
        <button
          type="button"
          data-testid="play-back"
          class="min-h-14 rounded-full bg-warm-red px-8 py-3 text-base font-bold text-white active:scale-95"
          @click="navigate('/tasks')"
        >
          {{ t('play.backToTasks') }}
        </button>
      </div>
    </div>

    <!-- 奖励 toast：竹笋 / 碎片 / 新贴纸 -->
    <div
      v-if="toast"
      data-testid="play-toast"
      role="status"
      class="absolute inset-x-4 bottom-6 z-30 rounded-3xl bg-card px-4 py-3 shadow-lg"
    >
      <p class="text-base font-bold text-bamboo-deep">{{ t('complete.title') }}</p>
      <p v-for="line in toast" :key="line" class="text-base text-ink">{{ line }}</p>
    </div>
  </div>
</template>
