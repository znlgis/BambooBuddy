import type { ArcadeGameId } from '@bamboo/game-kit';
import type { MessageKey } from '@bamboo/i18n';

/**
 * 三款隐藏小游戏的展示元数据（唯一来源）：游戏厅卡片、小门浮层、e2e 都读它。
 * 玩法本身的中文名在各自 manifest 里（引擎不认语言）；界面一律走 i18n 键。
 */
export interface ArcadeGameInfo {
  id: ArcadeGameId;
  emoji: string;
  /** 卡片顶部的浅色底（内联样式用，Tailwind 不便拼动态类名） */
  color: string;
  nameKey: MessageKey;
  descKey: MessageKey;
}

export const ARCADE_CATALOG: readonly ArcadeGameInfo[] = [
  {
    id: 'popstar',
    emoji: '⭐',
    color: '#f7e2ae',
    nameKey: 'arcade.popstar.name',
    descKey: 'arcade.popstar.desc',
  },
  {
    id: 'bounce',
    emoji: '🏓',
    color: '#cfe3ee',
    nameKey: 'arcade.bounce.name',
    descKey: 'arcade.bounce.desc',
  },
  {
    id: 'tetris',
    emoji: '🧱',
    color: '#d7e8c6',
    nameKey: 'arcade.tetris.name',
    descKey: 'arcade.tetris.desc',
  },
];

export function arcadeInfo(id: ArcadeGameId): ArcadeGameInfo | undefined {
  return ARCADE_CATALOG.find((game) => game.id === id);
}
