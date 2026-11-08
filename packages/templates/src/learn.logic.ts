import { z } from 'zod';
import { hexSchema, ROOMS, SHAPES } from './common';

/**
 * 轻认知：认颜色 / 形状 / 数字。点选，不写字（4–8 岁）。
 * 选错只是"再想想"，同一题可以一直重试，直到选对。
 *
 * answer 必须落在选项下标范围内：越界的 answer 会让 chooseOption 永远判错，
 * 孩子点什么都没反应、整局卡死（软锁）。schema 管住形状，check-content 再兜一层语义。
 */
export const learnLevelSchema = z
  .object({
    room: z.enum(ROOMS),
    rounds: z
      .array(
        z.object({
          kind: z.enum(['color', 'shape', 'number']),
          question: z.string().min(1).max(80),
          options: z
            .array(
              z.object({
                label: z.string().min(1).max(8),
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
  })
  .superRefine((level, ctx) => {
    level.rounds.forEach((round, index) => {
      if (round.answer >= round.options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['rounds', index, 'answer'],
          message: `answer 必须在选项下标范围内（0–${round.options.length - 1}），实际 ${round.answer}`,
        });
      }
    });
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
  // 兜底：answer 越界（内容写坏 / 运行时数据不干净）时任何一下都算对。
  // 宁可「这一题白送」，也不能让孩子点什么都没反应、整局永远打不完。
  const answerInRange =
    Number.isInteger(question.answer) &&
    question.answer >= 0 &&
    question.answer < question.options.length;
  if (answerInRange && index !== question.answer) return { state, status: 'wrong' };
  const nextRound = state.round + 1;
  if (nextRound >= level.rounds.length) {
    return { state: { ...state, round: nextRound, done: true }, status: 'done' };
  }
  return { state: { ...state, round: nextRound }, status: 'correct' };
}