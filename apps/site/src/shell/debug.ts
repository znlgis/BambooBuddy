import { emptySave } from '@bamboo/progress';
import type { SaveData } from '@bamboo/game-kit';

/**
 * 给自动化测试与 AI 协作用的观测窗口。生产环境同样开着：
 * 它只有事件名和存档快照，不含任何个人信息，也不需要联网。
 *
 * 形状固定为 { events, save, lastError? } —— e2e 直接读它断言，
 * 不要往上面加字段（加之前先叫上 QA 一起改）。
 */
export interface BambooDebugBridge {
  /** 事件序列：'session:start' / 'scene:enter:<scene>' / 'task:complete:<id>' … */
  events: string[];
  /** 最新存档快照（每次存档变化都换成一个**新对象**） */
  save: SaveData;
  /** 最近一次载入失败的技术详情（孩子看到的是人话，这一份留给开发与自动化） */
  lastError?: string;
}

declare global {
  interface Window {
    __bamboo?: BambooDebugBridge;
  }
}

const MAX_EVENTS = 600;

/** 启动即挂：e2e 可能在用户点任何东西之前就读 window.__bamboo */
export function initDebugBridge(now = Date.now()): BambooDebugBridge {
  const w = window;
  if (!w.__bamboo) w.__bamboo = { events: [], save: emptySave(now) };
  return w.__bamboo;
}

/** 事件名 + 细节拼成 'type:detail'（没有细节时就是 'type'，例如 session:start） */
export function recordDebugEvent(type: string, detail?: string): void {
  const bridge = initDebugBridge();
  const entry = detail ? type + ':' + detail : type;
  bridge.events.push(entry);
  if (bridge.events.length > MAX_EVENTS) bridge.events.shift();
}

/** 存档快照：每次变更后同步（ProgressManager.snapshot() 返回的已经是新对象） */
export function setDebugSave(save: SaveData): void {
  initDebugBridge().save = save;
}

export function recordDebugError(message: string): void {
  initDebugBridge().lastError = message;
}
