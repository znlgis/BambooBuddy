import type {
  StatKey,
  Stats,
  TaskDetail,
  TaskId,
  TemplateId,
  TimeSlot,
} from '@bamboo/content';

export type { StatKey, Stats, TaskDetail, TaskId, TemplateId, TimeSlot };

/** 只有中文（面向 4–8 岁中文儿童）。保留 Locale 这一层，是为了将来加语言时不改游戏契约 */
export type Locale = 'zh-CN';

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

export const SAVE_SCHEMA_VERSION = 1;

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
}

export interface SaveData {
  schemaVersion: number;
  updatedAt: number;
  pet: PetState;
  tasks: Record<TaskId, TaskProgress>;
  /** 只保留最近 30 天，避免存档无限增长 */
  days: Record<string, DayRecord>;
}

export interface ProgressStore {
  load(): Promise<SaveData>;
  save(data: SaveData): Promise<void>;
}
