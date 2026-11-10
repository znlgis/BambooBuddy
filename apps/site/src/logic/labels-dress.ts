import type { ClothingSlot, RoomSlot } from '@bamboo/game-kit';
import type { MessageKey } from '@bamboo/i18n';

/**
 * 装扮页专用的槽位名映射。
 *
 * 与 labels.ts 分开，是因为装扮页是路由懒加载的：这张表只该跟装扮 chunk 一起下载，
 * 不该占小屋首屏的 60 KB 预算（首屏那条线只剩不到 1 KB）。
 */
export const CLOTHING_SLOT_KEYS: Record<ClothingSlot, MessageKey> = {
  hat: 'slot.hat',
  bib: 'slot.bib',
  outfit: 'slot.outfit',
  backpack: 'slot.backpack',
  shoes: 'slot.shoes',
};

export const ROOM_SLOT_KEYS: Record<RoomSlot, MessageKey> = {
  wallpaper: 'slot.wallpaper',
  bed: 'slot.bed',
  shelf: 'slot.shelf',
  toyCorner: 'slot.toyCorner',
  rug: 'slot.rug',
};
