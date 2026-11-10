<script setup lang="ts">
import { taskSummaries } from '@bamboo/content';
import type { TaskId } from '@bamboo/content';
import { DAILY_TASK_TARGET, currentSlot, dayKey, recommendedTasks } from '@bamboo/progress';
import { SLOT_LABEL_KEYS } from '../logic/labels';
import { groupTasksBySlot } from '../logic/taskGroups';
import { navigate } from '../router';
import { computed } from 'vue';
import { useI18n } from '../shell/useI18n';
import { useProgress } from '../stores/progress';

/**
 * 任务页：上面四个"今日推荐"，下面十个"全部玩法"。
 * 推荐是确定性的（日期 + 时段做种子），同一天进来多少次都是同一批，
 * 孩子不会因为刷新一次就找不到刚才想做的那件事。
 *
 * 注意：规范里的 data-testid（task-card-<id> 等）只出现在"全部玩法"里，
 * 保证同一个 task id 在页面上只有一个可点入口 —— e2e 的定位不会变得含糊。
 */
const progress = useProgress();
const { t, locale } = useI18n();

const tasks = computed(() => taskSummaries(locale.current));

/** 时间从 progress.now 派生（每分钟刷新）：平板挂一夜也不会停在昨天的推荐批次 */
const dateKey = computed(() => dayKey(progress.now));
const slot = computed(() => currentSlot(progress.now));
const recommended = computed(() => recommendedTasks(dateKey.value, slot.value, tasks.value, 4));
const groups = computed(() => groupTasksBySlot(tasks.value));

/** 今天已经完成了几件不同的小事（与"今日推荐"同一口径） */
const doneToday = computed(() => progress.todayRecord.completed.length);

function locked(unlockLevel: number): boolean {
  return unlockLevel > progress.stage.id;
}

function start(taskId: TaskId, unlockLevel: number): void {
  if (locked(unlockLevel)) return;
  navigate('/play/' + taskId);
}

/** 星星只显示 0–3，空星用 ☆ —— 三颗星是成绩，一颗也是"做到啦" */
function starText(taskId: TaskId): string {
  const stars = progress.starsFor(taskId);
  return '★'.repeat(stars) + '☆'.repeat(3 - stars);
}
</script>

<template>
  <section data-testid="tasks-view" class="mx-auto w-full max-w-xl px-4 pb-10 pt-3">
    <h1 class="text-2xl font-bold text-bamboo-deep">{{ t('tasks.title') }}</h1>
    <!-- 每日份量明示：4 件小事是今天的全部，不多不少（Lingokids 的做法） -->
    <p data-testid="tasks-daily-limit" class="mt-1 text-base text-inksoft">
      {{ t('tasks.dailyLimit', { n: DAILY_TASK_TARGET, done: doneToday }) }}
    </p>

    <!-- 今日推荐 -->
    <section data-testid="tasks-today" class="mt-4">
      <h2 class="text-lg font-bold text-ink">{{ t('tasks.today') }}</h2>
      <ul class="mt-2 grid grid-cols-2 gap-2">
        <li v-for="task in recommended" :key="task.id">
          <!-- 推荐位与下方"全部玩法"走同一份解锁判定：不许从这里绕过 locked() -->
          <button
            type="button"
            :data-testid="'tasks-today-' + task.id"
            class="flex min-h-12 w-full items-center gap-2 rounded-2xl border-2 border-cream bg-card px-3 py-2 text-left active:scale-[0.99] disabled:opacity-60"
            :disabled="locked(task.unlockLevel)"
            @click="start(task.id, task.unlockLevel)"
          >
            <span class="text-2xl" aria-hidden="true">{{ task.emoji }}</span>
            <span class="min-w-0 flex-1 truncate text-base font-bold text-ink">{{ task.title }}</span>
            <span v-if="locked(task.unlockLevel)" class="text-base text-gold" aria-hidden="true">🔒</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- 全部玩法：按早/中/晚分组，一个任务只出现一次 -->
    <section data-testid="tasks-all" class="mt-6">
      <h2 class="text-lg font-bold text-ink">{{ t('tasks.all') }}</h2>

      <div v-for="group in groups" :key="group.slot" class="mt-4">
        <h3 class="border-b-2 border-dashed border-cream pb-1 text-base font-bold text-bamboo-deep">
          {{ t(SLOT_LABEL_KEYS[group.slot]) }}
        </h3>

        <ul class="mt-3 grid gap-3">
          <li
            v-for="task in group.tasks"
            :key="task.id"
            :data-testid="'task-card-' + task.id"
            class="rounded-3xl border-2 border-cream bg-card p-4"
          >
            <div class="flex items-start gap-3">
              <span class="text-3xl" aria-hidden="true">{{ task.emoji }}</span>
              <div class="min-w-0 flex-1">
                <h4 class="text-lg font-bold text-ink">{{ task.title }}</h4>
                <p class="text-base text-inksoft">
                  {{ t('tasks.duration', { n: task.durationHintSec }) }} · {{ task.habit }}
                </p>
                <p class="mt-1 flex flex-wrap items-center gap-2 text-base">
                  <span
                    :data-testid="'task-stars-' + task.id"
                    class="text-lg tracking-widest text-gold"
                    :aria-label="t('complete.stars', { n: progress.starsFor(task.id) })"
                  >
                    {{ starText(task.id) }}
                  </span>
                  <span
                    v-if="progress.completionsFor(task.id) > 0"
                    :data-testid="'task-completions-' + task.id"
                    class="rounded-full bg-cream px-2 py-0.5 text-inksoft"
                  >
                    {{ t('tasks.completions', { n: progress.completionsFor(task.id) }) }}
                  </span>
                  <span
                    v-if="progress.streakFor(task.id) > 0"
                    class="rounded-full bg-mint px-2 py-0.5 text-bamboo-deep"
                  >
                    🔥 {{ t('tasks.streak', { n: progress.streakFor(task.id) }) }}
                  </span>
                  <span
                    v-if="progress.hasSticker(task.id)"
                    class="rounded-full bg-cream px-2 py-0.5 text-gold"
                  >
                    🏅 {{ t('tasks.sticker') }}
                  </span>
                  <span
                    v-if="progress.completedToday(task.id)"
                    :data-testid="'task-done-' + task.id"
                    class="rounded-full bg-mint px-2 py-0.5 font-bold text-bamboo-deep"
                  >
                    ✅ {{ t('tasks.done') }}
                  </span>
                </p>

                <p
                  v-if="locked(task.unlockLevel)"
                  :data-testid="'task-locked-' + task.id"
                  class="mt-2 rounded-2xl bg-cream px-3 py-2 text-base text-gold"
                >
                  🔒 {{ t('tasks.locked') }} · {{ t('tasks.lockedAt', { n: task.unlockLevel }) }}
                </p>
              </div>
            </div>

            <button
              type="button"
              :data-testid="'task-start-' + task.id"
              class="mt-3 min-h-12 w-full rounded-full px-4 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-60"
              :class="locked(task.unlockLevel) ? 'bg-grey' : 'bg-bamboo-deep'"
              :disabled="locked(task.unlockLevel)"
              @click="start(task.id, task.unlockLevel)"
            >
              {{ progress.completedToday(task.id) ? t('tasks.repeat') : t('tasks.start') }}
            </button>
          </li>
        </ul>
      </div>
    </section>
  </section>
</template>