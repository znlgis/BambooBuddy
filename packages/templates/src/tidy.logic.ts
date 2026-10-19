import { z } from 'zod';
import { hexSchema, normalized, ROOMS, TOY_KINDS } from './common';

/**
 * 整理：把地上的玩具按类别放回箱子（球 / 积木 / 书 / 小车）。
 * 颜色只是装饰，类别靠"形状 + 箱子上的图标"区分 —— 不靠颜色单独传达信息（色盲友好）。
 */
export const tidyLevelSchema = z.object({
  room: z.enum(ROOMS),
  bins: z
    .array(
      z.object({
        kind: z.enum(TOY_KINDS),
        label: z.string().min(1).max(6),
        color: hexSchema,
      }),
    )
    .min(2)
    .max(4),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(TOY_KINDS),
        color: hexSchema,
        x: normalized,
        y: normalized,
      }),
    )
    .min(4)
    .max(10),
});
export type TidyLevel = z.infer<typeof tidyLevelSchema>;
export type ToyKind = (typeof TOY_KINDS)[number];

export type TidyState = { sorted: Record<string, ToyKind> };

export interface TidyResult {
  state: TidyState;
  status: 'correct' | 'wrong' | 'already';
}

export function createTidyState(): TidyState {
  return { sorted: {} };
}

export function tidyItem(level: TidyLevel, itemId: string) {
  return level.items.find((item) => item.id === itemId);
}

export function tryTidy(state: TidyState, level: TidyLevel, itemId: string, binKind: ToyKind): TidyResult {
  const item = tidyItem(level, itemId);
  if (!item) return { state, status: 'wrong' };
  if (state.sorted[itemId] === item.kind) return { state, status: 'already' };
  if (item.kind !== binKind) return { state, status: 'wrong' };
  return { state: { sorted: { ...state.sorted, [itemId]: item.kind } }, status: 'correct' };
}

export function tidyComplete(state: TidyState, level: TidyLevel): boolean {
  return level.items.every((item) => state.sorted[item.id] === item.kind);
}

export function tidyProgress(state: TidyState, level: TidyLevel): number {
  return level.items.length === 0 ? 1 : Object.keys(state.sorted).length / level.items.length;
}
