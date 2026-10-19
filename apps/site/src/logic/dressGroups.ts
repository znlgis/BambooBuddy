import type { ClothingSlot, RoomSlot } from '@bamboo/game-kit';
import type { CatalogItem } from '@bamboo/progress';
import {
  CLOTHING_SLOTS,
  CLOTHING_SLOT_NAMES,
  ROOM_SLOTS,
  ROOM_SLOT_NAMES,
  itemsForSlot,
} from '@bamboo/progress';

export type DressTab = 'clothes' | 'room';

export interface DressGroup {
  slot: ClothingSlot | RoomSlot;
  title: string;
  items: CatalogItem[];
}

/**
 * 目录按部位分组（衣服：帽子/围兜/衣服/书包/鞋；小窝：墙纸/床/书架/玩具角/地毯）。
 * 空组直接不显示：目录以后只会加东西，现在没必要给空分类占位。
 */
export function dressGroups(tab: DressTab): DressGroup[] {
  if (tab === 'clothes') {
    return CLOTHING_SLOTS.map((slot) => ({
      slot,
      title: CLOTHING_SLOT_NAMES[slot],
      items: itemsForSlot(slot),
    })).filter((group) => group.items.length > 0);
  }
  return ROOM_SLOTS.map((slot) => ({
    slot,
    title: ROOM_SLOT_NAMES[slot],
    items: itemsForSlot(slot),
  })).filter((group) => group.items.length > 0);
}
