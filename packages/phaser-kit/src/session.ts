import type { Stars } from '@bamboo/game-kit';

export interface SessionState {
  mistakes: number;
  correct: number;
  total: number;
  startedAt: number;
}

export function createSessionState(now: number): SessionState {
  return { mistakes: 0, correct: 0, total: 0, startedAt: now };
}

export function noteCorrect(session: SessionState, count = 1): void {
  session.correct += count;
  session.total += count;
}

export function noteMistake(session: SessionState): void {
  session.mistakes += 1;
}

/** 与 progress 的 starsFor 同一口径（模板包不 import 存档层，避免把迁移逻辑带进游戏 chunk） */
export function starsForSession(session: SessionState): Stars {
  if (session.mistakes <= 1) return 3;
  if (session.mistakes <= 3) return 2;
  return 1;
}

/** 中文文案按 5 字/秒估算"读一遍"的时间（无语音设备上兜底用） */
export function readingMs(text: string): number {
  const seconds = Math.max(1.2, text.length / 5);
  return Math.min(12_000, seconds * 1000);
}
