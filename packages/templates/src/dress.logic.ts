import { z } from 'zod';
import { CLOTHING_KINDS, hexSchema, normalized, ROOMS } from './common';

/**
 * 穿衣：给竹竹挑一件、拖到它该去的地方（帽子→头、围兜→胸口、书包→背后、鞋→脚）。
 * 放错不惩罚，只是弹回去并温柔提示"再试一次"。
 */
export const dressLevelSchema = z.object({
  room: z.enum(ROOMS),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        slot: z.enum(CLOTHING_KINDS),
        color: hexSchema,
        x: normalized,
        y: normalized,
      }),
    )
    .min(3)
    .max(5),
});
export type DressLevel = z.infer<typeof dressLevelSchema>;
export type ClothingKind = (typeof CLOTHING_KINDS)[number];

/** itemId → 已经穿上的槽位 */
export type DressState = Record<string, ClothingKind>;

export interface DressResult {
  state: DressState;
  status: 'correct' | 'wrong' | 'already';
}

export function createDressState(): DressState {
  return {};
}

export function dressItem(level: DressLevel, itemId: string) {
  return level.items.find((item) => item.id === itemId);
}

export function tryDress(state: DressState, level: DressLevel, itemId: string, slot: ClothingKind): DressResult {
  const item = dressItem(level, itemId);
  if (!item) return { state, status: 'wrong' };
  if (state[itemId] === item.slot) return { state, status: 'already' };
  if (item.slot !== slot) return { state, status: 'wrong' };
  return { state: { ...state, [itemId]: item.slot }, status: 'correct' };
}

export function dressComplete(state: DressState, level: DressLevel): boolean {
  return level.items.every((item) => state[item.id] === item.slot);
}

export function wornSlots(state: DressState): ClothingKind[] {
  return [...new Set(Object.values(state))];
}
