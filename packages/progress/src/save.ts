import type {
  ArcadeGameId,
  ArcadeProgress,
  CareAction,
  DayRecord,
  PetState,
  SaveData,
  TaskProgress,
} from '@bamboo/game-kit';
import { ARCADE_GAME_IDS, CARE_ACTIONS, SAVE_SCHEMA_VERSION } from '@bamboo/game-kit';
import { STAT_KEYS, TASK_IDS } from '@bamboo/content/ids';
import type { StatKey, TaskId } from '@bamboo/content/ids';
import { CATALOG, defaultEquipment, findItem } from './catalog';
import { dayKey } from './day';
import { clampStat, normalizeStats } from './stats';

type Raw = Record<string, unknown>;

export const MAX_DAYS = 30;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveInt(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(finite(value, fallback)));
}

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, Math.floor(finite(value, fallback))));
}

function asTaskId(value: unknown): TaskId | null {
  return typeof value === 'string' && (TASK_IDS as readonly string[]).includes(value)
    ? (value as TaskId)
    : null;
}

function uniqueTaskIds(value: unknown): TaskId[] {
  if (!Array.isArray(value)) return [];
  const out: TaskId[] = [];
  for (const item of value) {
    const id = asTaskId(item);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

function asArcadeGameId(value: unknown): ArcadeGameId | null {
  return typeof value === 'string' && (ARCADE_GAME_IDS as readonly string[]).includes(value)
    ? (value as ArcadeGameId)
    : null;
}

function uniqueArcadeIds(value: unknown): ArcadeGameId[] {
  if (!Array.isArray(value)) return [];
  const out: ArcadeGameId[] = [];
  for (const item of value) {
    const id = asArcadeGameId(item);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

function uniqueCares(value: unknown): CareAction[] {
  if (!Array.isArray(value)) return [];
  const out: CareAction[] = [];
  for (const item of value) {
    if (typeof item === 'string' && (CARE_ACTIONS as readonly string[]).includes(item)) {
      const action = item as CareAction;
      if (!out.includes(action)) out.push(action);
    }
  }
  return out;
}

const DEFAULT_STATS: Record<StatKey, number> = {
  fullness: 72,
  energy: 80,
  clean: 76,
  mood: 88,
  health: 82,
};

export function emptyPet(now: number): PetState {
  const defaults = defaultEquipment();
  return {
    name: '竹竹',
    xp: 0,
    stats: { ...DEFAULT_STATS },
    lastDecayDay: dayKey(now),
    shoots: 3,
    fragments: 0,
    unlocked: [],
    stickers: [],
    intimacy: 0,
    careDays: {},
    equipped: defaults.equipped,
    room: defaults.room,
    feeds: 0,
  };
}

export function emptyTaskProgress(taskId: TaskId): TaskProgress {
  return {
    taskId,
    stars: 0,
    completions: 0,
    lastPlayedAt: null,
    lastCompletedDay: null,
    streak: 0,
    bestStreak: 0,
  };
}

export function emptyDay(date: string): DayRecord {
  return {
    date,
    completed: [],
    rewards: { shoots: 0, xp: 0, fragments: 0 },
    stickers: [],
    care: [],
    seconds: 0,
    restDismissed: false,
    arcade: [],
    arcadeSecret: false,
  };
}

/** 三款隐藏小游戏的跨天记录：新档全为零，最高分只增不减 */
export function emptyArcadeProgress(): Record<ArcadeGameId, ArcadeProgress> {
  const out = {} as Record<ArcadeGameId, ArcadeProgress>;
  for (const id of ARCADE_GAME_IDS) out[id] = { best: 0, plays: 0, lastPlayedDay: null };
  return out;
}

export function emptySave(now: number): SaveData {
  const tasks = {} as Record<TaskId, TaskProgress>;
  for (const id of TASK_IDS) tasks[id] = emptyTaskProgress(id);
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: now,
    pet: emptyPet(now),
    tasks,
    arcade: emptyArcadeProgress(),
    days: { [dayKey(now)]: emptyDay(dayKey(now)) },
  };
}

/** 只留最近 30 天：日期键是 YYYY-MM-DD，字典序就是时间序 */
export function pruneDays(days: Record<string, DayRecord>, keep = MAX_DAYS): Record<string, DayRecord> {
  const keys = Object.keys(days).sort().reverse().slice(0, keep);
  const out: Record<string, DayRecord> = {};
  for (const key of keys.reverse()) {
    const day = days[key];
    if (day) out[key] = day;
  }
  return out;
}

function sanitizeStats(value: unknown): Record<StatKey, number> {
  if (!isRecord(value)) return normalizeStats(DEFAULT_STATS);
  const partial: Partial<Record<StatKey, number>> = {};
  for (const key of STAT_KEYS) partial[key] = finite(value[key], DEFAULT_STATS[key]);
  return normalizeStats(partial);
}

function sanitizePet(value: unknown, now: number): PetState {
  const base = emptyPet(now);
  if (!isRecord(value)) return base;
  const unlocked = Array.isArray(value.unlocked)
    ? value.unlocked.filter((id): id is string => typeof id === 'string' && findItem(id) !== undefined)
    : [];
  // 默认物件本来就有：即使老存档里没写，也当作已拥有
  for (const item of CATALOG) {
    if (item.default === true && !unlocked.includes(item.id)) unlocked.push(item.id);
  }
  const equipped: PetState['equipped'] = {};
  if (isRecord(value.equipped)) {
    for (const [slot, id] of Object.entries(value.equipped)) {
      if (typeof id !== 'string') continue;
      const item = findItem(id);
      if (!item || item.slot !== slot || !unlocked.includes(id)) continue;
      equipped[slot as keyof PetState['equipped']] = id;
    }
  }
  const room: PetState['room'] = {};
  if (isRecord(value.room)) {
    for (const [slot, id] of Object.entries(value.room)) {
      if (typeof id !== 'string') continue;
      const item = findItem(id);
      if (!item || item.slot !== slot || !unlocked.includes(id)) continue;
      room[slot as keyof PetState['room']] = id;
    }
  }
  // 默认墙纸/地毯：没有就补上，保证小屋不会是空墙
  if (!room.wallpaper) room.wallpaper = base.room.wallpaper;
  if (!room.rug) room.rug = base.room.rug;

  const careDays: Partial<Record<CareAction, string>> = {};
  if (isRecord(value.careDays)) {
    for (const action of CARE_ACTIONS) {
      const day = value.careDays[action];
      if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) careDays[action] = day;
    }
  }

  return {
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : base.name,
    xp: positiveInt(value.xp),
    stats: sanitizeStats(value.stats),
    lastDecayDay:
      typeof value.lastDecayDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastDecayDay)
        ? value.lastDecayDay
        : base.lastDecayDay,
    shoots: positiveInt(value.shoots),
    fragments: positiveInt(value.fragments),
    unlocked: [...new Set(unlocked)],
    stickers: uniqueTaskIds(value.stickers),
    intimacy: positiveInt(value.intimacy),
    careDays,
    equipped,
    room,
    feeds: positiveInt(value.feeds),
  };
}

function sanitizeArcade(value: unknown): Record<ArcadeGameId, ArcadeProgress> {
  const out = {} as Record<ArcadeGameId, ArcadeProgress>;
  for (const id of ARCADE_GAME_IDS) {
    const raw = isRecord(value) && isRecord(value[id]) ? (value[id] as Raw) : null;
    if (!raw) {
      out[id] = { best: 0, plays: 0, lastPlayedDay: null };
      continue;
    }
    out[id] = {
      best: positiveInt(raw.best),
      plays: positiveInt(raw.plays),
      lastPlayedDay:
        typeof raw.lastPlayedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPlayedDay)
          ? raw.lastPlayedDay
          : null,
    };
  }
  return out;
}

function sanitizeTasks(value: unknown): Record<TaskId, TaskProgress> {
  const out = {} as Record<TaskId, TaskProgress>;
  for (const id of TASK_IDS) {
    const raw = isRecord(value) && isRecord(value[id]) ? (value[id] as Raw) : null;
    if (!raw) {
      out[id] = emptyTaskProgress(id);
      continue;
    }
    const stars = intInRange(raw.stars, 0, 3, 0) as 0 | 1 | 2 | 3;
    out[id] = {
      taskId: id,
      stars,
      completions: positiveInt(raw.completions),
      lastPlayedAt: typeof raw.lastPlayedAt === 'number' && Number.isFinite(raw.lastPlayedAt) ? raw.lastPlayedAt : null,
      lastCompletedDay:
        typeof raw.lastCompletedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastCompletedDay)
          ? raw.lastCompletedDay
          : null,
      streak: positiveInt(raw.streak),
      bestStreak: positiveInt(raw.bestStreak),
    };
  }
  return out;
}

function sanitizeDays(value: unknown): Record<string, DayRecord> {
  if (!isRecord(value)) return {};
  const days: Record<string, DayRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord(raw)) continue;
    const rewards = isRecord(raw.rewards) ? raw.rewards : {};
    days[key] = {
      date: key,
      completed: uniqueTaskIds(raw.completed),
      rewards: {
        shoots: positiveInt(rewards.shoots),
        xp: positiveInt(rewards.xp),
        fragments: positiveInt(rewards.fragments),
      },
      stickers: uniqueTaskIds(raw.stickers),
      care: uniqueCares(raw.care),
      seconds: positiveInt(raw.seconds),
      restDismissed: raw.restDismissed === true,
      arcade: uniqueArcadeIds(raw.arcade),
      arcadeSecret: raw.arcadeSecret === true,
    };
  }
  return pruneDays(days);
}

/**
 * 存档迁移链：{ 旧版本号: 升到下一版的函数 }。
 * v1 → v2 只新增隐藏小游戏的 arcade 字段：缺的字段由下面的 sanitize 逐条兜底，
 * 老玩家的竹笋 / 星星 / 成长值一根都不会少（旧实现"版本不等就清空"是 CHAGS 点名批评过的做法）。
 */
const MIGRATIONS: Record<number, (raw: Raw, now: number) => Raw> = {
  1: (raw) => raw,
  // v2 → v3：只新增「今天触发过竹林小路」的布尔值；缺的字段照样由 sanitize 兜底
  2: (raw) => raw,
};

/** 读档体检：坏字段只丢那一个，不连累整份存档；来自未来版本的存档才整体清空 */
export function migrate(raw: unknown, now: number): SaveData {
  if (!isRecord(raw)) return emptySave(now);
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SAVE_SCHEMA_VERSION) return emptySave(now);

  let data: Raw = raw;
  for (let from = version; from < SAVE_SCHEMA_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (!step) break;
    data = step(data, now);
  }

  const pet = sanitizePet(data.pet, now);
  const tasks = sanitizeTasks(data.tasks);
  const arcade = sanitizeArcade(data.arcade);
  const days = sanitizeDays(data.days);
  const today = dayKey(now);
  // 至少要有今天这一条：日记录是日记与家长页的共同来源
  if (!days[today]) days[today] = emptyDay(today);

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: finite(data.updatedAt, now),
    pet,
    tasks,
    arcade,
    days: pruneDays(days),
  };
}

/** 确保今天的日记录存在（纯函数；Manager 负责落盘） */
export function ensureDay(save: SaveData, now: number): SaveData {
  const today = dayKey(now);
  if (save.days[today]) return save;
  return { ...save, days: pruneDays({ ...save.days, [today]: emptyDay(today) }) };
}

/** 校验并修正一个状态值（测试与 UI 都可复用） */
export function sanitizeStatValue(value: number): number {
  return clampStat(value);
}
