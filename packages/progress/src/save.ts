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
import { dayKey, isDayKey } from './day';
import { normalizeStats } from './stats';

type Raw = Record<string, unknown>;

export const MAX_DAYS = 30;

/**
 * 失误数的存档封顶：一局现实里不可能错这么多次，坏档或异常事件夹到 99。
 * 这不是惩罚（星星规则只看 0–3 次的门槛），只是不让脏数据把数字撑爆。
 */
export const MAX_STORED_MISTAKES = 99;

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
    totalCompletions: 0,
    birdFeeds: 0,
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
    lastMistakes: 0,
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
    restWrapDismissed: false,
    arcade: [],
    arcadePlays: 0,
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

/**
 * 只留最近 30 天：日期键是 YYYY-MM-DD，字典序就是时间序。
 *
 * 给定 today 时**永远保留今天与未来日期**：设备时钟异常/被调快过时，存档里可能有一批
 * 晚于"今天"的日期键，纯按字典序截断会把今天裁掉；而日记录是任务、日记、家长页的共同
 * 来源，今天被裁掉会让当天所有写操作拿到 undefined（历史上曾因此抛过 TypeError）。
 */
export function pruneDays(
  days: Record<string, DayRecord>,
  keep = MAX_DAYS,
  today?: string,
): Record<string, DayRecord> {
  const keys = Object.keys(days).sort();
  // 坏 keep（NaN / Infinity）兜底成上限：Math.floor(NaN) 仍是 NaN，slice(-NaN) 等于不裁剪
  const limit = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : MAX_DAYS;
  const past = today === undefined ? keys : keys.filter((key) => key <= today);
  const future = today === undefined ? [] : keys.filter((key) => key > today);
  // 未来键也要限额：坏档里可能塞进成百上千个未来的合法日期串，不能无上限保留
  const keptFuture = future.slice(Math.max(0, future.length - limit));
  const kept = past
    .slice(Math.max(0, past.length - limit))
    .concat(keptFuture)
    .sort();
  const out: Record<string, DayRecord> = {};
  for (const key of kept) {
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
      // 合法日历日才算：2026-02-31 这种坏键留着也永远不等于任何一天
      if (isDayKey(day)) careDays[action] = day;
    }
  }

  return {
    name:
      typeof value.name === 'string' && value.name.trim().length > 0
        ? value.name.trim().slice(0, 24)
        : base.name,
    xp: positiveInt(value.xp),
    stats: sanitizeStats(value.stats),
    // 坏日历日必须换掉：daysBetween(坏键, 今天) 永远返回 0，留着会让跨天衰减永久失效
    lastDecayDay: isDayKey(value.lastDecayDay) ? value.lastDecayDay : base.lastDecayDay,
    shoots: positiveInt(value.shoots),
    fragments: positiveInt(value.fragments),
    unlocked: [...new Set(unlocked)],
    stickers: uniqueTaskIds(value.stickers),
    intimacy: positiveInt(value.intimacy),
    careDays,
    equipped,
    room,
    feeds: positiveInt(value.feeds),
    // v5：缺字段（v4 及更老）由 positiveInt 兜底成 0；真正的累计数在 migrate 里用任务次数之和回填
    totalCompletions: positiveInt(value.totalCompletions),
    birdFeeds: positiveInt(value.birdFeeds),
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
      lastPlayedDay: isDayKey(raw.lastPlayedDay) ? raw.lastPlayedDay : null,
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
      lastCompletedDay: isDayKey(raw.lastCompletedDay) ? raw.lastCompletedDay : null,
      streak: positiveInt(raw.streak),
      bestStreak: positiveInt(raw.bestStreak),
      // v5：v4 及更老没有这一项 → 0（"上次没有失误记录"，第一次完成不会硬夸"进步"）
      lastMistakes: intInRange(raw.lastMistakes, 0, MAX_STORED_MISTAKES, 0),
    };
  }
  return out;
}

function sanitizeDays(value: unknown): Record<string, DayRecord> {
  if (!isRecord(value)) return {};
  const days: Record<string, DayRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    // 非法日历日整条丢掉（2026-02-31 留着只会挤占 30 天额度，永远读不到）
    if (!isDayKey(key) || !isRecord(raw)) continue;
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
      // v5：老档没有这一项 → false（收尾卡片照常可以出现一次）
      restWrapDismissed: raw.restWrapDismissed === true,
      arcade: uniqueArcadeIds(raw.arcade),
      // v3 及更老：没有 arcadePlays，按「今天玩过几款」兜底（旧规则每款每天一次，正好等于局数）
      arcadePlays: positiveInt(raw.arcadePlays, uniqueArcadeIds(raw.arcade).length),
      arcadeSecret: raw.arcadeSecret === true,
    };
  }
  return days;
}

/** 各任务完成次数之和：v5 之前没有 pet.totalCompletions 时的回填口径（重复玩也算一件小事） */
function totalTaskCompletions(tasks: Record<TaskId, TaskProgress>): number {
  let sum = 0;
  for (const task of Object.values(tasks)) sum += task.completions;
  return sum;
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
  // v3 → v4：只新增「今天已经玩了几局」的计数；缺的字段由 sanitize 按旧规则兜底
  3: (raw) => raw,
  // v4 → v5：新增累计完成件数 / 喂小鸟次数 / 上一次失误 / 收尾卡片标记；
  // 缺的字段由 sanitize 兜底，累计完成件数在 migrate 末尾用各任务 completions 之和回填
  4: (raw) => raw,
};

/**
 * 来自未来版本的存档不被静默擦掉，而是"打标"交给外层决定。
 *
 * 这里不能用错误或额外字段：IndexedDB 存档由 platform 层调用 migrate 解出来，
 * 若 migrate 抛错，platform 的兜底会把它变成空档（本包管不到 platform），
 * 所以用一个模块内 WeakSet 记住"这份空档是未来版本降级出来的"，
 * ProgressManager 看到标记就拒绝写入、把原始存档原封不动留在 IndexedDB 里。
 * WeakSet 不参与序列化，也不会污染 SaveData 的类型。
 */
const FUTURE_VERSION_SAVES = new WeakSet<object>();

/** 这份存档是否来自比当前代码更新的版本（可能是 migrate 降级出来的空档，也可能是原始 raw） */
export function isFutureVersionSave(value: unknown): boolean {
  if (typeof value === 'object' && value !== null && FUTURE_VERSION_SAVES.has(value)) return true;
  return (
    isRecord(value) &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion > SAVE_SCHEMA_VERSION
  );
}

/** 读档体检：坏字段只丢那一个，不连累整份存档；来自未来版本的存档整份作废但会打标 */
export function migrate(raw: unknown, now: number): SaveData {
  if (!isRecord(raw)) return emptySave(now);
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SAVE_SCHEMA_VERSION) {
    const empty = emptySave(now);
    FUTURE_VERSION_SAVES.add(empty);
    return empty;
  }

  let data: Raw = raw;
  for (let from = version; from < SAVE_SCHEMA_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (!step) break;
    data = step(data, now);
  }

  const tasks = sanitizeTasks(data.tasks);
  const arcade = sanitizeArcade(data.arcade);
  const days = sanitizeDays(data.days);
  const today = dayKey(now);
  // 至少要有今天这一条：日记录是日记与家长页的共同来源
  if (!days[today]) days[today] = emptyDay(today);

  // v5：v4 及更老没有 pet.totalCompletions，用各任务完成次数之和回填 —— 老玩家的累计数不从 0 重来。
  // 两者取大：即使字段还在、却比任务次数之和小（坏档/手工改档），也不让累计数倒退。
  const sanitizedPet = sanitizePet(data.pet, now);
  const pet: PetState = {
    ...sanitizedPet,
    totalCompletions: Math.max(sanitizedPet.totalCompletions, totalTaskCompletions(tasks)),
  };

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: finite(data.updatedAt, now),
    pet,
    tasks,
    arcade,
    // 这一次裁剪必须带上 today：否则"今天比存档里 30 个日期键都旧"（时钟被调快过）
    // 会把刚补上的今天又裁掉，导致当天所有日记录写操作拿到 undefined
    days: pruneDays(days, MAX_DAYS, today),
  };
}

/** 确保今天的日记录存在（纯函数；Manager 负责落盘） */
export function ensureDay(save: SaveData, now: number): SaveData {
  const today = dayKey(now);
  if (save.days[today]) return save;
  return {
    ...save,
    days: pruneDays({ ...save.days, [today]: emptyDay(today) }, MAX_DAYS, today),
  };
}
