import { z } from 'zod';
import { hexSchema, ROOMS, SHAPES } from './common';

/**
 * 轻认知：认颜色 / 形状 / 数字。点选，不写字（4–8 岁）。
 * 选错只是"再想想"，同一题可以一直重试，直到选对。
 */
export const learnLevelSchema = z.object({
  room: z.enum(ROOMS),
  rounds: z
    .array(
      z.object({
        kind: z.enum(['color', 'shape', 'number']),
        question: z.string().min(1).max(24),
        options: z
          .array(
            z.object({
              label: z.string().min(1).max(3),
              color: hexSchema.optional(),
              shape: z.enum(SHAPES).optional(),
            }),
          )
          .min(2)
          .max(4),
        answer: z.number().int().min(0),
      }),
    )
    .min(2)
    .max(4),
});
export type LearnLevel = z.infer<typeof learnLevelSchema>;
export type Shape = (typeof SHAPES)[number];

export interface LearnState {
  round: number;
  done: boolean;
}

export function createLearnState(): LearnState {
  return { round: 0, done: false };
}

export function currentQuestion(state: LearnState, level: LearnLevel) {
  return level.rounds[state.round];
}

export type LearnStatus = 'correct' | 'wrong' | 'done';

export function chooseOption(state: LearnState, level: LearnLevel, index: number): { state: LearnState; status: LearnStatus } {
  if (state.done) return { state, status: 'done' };
  const question = currentQuestion(state, level);
  if (!question) return { state: { ...state, done: true }, status: 'done' };
  if (index !== question.answer) return { state, status: 'wrong' };
  const nextRound = state.round + 1;
  if (nextRound >= level.rounds.length) {
    return { state: { ...state, round: nextRound, done: true }, status: 'done' };
  }
  return { state: { ...state, round: nextRound }, status: 'correct' };
}
