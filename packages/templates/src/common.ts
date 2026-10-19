import { z } from 'zod';

/** 关卡脚本里的相对坐标一律 0–1（相对模板给定的交互区域），换美术不用改内容 */
export const normalized = z.number().min(0).max(1);
export const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #rrggbb');

export const FOOD_KINDS = ['bamboo', 'veg', 'fruit', 'grain', 'protein', 'snack'] as const;
export type FoodKind = (typeof FOOD_KINDS)[number];

export const TOY_KINDS = ['ball', 'block', 'book', 'car'] as const;
export type ToyKind = (typeof TOY_KINDS)[number];

export const CLOTHING_KINDS = ['hat', 'bib', 'outfit', 'backpack', 'shoes'] as const;
export type ClothingKind = (typeof CLOTHING_KINDS)[number];

export const ORDER_ICONS = ['curtain', 'lamp', 'blanket', 'pat', 'clock', 'moon', 'teddy'] as const;
export type OrderIcon = (typeof ORDER_ICONS)[number];

export const EMOTIONS = ['happy', 'sad', 'angry', 'scared', 'sleepy'] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const SHAPES = ['circle', 'square', 'triangle', 'star', 'heart'] as const;
export type Shape = (typeof SHAPES)[number];

export const SCRUB_TOOLS = ['brush', 'sponge', 'hands', 'towel'] as const;
export type ScrubTool = (typeof SCRUB_TOOLS)[number];

export const CARE_KINDS = ['hug', 'pat', 'highfive'] as const;
export type CareKind = (typeof CARE_KINDS)[number];

export const ROOMS = ['bathroom', 'bedroom', 'kitchen', 'playroom', 'yard', 'closet', 'classroom', 'sink'] as const;
export type Room = (typeof ROOMS)[number];
