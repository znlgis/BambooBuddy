import type { ArcadeRoundMode } from '@bamboo/game-kit';

/**
 * 一局结束后的去向（纯函数，单测不需要起 Phaser）。
 *
 * 规则（README「无限畅玩」）：
 * - 无限畅玩 + 真实操作 → continuous：外壳直接接着开下一局；
 * - 自动通关（?autoplay=1）永远 once：e2e/调试要能自己走回游戏厅，
 *   而且自动通关写进的是"真成绩"，不能被无限畅玩接走变成永不结束的循环。
 */
export function resolveRoundMode(unlimited: boolean, autoplay: boolean): ArcadeRoundMode {
  return unlimited && !autoplay ? 'continuous' : 'once';
}
