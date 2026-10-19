import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TaskId } from '../packages/content/src/ids';

/**
 * 关卡脚本从内容目录读，而不是手抄进用例。
 *
 * 两个原因：
 * 1. 内容 JSON 是唯一事实 —— 新增/调整一个刷洗点、一件玩具、一步睡前顺序时，
 *    用例不该跟着改；抄漏了也不会有任何测试发现。
 * 2. Playwright 的 ESM 加载器不接受裸 JSON import（CHAGS 踩过），
 *    而 @bamboo/content/full 会把 zod 与十条详情一起拉进 Node —— 这里用 fs 读单个文件。
 */
const DETAILS_DIR = fileURLToPath(new URL('../packages/content/src/details/', import.meta.url));

export interface ScrubSpotData {
  id: string;
  /** 0–1，相对模板导出的 stage 矩形 */
  x: number;
  y: number;
  size: number;
  kind: 'germ' | 'dirt' | 'foam';
}

export interface ScrubLevelData {
  room: string;
  tool: 'brush' | 'sponge' | 'hands' | 'towel';
  spots: ScrubSpotData[];
  /** 每个点要来回刷几下才干净 */
  rubs: number;
  finish?: { kind: 'rinse' | 'wipe'; taps: number };
}

export interface TidyItemData {
  id: string;
  kind: 'ball' | 'block' | 'book' | 'car';
  color: string;
  x: number;
  y: number;
}

export interface TidyLevelData {
  room: string;
  bins: { kind: TidyItemData['kind']; label: string; color: string }[];
  items: TidyItemData[];
}

export interface OrderStepData {
  id: string;
  icon: string;
  label: string;
}

export interface OrderLevelData {
  room: string;
  steps: OrderStepData[];
}

/** 读某个任务的 levelScript（内容详情里的玩法脚本） */
export function loadLevel(id: TaskId): unknown {
  const raw = JSON.parse(readFileSync(DETAILS_DIR + id + '.game.json', 'utf8')) as {
    levelScript?: unknown;
  };
  if (raw.levelScript === undefined) {
    throw new Error('内容详情缺少 levelScript：' + id);
  }
  return raw.levelScript;
}
