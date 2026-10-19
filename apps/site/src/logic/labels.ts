import type { CareAction, ClothingSlot, RoomSlot, StatKey, TaskId, TimeSlot } from '@bamboo/game-kit';
import type { MessageKey } from '@bamboo/i18n';

/**
 * 内容 id / 动作 → 文案键的映射表。
 * 为什么单独一张表：动态拼 'hint.' + id 在运行时能跑，但键名写错就没有 typecheck 兜底，
 * 这里用 Record<联合类型, MessageKey> 把"漏一条"变成编译错误。
 */
export const STAT_LABEL_KEYS: Record<StatKey, MessageKey> = {
  fullness: 'stat.fullness',
  energy: 'stat.energy',
  clean: 'stat.clean',
  mood: 'stat.mood',
  health: 'stat.health',
};

/** 五维状态条的颜色：低饱和的麦色/薰衣草/水蓝/腮红/竹绿，没有一项是刺眼的警戒红 */
export const STAT_COLORS: Record<StatKey, string> = {
  fullness: '#e0b978',
  energy: '#b9b2d6',
  clean: '#9ec9d8',
  mood: '#f0b7ad',
  health: '#a8c68a',
};

export const CARE_LABELS: Record<CareAction, { key: MessageKey; icon: string }> = {
  pat: { key: 'home.care.pat', icon: '🤚' },
  hug: { key: 'home.care.hug', icon: '🤗' },
  highfive: { key: 'home.care.highfive', icon: '🙌' },
};

export const TASK_HINT_KEYS: Record<TaskId, MessageKey> = {
  brush: 'hint.brush',
  wash: 'hint.wash',
  feed: 'hint.feed',
  dress: 'hint.dress',
  bath: 'hint.bath',
  sleep: 'hint.sleep',
  tidy: 'hint.tidy',
  sport: 'hint.sport',
  emotion: 'hint.emotion',
  learn: 'hint.learn',
};

export const SLOT_LABEL_KEYS: Record<TimeSlot, MessageKey> = {
  morning: 'time.morning',
  noon: 'time.noon',
  evening: 'time.evening',
};
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
