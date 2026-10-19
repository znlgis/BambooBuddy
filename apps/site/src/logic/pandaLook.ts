import type { Stats } from '@bamboo/game-kit';

export type PandaMood = 'happy' | 'sleepy' | 'hungry' | 'dirty' | 'sad' | 'neutral';

export interface PandaFace {
  eyes: 'open' | 'closed';
  mouth: 'smile' | 'flat' | 'open' | 'frown';
  tear: boolean;
  dirt: boolean;
  sleepy: boolean;
}

/** 与 phaser-kit 的熊猫同一套配色：小屋与玩法里的竹竹必须是同一只 */
export const PANDA_COLORS = {
  white: '#fbf7ef',
  black: '#3b3a37',
  ink: '#4a3b2f',
  blush: '#f2b8ae',
  gold: '#e3b85a',
  bamboo: '#7aa05c',
  eyeShine: '#ffffff',
} as const;

/**
 * 状态 → 表情。只按最需要被照顾的那一项给一个温柔表情，
 * 不做"哪项最低就报错"的叠加（孩子一次只需要读懂一种情绪）。
 */
export function moodFromStats(stats: Stats): PandaMood {
  if (stats.energy < 40) return 'sleepy';
  if (stats.fullness < 40) return 'hungry';
  if (stats.clean < 40) return 'dirty';
  if (stats.mood < 40) return 'sad';
  return 'happy';
}

export function faceFor(mood: PandaMood): PandaFace {
  switch (mood) {
    case 'sleepy':
      return { eyes: 'closed', mouth: 'flat', tear: false, dirt: false, sleepy: true };
    case 'hungry':
      return { eyes: 'open', mouth: 'open', tear: false, dirt: false, sleepy: false };
    case 'dirty':
      return { eyes: 'open', mouth: 'flat', tear: false, dirt: true, sleepy: false };
    case 'sad':
      return { eyes: 'open', mouth: 'frown', tear: true, dirt: false, sleepy: false };
    case 'neutral':
      return { eyes: 'open', mouth: 'flat', tear: false, dirt: false, sleepy: false };
    default:
      return { eyes: 'open', mouth: 'smile', tear: false, dirt: false, sleepy: false };
  }
}

/**
 * 装扮颜色按 catalog id 决定。低饱和是硬要求：
 * 4–8 岁的孩子屏幕使用时间长，刺眼的红/紫容易让家长直接关掉应用。
 */
export function clothingColor(id: string | undefined): string {
  if (!id) return PANDA_COLORS.bamboo;
  if (id.startsWith('hat-straw') || id.startsWith('bib-star')) return '#e6c479';
  if (id.startsWith('hat-crown')) return '#d9b24c';
  if (id.startsWith('bib-flower')) return '#e8a79e';
  if (id.startsWith('outfit-pjs')) return '#b9b2d6';
  if (id.startsWith('outfit-rain')) return '#d9c48a';
  if (id.startsWith('backpack-red') || id.startsWith('shoes-red')) return '#d98070';
  return PANDA_COLORS.bamboo;
}

export type HatKind = 'bamboo' | 'straw' | 'crown';

/** 帽子形态也由 id 决定：竹叶帽 / 小草帽 / 小皇冠，画法完全不同 */
export function hatKind(id: string | undefined): HatKind | null {
  if (!id) return null;
  if (id.startsWith('hat-straw')) return 'straw';
  if (id.startsWith('hat-crown')) return 'crown';
  return 'bamboo';
}
