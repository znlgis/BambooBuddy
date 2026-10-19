import { z } from 'zod';
import { normalized, ROOMS } from './common';

const SPOT_KINDS = ['germ', 'dirt', 'foam'] as const;

/**
 * 刷洗类玩法（刷牙 / 洗手 / 洗澡）：工具在目标区域来回刷，把点点刷干净。
 * 零失败：刷不干净永远可以再刷；只有"刷完了"这一种结束条件。
 */
export const scrubLevelSchema = z.object({
  room: z.enum(ROOMS),
  tool: z.enum(['brush', 'sponge', 'hands', 'towel']),
  spots: z
    .array(
      z.object({
        id: z.string().min(1),
        x: normalized,
        y: normalized,
        /** 大小系数：1 = 默认半径 */
        size: z.number().min(0.5).max(1.6),
        kind: z.enum(SPOT_KINDS),
      }),
    )
    .min(4)
    .max(12),
  /** 每个点要来回刷几次才干净 */
  rubs: z.number().int().min(1).max(5),
  /** 刷干净之后的收尾动作（冲水 / 擦干） */
  finish: z
    .object({
      kind: z.enum(['rinse', 'wipe']),
      taps: z.number().int().min(1).max(12),
    })
    .optional(),
});
export type ScrubLevel = z.infer<typeof scrubLevelSchema>;

export interface ScrubState {
  /** spotId → 已经刷了几下 */
  cleaned: Record<string, number>;
  finishTaps: number;
  done: boolean;
}

export function createScrubState(level: ScrubLevel): ScrubState {
  const cleaned: Record<string, number> = {};
  for (const spot of level.spots) cleaned[spot.id] = 0;
  return { cleaned, finishTaps: 0, done: false };
}

export function scrubProgress(state: ScrubState, level: ScrubLevel): number {
  const total = level.spots.length * level.rubs;
  const current = level.spots.reduce((sum, spot) => sum + Math.min(level.rubs, state.cleaned[spot.id] ?? 0), 0);
  return total === 0 ? 1 : current / total;
}

export function allSpotsClean(state: ScrubState, level: ScrubLevel): boolean {
  return level.spots.every((spot) => (state.cleaned[spot.id] ?? 0) >= level.rubs);
}

export interface ScrubHit {
  state: ScrubState;
  /** 这一下刷到的点（没刷到为 null） */
  hitId: string | null;
  /** 因为这一下变干净的点 */
  cleanedNow: string[];
}

/**
 * 在目标区域里刷一下。x / y 是 0–1 的相对坐标（模板把指针换算进来）。
 * 判定按"最近且在半径内"取一个点：孩子刷得歪也能算数，但不会一下刷干净所有点。
 */
export function scrubAt(
  state: ScrubState,
  level: ScrubLevel,
  x: number,
  y: number,
): ScrubHit {
  let hit: (typeof level.spots)[number] | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const spot of level.spots) {
    const radius = 0.11 * spot.size;
    const dist = Math.hypot(x - spot.x, y - spot.y);
    if (dist <= radius && dist < best) {
      best = dist;
      hit = spot;
    }
  }
  if (!hit) return { state, hitId: null, cleanedNow: [] };
  if ((state.cleaned[hit.id] ?? 0) >= level.rubs) return { state, hitId: hit.id, cleanedNow: [] };
  const cleanedNow: string[] = [];
  const cleaned = { ...state.cleaned, [hit.id]: (state.cleaned[hit.id] ?? 0) + 1 };
  if (cleaned[hit.id]! >= level.rubs) cleanedNow.push(hit.id);
  const next: ScrubState = { ...state, cleaned };
  return { state: next, hitId: hit.id, cleanedNow };
}

/** 刷干净之后的收尾：冲/擦够次数就完成 */
export function finishTap(state: ScrubState, level: ScrubLevel): { state: ScrubState; done: boolean } {
  if (!allSpotsClean(state, level)) return { state, done: false };
  const taps = level.finish?.taps ?? 0;
  if (taps === 0) return { state: { ...state, done: true }, done: true };
  const finishTaps = state.finishTaps + 1;
  const done = finishTaps >= taps;
  return { state: { ...state, finishTaps, done }, done };
}

export function isScrubComplete(state: ScrubState, level: ScrubLevel): boolean {
  if (!allSpotsClean(state, level)) return false;
  const taps = level.finish?.taps ?? 0;
  return taps === 0 || state.finishTaps >= taps;
}
