import { z } from 'zod';
import { ORDER_ICONS, ROOMS } from './common';
import { stepProgressOf } from './layout';
import type { StepProgress } from './layout';

/**
 * 睡前顺序：关灯 / 拉窗帘 / 盖被子 / 拍拍哄睡，要按顺序来。
 * 顺序错了不清空进度 —— 只把刚点的那个晃一晃，孩子接着点对的就好。
 */
export const orderLevelSchema = z.object({
  room: z.enum(ROOMS),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        icon: z.enum(ORDER_ICONS),
        label: z.string().min(1).max(24),
      }),
    )
    .min(3)
    .max(5),
});
export type OrderLevel = z.infer<typeof orderLevelSchema>;

export interface OrderState {
  next: number;
  completed: string[];
}

export type OrderStatus = 'correct' | 'wrong' | 'complete';

export function createOrderState(): OrderState {
  return { next: 0, completed: [] };
}

export function currentStep(state: OrderState, level: OrderLevel) {
  return level.steps[state.next];
}

export function tapStep(state: OrderState, level: OrderLevel, stepId: string): { state: OrderState; status: OrderStatus } {
  const step = currentStep(state, level);
  if (!step) return { state, status: 'complete' };
  if (step.id !== stepId) return { state, status: 'wrong' };
  const completed = [...state.completed, step.id];
  const next = state.next + 1;
  if (next >= level.steps.length) return { state: { next, completed }, status: 'complete' };
  return { state: { next, completed }, status: 'correct' };
}

export function orderComplete(state: OrderState, level: OrderLevel): boolean {
  return state.next >= level.steps.length;
}

/** 步骤进度（数据侧，UI 用它画顶部圆点）：index 从 1 开始，全部做完停在 total */
export function stepProgress(state: OrderState, level: OrderLevel): StepProgress {
  return stepProgressOf(state.completed.length, level.steps.length);
}