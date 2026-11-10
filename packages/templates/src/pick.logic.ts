import { z } from 'zod';
import { CARE_KINDS, EMOTIONS, ROOMS } from './common';

/**
 * 情绪认知：先认出竹竹现在的心情（三张脸里选一张），
 * 再安慰他（抱抱 / 拍拍 / 击掌）。选错不惩罚，只是换一句提示。
 */
export const pickLevelSchema = z
  .object({
    room: z.enum(ROOMS),
    rounds: z
      .array(
        z.object({
          target: z.enum(EMOTIONS),
          question: z.string().min(1).max(80),
          options: z.array(z.enum(EMOTIONS)).length(3),
          comfort: z.enum(CARE_KINDS),
        }),
      )
      .min(2)
      .max(3),
  })
  .superRefine((level, ctx) => {
    level.rounds.forEach((round, index) => {
      if (!round.options.includes(round.target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rounds', index, 'options'],
          message: `选项里必须包含正确答案 ${round.target}`,
        });
      }
      if (new Set(round.options).size !== round.options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['rounds', index, 'options'],
          message: '选项不能重复',
        });
      }
    });
  });
export type PickLevel = z.infer<typeof pickLevelSchema>;
export type Emotion = (typeof EMOTIONS)[number];
export type CareKind = (typeof CARE_KINDS)[number];

export interface PickState {
  round: number;
  phase: 'choose' | 'comfort';
  done: boolean;
}

export function createPickState(): PickState {
  return { round: 0, phase: 'choose', done: false };
}

export function currentRound(state: PickState, level: PickLevel) {
  return level.rounds[state.round];
}

export type ChooseStatus = 'correct' | 'wrong' | 'comfort' | 'done';

/** 选出情绪：对了进入"安慰"阶段；最后一轮安慰完即完成 */
export function chooseEmotion(state: PickState, level: PickLevel, emotion: Emotion): { state: PickState; status: ChooseStatus } {
  if (state.phase !== 'choose') return { state, status: state.done ? 'done' : 'comfort' };
  const round = currentRound(state, level);
  if (!round) return { state: { ...state, done: true, phase: 'comfort' }, status: 'done' };
  if (emotion !== round.target) return { state, status: 'wrong' };
  return { state: { ...state, phase: 'comfort' }, status: 'comfort' };
}

export function comfort(state: PickState, level: PickLevel): { state: PickState; finished: boolean } {
  // 已完成后再点安慰按钮（完成卡正在弹出时的补点）不能再来一次 finished：
  // 场景层有 done / comfortVisible 守卫，这里再兜一层，任何调用方都不会重复结算。
  if (state.done) return { state, finished: false };
  if (state.phase !== 'comfort') return { state, finished: false };
  const nextRound = state.round + 1;
  if (nextRound >= level.rounds.length) {
    return { state: { ...state, done: true }, finished: true };
  }
  return { state: { ...state, round: nextRound, phase: 'choose' }, finished: false };
}

export function pickComplete(state: PickState): boolean {
  return state.done;
}

/** 安慰动作本身不携带文案：按钮文字走 @bamboo/i18n 的 comfort.* 键（中英各一份） */