import { z } from 'zod';
import { ROOMS } from './common';

/**
 * 运动节奏：竹竿一开一合，看准打开的时机点一下"跳过去"。
 * 纯判定只用墙钟（elapsed）—— 与 CHAGS 的教训一致：不累加帧 delta，
 * 慢手机与 CI 上结果一致，测试也能确定性地断言。
 */
export const rhythmLevelSchema = z.object({
  room: z.enum(ROOMS),
  /** 每分钟节拍数（60–120，越低越慢越好点） */
  bpm: z.number().int().min(60).max(120),
  /** 要跳过去几次 */
  jumps: z.number().int().min(5).max(15),
  /** 判定窗口宽度：占整条进度条的 0.15–0.5 */
  zone: z.number().min(0.15).max(0.5),
});
export type RhythmLevel = z.infer<typeof rhythmLevelSchema>;

export interface RhythmState {
  hits: number;
  misses: number;
  streak: number;
  bestStreak: number;
  lastTapAt: number;
}

export function createRhythmState(): RhythmState {
  return { hits: 0, misses: 0, streak: 0, bestStreak: 0, lastTapAt: Number.NEGATIVE_INFINITY };
}

/** 一个来回（左→右→左）的时长：让指针速度与节拍一致 */
export function cycleMs(level: RhythmLevel): number {
  return (60_000 / level.bpm) * 2;
}

/** 指针位置 0–1（三角波）；每个来回经过中心两次，正好对应"竹竿打开" */
export function pointerPosition(elapsedMs: number, level: RhythmLevel): number {
  const cycle = cycleMs(level);
  const phase = ((elapsedMs % cycle) + cycle) % cycle;
  const half = cycle / 2;
  return phase <= half ? phase / half : 1 - (phase - half) / half;
}

/** 判定窗口居中；两端各留一点余量，避免卡在边缘的"看起来在里面但判定不到" */
export function isInZone(elapsedMs: number, level: RhythmLevel): boolean {
  const pos = pointerPosition(elapsedMs, level);
  const half = level.zone / 2;
  return Math.abs(pos - 0.5) <= half;
}

export function zoneRange(level: RhythmLevel): { from: number; to: number } {
  return { from: 0.5 - level.zone / 2, to: 0.5 + level.zone / 2 };
}

/** 连击越高，音调越高 —— 进步是听得见的 */
export function jumpTone(state: RhythmState): number {
  return 440 + Math.min(state.streak, 8) * 45;
}

export interface RhythmTap {
  state: RhythmState;
  hit: boolean;
  /** 点得太快（220ms 内连点）不计分也不计错 */
  ignored: boolean;
  tone: number;
}

export const TAP_GATE_MS = 220;

export function registerTap(state: RhythmState, elapsedMs: number, level: RhythmLevel, now: number): RhythmTap {
  if (now - state.lastTapAt < TAP_GATE_MS) {
    return { state, hit: false, ignored: true, tone: jumpTone(state) };
  }
  const hit = isInZone(elapsedMs, level);
  const next: RhythmState = hit
    ? {
        ...state,
        hits: state.hits + 1,
        streak: state.streak + 1,
        bestStreak: Math.max(state.bestStreak, state.streak + 1),
        lastTapAt: now,
      }
    : {
        ...state,
        misses: state.misses + 1,
        streak: 0,
        lastTapAt: now,
      };
  return { state: next, hit, ignored: false, tone: jumpTone(next) };
}

export function rhythmComplete(state: RhythmState, level: RhythmLevel): boolean {
  return state.hits >= level.jumps;
}

/** 无头验证：等到窗口打开就点（与真实操作共用 registerTap 与 isInZone） */
export function nextHitDelay(elapsedMs: number, level: RhythmLevel): number {
  if (isInZone(elapsedMs, level)) return 0;
  const cycle = cycleMs(level);
  const target = 0.5 * (cycle / 2);
  const phase = ((elapsedMs % cycle) + cycle) % cycle;
  return phase < target ? target - phase : cycle - phase + target;
}
