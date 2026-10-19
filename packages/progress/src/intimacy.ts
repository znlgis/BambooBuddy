import type { CareAction } from '@bamboo/game-kit';

/** 三个亲昵动作每天各能做一次；喂竹笋只看有没有竹笋 */
export const CARE_POINTS: Record<CareAction, number> = { pat: 1, hug: 2, highfive: 2 };
export const CARE_MOOD: Record<CareAction, number> = { pat: 3, hug: 5, highfive: 4 };

export interface IntimacyStep {
  /** 达到这一档所需的亲密度 */
  at: number;
  name: string;
  /** 这一档解锁的小动作（小屋里的竹竹会做） */
  gesture: string;
}

export const INTIMACY_STEPS: readonly IntimacyStep[] = [
  { at: 0, name: '初次见面', gesture: '招手' },
  { at: 5, name: '好朋友', gesture: '害羞捂脸' },
  { at: 12, name: '贴心伙伴', gesture: '转圈圈' },
  { at: 22, name: '形影不离', gesture: '击掌跳' },
  { at: 35, name: '最好的朋友', gesture: '比心' },
];

export interface IntimacyLevel {
  level: number;
  name: string;
  gesture: string;
  /** 下一档还要多少；到顶为 null */
  nextAt: number | null;
}

export function intimacyLevel(points: number): IntimacyLevel {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  let index = 0;
  for (let i = 0; i < INTIMACY_STEPS.length; i += 1) {
    if (safe >= INTIMACY_STEPS[i]!.at) index = i;
  }
  const current = INTIMACY_STEPS[index]!;
  const next = INTIMACY_STEPS[index + 1];
  return { level: index + 1, name: current.name, gesture: current.gesture, nextAt: next ? next.at : null };
}

/** 今天这个动作还能不能做 */
export function careAvailable(
  careDays: Partial<Record<CareAction, string>>,
  action: CareAction,
  today: string,
): boolean {
  return careDays[action] !== today;
}

export function unlockedGestures(points: number): string[] {
  const safe = Math.max(0, points);
  return INTIMACY_STEPS.filter((step) => safe >= step.at).map((step) => step.gesture);
}
