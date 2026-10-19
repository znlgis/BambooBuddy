/**
 * 模板包的核心入口：每个游戏都要的那一点点（defineGame + 布局 + 一局状态）。
 * 场景走 '@bamboo/templates/<id>' 子路径，一个游戏只 import 自己用到的场景，
 * 避免 barrel 把全部模板拖进共享 chunk（CHAGS 实测约 90 KB gzip 的教训）。
 */
export { defineGame } from './defineGame';
export type { GameDefinition } from './defineGame';
export * from './layout';
