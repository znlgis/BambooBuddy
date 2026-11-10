import type {
  Locale,
  StatKey,
  Stats,
  TaskDetail,
  TaskId,
  TemplateId,
  TimeSlot,
} from '@bamboo/content';

export type { Locale, StatKey, Stats, TaskDetail, TaskId, TemplateId, TimeSlot };

/** 浏览器 / WebView 的 BCP-47 语音标签：'en' 不是合法标签，必须映射成 'en-US' */
export function speechLang(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}

/** 游戏包身份信息：只留真的有人读的字段，标题/年龄等描述的唯一事实来源是内容 JSON */
export interface GameManifest {
  id: TaskId;
  title: string;
  version: string;
  template: TemplateId;
  designSize: { width: number; height: number };
  ageRange: [number, number];
}

export type Stars = 0 | 1 | 2 | 3;

export interface GameEventMap {
  'session:start': { at: number };
  'scene:enter': { scene: string };
  /** 做错/需要重来时发一次（不惩罚，只用于复盘与自动化观测） */
  'task:retry': { taskId: TaskId; step: string };
  'task:complete': {
    taskId: TaskId;
    stars: Stars;
    mistakes: number;
    correct: number;
    total: number;
    durationMs: number;
  };
  /** replay = 孩子点了「再玩一次」：外壳原地重开这一局，不用回任务页再找 */
  'session:exit': { reason: 'complete' | 'quit' | 'replay'; progress: number };
}

export type SfxKey =
  | 'tap'
  | 'correct'
  | 'retry'
  | 'pop'
  | 'bubble'
  | 'water'
  | 'chew'
  | 'jump'
  | 'sleep'
  | 'unlock'
  | 'complete'
  | 'sparkle';

/** 朗读结局：真的念完了 / 这台设备念不出来（静音、没装语音包、无头浏览器） */
export type SpeechOutcome = 'ended' | 'unavailable';
export interface SpeechHandle {
  /** 两种情况都必须 resolve，否则界面会永远停在"正在听"上 */
  readonly done: Promise<SpeechOutcome>;
}

export interface AudioBus {
  /** iOS / 微信必须由用户手势触发解锁 */
  unlock(): Promise<void>;
  play(key: SfxKey): void;
  /** 指定音高的一声（"进步听得见"：节奏游戏里音调随连击升高） */
  tone(freq: number, durationMs: number): void;
  speak(text: string, locale: Locale): SpeechHandle;
  stopSpeech(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export interface LifecycleBus {
  onPause(cb: () => void): () => void;
  onResume(cb: () => void): () => void;
}

export interface Telemetry {
  track<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void;
  flush(): Promise<void>;
}

/** 唯一的平台出口：游戏不许直接碰 localStorage / fetch */
export interface PlatformServices {
  storage: ProgressStore;
  audio: AudioBus;
  lifecycle: LifecycleBus;
  telemetry: Telemetry;
  now(): number;
}

export interface DebugOptions {
  /** ?autoplay=1：自动通关（只对开发服务器与自动化浏览器开放） */
  autoplay?: boolean;
  /** ?instant=1：跳过过场与语音等待（截图/冒烟巡检用） */
  instant?: boolean;
}

export interface GameContext {
  container: HTMLElement;
  manifest: GameManifest;
  task: TaskDetail;
  services: PlatformServices;
  locale: Locale;
  reducedMotion: boolean;
  debug?: DebugOptions;
  /** 这个任务之前完成过没有（外壳从存档里读）：面板上可以显示"又做到啦" */
  completedBefore: boolean;
  emit<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void;
  requestExit(reason?: 'quit' | 'replay'): void;
}

export interface GameModule {
  manifest: GameManifest;
  mount(ctx: GameContext): Promise<void>;
  unmount(): Promise<void>;
  pause(): void;
  resume(): void;
}

/* ------------------------------------------------------------------ *
 * 存档（纯数据；读写与迁移在 @bamboo/progress）
 * ------------------------------------------------------------------ */

/**
 * 存档版本。每版都只加字段：缺的字段由 migrate 的 sanitize 逐条兜底，老档一根竹笋都不会少。
 * - v2：隐藏小游戏的 SaveData.arcade / DayRecord.arcade
 * - v3：DayRecord.arcadeSecret（竹林小路彩蛋）
 * - v4：DayRecord.arcadePlays（今天已完成局数，三款合计）
 * - v5：累计与"上次"口径 —— pet.totalCompletions / pet.birdFeeds / tasks[].lastMistakes /
 *       DayRecord.restWrapDismissed（30 分钟收尾卡片当天已收下）
 */
export const SAVE_SCHEMA_VERSION = 5;

/**
 * 三款隐藏小游戏的 id：与日常任务（TaskId）完全分开的两组概念。
 * 唯一事实来源 —— 存档键、外壳路由、游戏包导出名都从这里取。
 */
export const ARCADE_GAME_IDS = ['popstar', 'bounce', 'tetris'] as const;
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

/**
 * 跨天保留的小游戏记录：最高成绩与总次数。
 * 难度等级不单独存：由 plays 经 arcadeLevelFor 派生，天然跨天延续、无需迁移。
 */
export interface ArcadeProgress {
  best: number;
  plays: number;
  lastPlayedDay: string | null;
}

/** 每天固定可做的三个亲昵动作；喂竹笋单独算（消耗奖励，不算打卡） */
export type CareAction = 'pat' | 'hug' | 'highfive';
export const CARE_ACTIONS: readonly CareAction[] = ['pat', 'hug', 'highfive'];

export type ClothingSlot = 'hat' | 'bib' | 'outfit' | 'backpack' | 'shoes';
export type RoomSlot = 'wallpaper' | 'bed' | 'shelf' | 'toyCorner' | 'rug';

export interface PetState {
  name: string;
  xp: number;
  stats: Stats;
  /** 上次按天衰减的日期（YYYY-MM-DD）；跨天才衰减，绝不半天掉状态 */
  lastDecayDay: string;
  /** 竹笋：日常任务的奖励，用来解锁装扮/小窝、也能喂给竹竹 */
  shoots: number;
  /** 装扮碎片：每完成第 3 个不同任务得一枚，用于解锁特别装扮 */
  fragments: number;
  /** 已解锁的装扮 / 房间物件 id（默认物件免费自带，不计在这里） */
  unlocked: string[];
  /** 贴纸：某个任务连续 3 天完成解锁一张 */
  stickers: TaskId[];
  /** 亲密度：摸头/抱抱/击掌累积，解锁新动作与语音 */
  intimacy: number;
  /** 今天已经做过的亲昵动作（action → 日期） */
  careDays: Partial<Record<CareAction, string>>;
  equipped: Partial<Record<ClothingSlot, string>>;
  room: Partial<Record<RoomSlot, string>>;
  /** 累计喂了多少根竹笋（日记/家长页的一个小数字） */
  feeds: number;
  /** 累计完成过多少件小事（含同一天重复玩）：里程碑与家长页的"累计"口径，不是连续天数 */
  totalCompletions: number;
  /** 喂过小鸟几次：竹笋的轻量消耗出口，只记次数、不给任何数值增益 */
  birdFeeds: number;
}

export interface TaskProgress {
  taskId: TaskId;
  /** 历史最好成绩（只增不减，对小朋友永远正向） */
  stars: Stars;
  completions: number;
  lastPlayedAt: number | null;
  lastCompletedDay: string | null;
  /** 连续完成天数 */
  streak: number;
  bestStreak: number;
  /** 上一次完成时的失误数（默认 0）：完成卡只在"比上次少错 X 次"时夸一句，从不显示退步 */
  lastMistakes: number;
}

export interface DayRecord {
  date: string;
  /** 今天完成过的任务（去重，按完成顺序） */
  completed: TaskId[];
  rewards: { shoots: number; xp: number; fragments: number };
  stickers: TaskId[];
  care: CareAction[];
  /** 今天玩游戏的秒数（只统计游戏时间，家长页与 20 分钟休息提醒用） */
  seconds: number;
  restDismissed: boolean;
  /** 30 分钟「玩够啦」收尾卡片今天已经收下：只影响这一张卡片，不锁任何功能 */
  restWrapDismissed: boolean;
  /** 今天玩过哪些隐藏小游戏（去重；日记与家长页用） */
  arcade: ArcadeGameId[];
  /**
   * 今天已经完整玩完几局（三款合计，中途退出不算）。
   * 普通模式上限 ARCADE_DAILY_PLAYS；无限畅玩只累计、不设上限。
   */
  arcadePlays: number;
  /**
   * 今天触发了「竹林小路」这个隐藏彩蛋：
   * 小门直接打开（不用攒四件小事），三款游戏当天无限畅玩。跨天自动消失。
   */
  arcadeSecret: boolean;
}

export interface SaveData {
  schemaVersion: number;
  updatedAt: number;
  pet: PetState;
  tasks: Record<TaskId, TaskProgress>;
  /** 隐藏小游戏的跨天记录（最高成绩 / 总次数 / 由总次数派生的难度）；「今天玩过」在 days[今天].arcade */
  arcade: Record<ArcadeGameId, ArcadeProgress>;
  /** 只保留最近 30 天，避免存档无限增长 */
  days: Record<string, DayRecord>;
}

/**
 * 存档读写接口（平台层实现：Web 是 IndexedDB）。
 *
 * 失败语义必须明确，否则上层会把"读坏了"当成"新玩家"：
 * - `load()` **只有真的读不出来才 reject**；这台设备还没存过档时应当 resolve 一份空档
 *   （`emptySave`），不能拿 reject 表示"没有存档"。ProgressManager 会把 reject 原样抛给
 *   外壳（提示家长 + 拒绝写入），用来防止"读档失败 → 空档 → 第一次写就把旧进度覆盖"。
 * - `save()` 失败必须 reject（配额满 / 隐私模式 / 存储被禁）：调用方据此把"这次可能没存上"
 *   告诉孩子，而不是静默丢进度。
 */
export interface ProgressStore {
  load(): Promise<SaveData>;
  save(data: SaveData): Promise<void>;
}