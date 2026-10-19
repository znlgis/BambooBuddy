import type { ClothingSlot, PetState, RoomSlot } from '@bamboo/game-kit';

export type CatalogSlot = ClothingSlot | RoomSlot;

export interface CatalogItem {
  id: string;
  slot: CatalogSlot;
  name: string;
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
  { id: 'hat-bamboo', slot: 'hat', name: '竹叶帽', emoji: '🎋', costShoots: 8, costFragments: 0, unlockLevel: 1 },
  { id: 'hat-straw', slot: 'hat', name: '小草帽', emoji: '👒', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'hat-crown', slot: 'hat', name: '小皇冠', emoji: '👑', costShoots: 16, costFragments: 1, unlockLevel: 3 },
  { id: 'bib-star', slot: 'bib', name: '星星围兜', emoji: '⭐', costShoots: 6, costFragments: 0, unlockLevel: 1 },
  { id: 'bib-bamboo', slot: 'bib', name: '竹子围兜', emoji: '🍃', costShoots: 10, costFragments: 0, unlockLevel: 2 },
  { id: 'bib-flower', slot: 'bib', name: '小花围兜', emoji: '🌸', costShoots: 14, costFragments: 1, unlockLevel: 3 },
  { id: 'outfit-pjs', slot: 'outfit', name: '星星睡衣', emoji: '🌙', costShoots: 14, costFragments: 1, unlockLevel: 2 },
  { id: 'outfit-rain', slot: 'outfit', name: '小雨衣', emoji: '🌧️', costShoots: 18, costFragments: 2, unlockLevel: 3 },
  { id: 'backpack-red', slot: 'backpack', name: '小红书包', emoji: '🎒', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'backpack-leaf', slot: 'backpack', name: '竹叶小包', emoji: '🍀', costShoots: 16, costFragments: 1, unlockLevel: 3 },
  { id: 'shoes-red', slot: 'shoes', name: '小红鞋', emoji: '👟', costShoots: 10, costFragments: 0, unlockLevel: 2 },
  { id: 'shoes-green', slot: 'shoes', name: '小绿鞋', emoji: '🥿', costShoots: 15, costFragments: 1, unlockLevel: 3 },
  // ---------- 小窝 ----------
  { id: 'room-wall-cream', slot: 'wallpaper', name: '米白墙', emoji: '🏠', costShoots: 0, costFragments: 0, unlockLevel: 1, default: true },
  { id: 'room-wall-forest', slot: 'wallpaper', name: '竹林墙纸', emoji: '🎍', costShoots: 20, costFragments: 0, unlockLevel: 3 },
  { id: 'room-rug-green', slot: 'rug', name: '竹绿地毯', emoji: '🟩', costShoots: 0, costFragments: 0, unlockLevel: 1, default: true },
  { id: 'room-rug-flower', slot: 'rug', name: '小花地毯', emoji: '🌼', costShoots: 12, costFragments: 0, unlockLevel: 2 },
  { id: 'room-bed-cloud', slot: 'bed', name: '云朵床', emoji: '☁️', costShoots: 18, costFragments: 2, unlockLevel: 2 },
  { id: 'room-shelf', slot: 'shelf', name: '小书架', emoji: '📚', costShoots: 16, costFragments: 0, unlockLevel: 3 },
  { id: 'room-toy', slot: 'toyCorner', name: '玩具角', emoji: '🧸', costShoots: 22, costFragments: 2, unlockLevel: 3 },
];

export function findItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

export function itemsForClothes(): CatalogItem[] {
  return CATALOG.filter((item) => CLOTHING_SLOTS.includes(item.slot as ClothingSlot));
}

export function itemsForRoom(): CatalogItem[] {
  return CATALOG.filter((item) => ROOM_SLOTS.includes(item.slot as RoomSlot));
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
