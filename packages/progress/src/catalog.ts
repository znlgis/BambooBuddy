import type { ClothingSlot, PetState, RoomSlot } from '@bamboo/game-kit';

export type CatalogSlot = ClothingSlot | RoomSlot;

export interface CatalogItem {
  id: string;
  slot: CatalogSlot;
  name: string;
  /** 英文界面显示名（与 name 一一对应） */
  nameEn: string;
  emoji: string;
  costShoots: number;
  costFragments: number;
  /** 需要的成长阶段（1–4）：以"竹竹长大一点"为门槛，不以付费为门槛 */
  unlockLevel: 1 | 2 | 3 | 4;
  /** 免费自带的默认物件：不需要解锁，也不能"卖掉" */
  default?: boolean;
}

export const CLOTHING_SLOTS: readonly ClothingSlot[] = ['hat', 'bib', 'outfit', 'backpack', 'shoes'];
export const ROOM_SLOTS: readonly RoomSlot[] = ['wallpaper', 'bed', 'shelf', 'toyCorner', 'rug'];

export const CLOTHING_SLOT_NAMES: Record<ClothingSlot, string> = {
  hat: '帽子',
  bib: '围兜',
  outfit: '衣服',
  backpack: '小书包',
  shoes: '小鞋子',
};

export const ROOM_SLOT_NAMES: Record<RoomSlot, string> = {
  wallpaper: '墙纸',
  bed: '小床',
  shelf: '书架',
  toyCorner: '玩具角',
  rug: '地毯',
};

/**
 * 装扮与小窝目录：全部以"玩出来的竹笋/碎片"解锁，**没有抽卡、没有付费**。
 * 默认物件免费自带，保证新玩家的小屋不是一片空白。
 */
export const CATALOG: readonly CatalogItem[] = [
  // ---------- 衣服 ----------
  { id: 'hat-bamboo', slot: 'hat', name: '竹叶帽', nameEn: 'Bamboo Leaf Hat', emoji: '🎋', costShoots: 8, costFragments: 0, unlockLevel: 1 },
  { id: 'hat-straw', slot: 'hat', name: '小草帽', nameEn: 'Straw Hat', emoji: '👒', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'hat-crown', slot: 'hat', name: '小皇冠', nameEn: 'Little Crown', emoji: '👑', costShoots: 16, costFragments: 1, unlockLevel: 3 },
  { id: 'bib-star', slot: 'bib', name: '星星围兜', nameEn: 'Star Bib', emoji: '⭐', costShoots: 6, costFragments: 0, unlockLevel: 1 },
  { id: 'bib-bamboo', slot: 'bib', name: '竹子围兜', nameEn: 'Bamboo Bib', emoji: '🍃', costShoots: 10, costFragments: 0, unlockLevel: 2 },
  { id: 'bib-flower', slot: 'bib', name: '小花围兜', nameEn: 'Flower Bib', emoji: '🌸', costShoots: 14, costFragments: 1, unlockLevel: 3 },
  { id: 'outfit-pjs', slot: 'outfit', name: '星星睡衣', nameEn: 'Star Pyjamas', emoji: '🌙', costShoots: 14, costFragments: 1, unlockLevel: 2 },
  { id: 'outfit-rain', slot: 'outfit', name: '小雨衣', nameEn: 'Raincoat', emoji: '🌧️', costShoots: 18, costFragments: 2, unlockLevel: 3 },
  { id: 'backpack-red', slot: 'backpack', name: '小红书包', nameEn: 'Red Backpack', emoji: '🎒', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'backpack-leaf', slot: 'backpack', name: '竹叶小包', nameEn: 'Leaf Pouch', emoji: '🍀', costShoots: 16, costFragments: 1, unlockLevel: 3 },
  { id: 'shoes-red', slot: 'shoes', name: '小红鞋', nameEn: 'Red Shoes', emoji: '👟', costShoots: 10, costFragments: 0, unlockLevel: 2 },
  { id: 'shoes-green', slot: 'shoes', name: '小绿鞋', nameEn: 'Green Shoes', emoji: '🥿', costShoots: 15, costFragments: 1, unlockLevel: 3 },
  // ---------- 小窝 ----------
  { id: 'room-wall-cream', slot: 'wallpaper', name: '米白墙', nameEn: 'Cream Wall', emoji: '🏠', costShoots: 0, costFragments: 0, unlockLevel: 1, default: true },
  { id: 'room-wall-forest', slot: 'wallpaper', name: '竹林墙纸', nameEn: 'Bamboo Wallpaper', emoji: '🎍', costShoots: 20, costFragments: 0, unlockLevel: 3 },
  { id: 'room-rug-green', slot: 'rug', name: '竹绿地毯', nameEn: 'Bamboo Rug', emoji: '🟩', costShoots: 0, costFragments: 0, unlockLevel: 1, default: true },
  { id: 'room-rug-flower', slot: 'rug', name: '小花地毯', nameEn: 'Flower Rug', emoji: '🌼', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'room-bed-cloud', slot: 'bed', name: '云朵床', nameEn: 'Cloud Bed', emoji: '☁️', costShoots: 18, costFragments: 2, unlockLevel: 2 },
  { id: 'room-shelf', slot: 'shelf', name: '小书架', nameEn: 'Little Bookshelf', emoji: '📚', costShoots: 16, costFragments: 0, unlockLevel: 3 },
  { id: 'room-toy', slot: 'toyCorner', name: '玩具角', nameEn: 'Toy Corner', emoji: '🧸', costShoots: 22, costFragments: 2, unlockLevel: 3 },
];

export function findItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

export function itemsForSlot(slot: CatalogSlot): CatalogItem[] {
  return CATALOG.filter((item) => item.slot === slot);
}

/** 免费自带的物件：新玩家一进来就有墙纸和地毯，小窝不是一片空白 */
export function defaultEquipment(): { equipped: PetState['equipped']; room: PetState['room'] } {
  const equipped: PetState['equipped'] = {};
  const room: PetState['room'] = { wallpaper: 'room-wall-cream', rug: 'room-rug-green' };
  return { equipped, room };
}

/** 拥有 = 免费自带 或 已经解锁 */
export function ownsItem(pet: Pick<PetState, 'unlocked'>, item: CatalogItem): boolean {
  return item.default === true || pet.unlocked.includes(item.id);
}

/* ------------------------------------------------------------------ *
 * 累计里程碑（P1-4）：做到第 1/5/10/20/30/50 件小事时的一次成长纪念
 * ------------------------------------------------------------------ */

/**
 * 里程碑的静态目录：和装扮目录一样，中英标题各一份（name / nameEn 的同一套口径）、不带 emoji。
 *
 * 为什么用「累计」而不是「连续」：连续天数会把一天没玩变成一次损失，4–8 岁理解不了这种惩罚；
 * 累计只增不减，断签也一根竹笋不少。文案不写进 i18n 表：它是存档口径的一部分，
 * 由 progress 包自己带着中英两份，界面按当前语言挑。
 */
export interface Milestone {
  /** 累计做到多少件小事时达成 */
  at: number;
  title: string;
  titleEn: string;
}

export const MILESTONES: readonly Milestone[] = [
  { at: 1, title: '第一件小事', titleEn: 'First Little Thing' },
  { at: 5, title: '五件小事', titleEn: 'Five Little Things' },
  { at: 10, title: '十件小事', titleEn: 'Ten Little Things' },
  { at: 20, title: '二十件小事', titleEn: 'Twenty Little Things' },
  { at: 30, title: '三十件小事', titleEn: 'Thirty Little Things' },
  { at: 50, title: '五十件小事', titleEn: 'Fifty Little Things' },
];

/** 安全的累计数：NaN / 负数 / 小数都夹成非负整数（坏档不参与判定） */
function safeTotal(total: number): number {
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}

/** 这个累计数已经跨过的里程碑（按 at 升序）；新玩家 / 坏输入返回空数组 */
export function milestonesFor(total: number): Milestone[] {
  const safe = safeTotal(total);
  return MILESTONES.filter((milestone) => milestone.at <= safe);
}

/** 下一个还没达成的里程碑；全部达成后返回 null（到顶后仍然可以继续做小事） */
export function nextMilestoneFor(total: number): Milestone | null {
  const safe = safeTotal(total);
  return MILESTONES.find((milestone) => milestone.at > safe) ?? null;
}