import { z } from 'zod';
import { FOOD_KINDS, normalized, ROOMS } from './common';

/**
 * 吃饭：把桌上的食物拖到竹竹嘴边，一口一口吃完。
 * 教育点是"不挑食、均衡饮食"：关卡的 needKinds 覆盖蔬菜/主食/水果等，
 * 全部吃完就自然吃到了各类食物；没有任何"不许吃"的惩罚。
 */
export const feedLevelSchema = z.object({
  room: z.enum(ROOMS),
  foods: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(FOOD_KINDS),
        /** 要拖几口才吃完（1–3，决定一局的总操作量） */
        bites: z.number().int().min(1).max(3),
        x: normalized,
        y: normalized,
      }),
    )
    .min(4)
    .max(8),
  /** 这一局要尝到的类别（用于显示"均衡"进度，不要求顺序） */
  needKinds: z.array(z.enum(FOOD_KINDS)).min(1).max(4),
});
export type FeedLevel = z.infer<typeof feedLevelSchema>;

/** 食物 id → 还剩几口 */
export type FeedState = Record<string, number>;

export interface FeedProgress {
  totalBites: number;
  eatenBites: number;
  finishedFoods: string[];
  kinds: string[];
  complete: boolean;
  balanced: boolean;
}

export function totalBites(level: FeedLevel): number {
  return level.foods.reduce((sum, food) => sum + food.bites, 0);
}

export function createFeedState(): FeedState {
  return {};
}

export function feedProgress(state: FeedState, level: FeedLevel): FeedProgress {
  const finishedFoods: string[] = [];
  const kinds = new Set<string>();
  let eatenBites = 0;
  for (const food of level.foods) {
    const left = state[food.id];
    const remaining = left === undefined ? food.bites : left;
    eatenBites += food.bites - remaining;
    if (remaining <= 0) {
      finishedFoods.push(food.id);
      kinds.add(food.kind);
    }
  }
  const total = totalBites(level);
  return {
    totalBites: total,
    eatenBites,
    finishedFoods,
    kinds: [...kinds],
    complete: eatenBites >= total,
    balanced: level.needKinds.every((kind) => kinds.has(kind)),
  };
}

/** 喂一口：食物没吃完就留在桌上，吃完了就消失 */
export function bite(state: FeedState, level: FeedLevel, foodId: string): { state: FeedState; left: number; finished: boolean } {
  const food = level.foods.find((item) => item.id === foodId);
  if (!food) return { state, left: 0, finished: false };
  const remaining = (state[foodId] ?? food.bites) - 1;
  const next: FeedState = { ...state, [foodId]: Math.max(0, remaining) };
  return { state: next, left: Math.max(0, remaining), finished: remaining <= 0 };
}
