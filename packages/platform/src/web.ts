import type {
  AudioBus,
  LifecycleBus,
  Locale,
  PlatformServices,
  ProgressStore,
  SfxKey,
  SpeechHandle,
  SpeechOutcome,
  Telemetry,
  SaveData,
} from '@bamboo/game-kit';
import { emptySave, migrate } from '@bamboo/progress';

const DB_NAME = 'bamboobuddy';
const STORE_NAME = 'kv';
const SAVE_KEY = 'save';

/** 存储不可用的原因：只用于日志/报错文案，不参与业务判断 */
export type StorageIssue = 'unsupported' | 'timeout' | 'blocked' | 'error';

export interface OpenResult {
  db: IDBDatabase | null;
  issue: StorageIssue | null;
}

/** 打开数据库；单测注入 fake（不引入 jsdom / fake-indexeddb），生产走下方的真实实现 */
export type OpenDatabase = () => Promise<OpenResult>;

/**
 * 默认真实实现：indexedDB.open + 3 秒超时兜底。
 *
 * 这里**不做任何缓存**：超时/blocked 只代表"这一次没开成"。别的标签页关掉、
 * 隐私模式被授权之后，下一次调用仍有机会成功（store 层负责重试节奏）。
 */
export function openIdbDatabase(): Promise<OpenResult> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve({ db: null, issue: 'unsupported' });
      return;
    }
    // 隐私模式 / 存储被禁 / 旧标签页占着升级：open 可能永不回调 ——
    // 超时就退内存档，绝不让启动流程挂在这里（CHAGS 踩过的坑）。
    // 注意：这里只做「本次会话降级」，不缓存成永久结论 —— 别的标签页关掉、存储被授权之后，
    // 下一次 openIdbDatabase 仍有机会成功。
    let settled = false;
    const timer = setTimeout(() => settle(null, 'timeout'), 3000);
    const request = indexedDB.open(DB_NAME, 1);

    function settle(db: IDBDatabase | null, issue: StorageIssue | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ db, issue });
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    // 连接建立后允许别的标签页升级：否则本页一直占着旧版本，对方永远 onblocked
    request.onsuccess = () => {
      const db = request.result;
      // 已经按 onblocked 降级过了（对方后来才让出）：这条连接没有任何人持有，
      // 必须关掉 —— 否则它会反过来把别人的下一次升级永久挡住。
      if (settled) {
        try {
          db.close();
        } catch {
          // 关不掉也没人能再动它了：这里不是错误路径
        }
        return;
      }
      db.onversionchange = () => db.close();
      settle(db, null);
    };
    request.onerror = () => settle(null, 'error');
    // blocked：另一个标签页占着旧版本升级。不是永久失败 —— 但也不能不 settle，
    // 所以先降级为内存，并把这个「本次会话没落盘」的事实通过 save() 抛给上层。
    request.onblocked = () => settle(null, 'blocked');
  });
}

/** 存储不可用时的错误：上层（progress store）据此把 unsaved 置位、给孩子一句「可能没存上」 */
export class StorageUnavailableError extends Error {
  readonly issue: StorageIssue;

  constructor(issue: StorageIssue) {
    super('本地存储不可用（' + issue + '），本次进度只保留在内存里');
    this.name = 'StorageUnavailableError';
    this.issue = issue;
  }
}

/**
 * 连接已关闭的标志：在已关闭的 IDBDatabase 上开事务，浏览器抛 DOMException(InvalidStateError)。
 * 这不是"存储不可用"（不需要降级），而是"连接被别的标签页升级 / 被回收"——重连一次就好。
 */
function isClosedError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'InvalidStateError';
}

/** 存储健康度：排障与 e2e 读它；界面不按它做业务判断 */
export interface StorageHealth {
  /** ready = 已有连接；degraded = 本次降级为内存（issue 说明原因） */
  state: 'ready' | 'degraded';
  issue: StorageIssue | null;
  /** open 失败过几次：> 0 说明这次会话曾经降级，但之后仍可能恢复 */
  failures: number;
}

export interface IdbStoreOptions {
  /** 打开数据库；默认 openIdbDatabase。单测注入 fake */
  open?: OpenDatabase;
  /** 失败后再次尝试 open 的最小间隔（毫秒，默认 2000）；0 = 下次访问立刻重试 */
  retryDelayMs?: number;
  /** 时钟；只用于判断重试冷却（默认 Date.now） */
  now?: () => number;
}

export type IdbProgressStore = ProgressStore & { health(): StorageHealth };

/**
 * IndexedDB 存档；不可用时降级为内存（无痕模式 / 测试）。
 *
 * 降级的语义很重要：**读得到空档、但写得进去必须让上层知道**。
 * 以前 `save()` 在无 db 时直接 return，调用方以为存档成功，
 * 关掉页面才发现今天白玩 —— 现在改为 reject，走 progress store 的 unsaved 提示链路。
 */
export function createIdbProgressStore(options: IdbStoreOptions = {}): IdbProgressStore {
  const open = options.open ?? openIdbDatabase;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const now = options.now ?? Date.now;
  let memory: SaveData | null = null;
  let opened: IDBDatabase | null = null;
  let opening: Promise<OpenResult> | null = null;
  let issue: StorageIssue | null = null;
  let failedAt = 0;
  let failures = 0;

  function health(): StorageHealth {
    return { state: opened === null ? 'degraded' : 'ready', issue, failures };
  }

  /**
   * 拿连接。三条纪律：
   * 1. **失败不是永久结论**：超时 / blocked / error 在冷却期后重试 —— 隐私模式退出、
   *    别的标签页关掉之后，同一次会话里仍然有机会落盘（以前的实现把结果永久缓存，等于放弃）；
   * 2. **同一时刻只开一次**（single-flight）：load/save 并发时不会重复 open 抢升级；
   * 3. 只有真正没有 IndexedDB（unsupported）才永久降级：它不会在本次会话里凭空出现。
   */
  function connect(): Promise<OpenResult> {
    if (opened !== null) return Promise.resolve({ db: opened, issue: null });
    if (opening !== null) return opening;
    if (issue === 'unsupported') return Promise.resolve({ db: null, issue });
    // 冷却期内直接返回上次的失败：避免"每次读/写都重新等 3 秒超时"把界面拖住
    if (issue !== null && now() - failedAt < retryDelayMs) {
      return Promise.resolve({ db: null, issue });
    }

    let settle!: (result: OpenResult) => void;
    const attempt = new Promise<OpenResult>((resolve) => {
      settle = resolve;
    });
    opening = attempt;
    void (async () => {
      let result: OpenResult;
      try {
        result = await open();
      } catch {
        result = { db: null, issue: 'error' };
      }
      if (result.db !== null) {
        opened = result.db;
        issue = null;
        // 连接可能在运行中被关掉：别的标签页要升级（onversionchange）、
        // 或者浏览器为省内存回收存储（onclose）。不在这里把缓存清掉的话，
        // 后续 load() 会在一条已关闭的连接上开事务（InvalidStateError），
        // 被 catch 成"空档"——界面像个新玩家，孩子会以为进度没了。
        const db = result.db;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // 已经关掉了：下面照样把缓存清掉
          }
          if (opened === db) opened = null;
        };
        db.onclose = () => {
          if (opened === db) opened = null;
        };
      } else {
        failures += 1;
        issue = result.issue ?? 'error';
        failedAt = now();
      }
      opening = null;
      settle(result);
    })();
    return attempt;
  }

  /** 连接被外部关掉后重连一次：这是"掉线"，不是"存储不可用"（不该被冷却期或永久降级挡住） */
  function reconnect(): Promise<OpenResult> {
    opened = null;
    opening = null;
    return connect();
  }

  /**
   * 在给定连接上读一次。三条语义与 game-kit 的 ProgressStore.load 契约一一对应：
   * - 连接已关闭（InvalidStateError）→ 返回 null，交给调用方重连（这不叫读失败）；
   * - 这台设备还没存过档（`result === undefined`）→ resolve 空档（新玩家不是失败，
   *   reject 会让第一次启动就被当成"存档读不出来"）；
   * - 事务 / 请求 / 迁移真的失败 → **reject**。以前这里吞成空档，上层会把"读不出来"
   *   当成"新玩家"，第一次写入就用空档盖掉真实进度 —— manager 的"读档失败只读/提示家长"
   *   防护链正是靠这个 reject 触发的。
   */
  function readSave(db: IDBDatabase): Promise<SaveData | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const resolveOnce = (save: SaveData | null): void => {
        if (settled) return;
        settled = true;
        resolve(save);
      };
      const rejectOnce = (cause: unknown): void => {
        if (settled) return;
        settled = true;
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      };

      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (cause) {
        if (isClosedError(cause)) resolveOnce(null);
        else rejectOnce(cause);
        return;
      }
      // 只读事务也可能被中止（存储被回收 / 浏览器出错）：没有这一步，load() 会永远挂着
      tx.onabort = () => rejectOnce(tx.error ?? new Error('读取存档的事务被中止'));

      let request: IDBRequest;
      try {
        request = tx.objectStore(STORE_NAME).get(SAVE_KEY);
      } catch (cause) {
        rejectOnce(cause);
        return;
      }
      request.onsuccess = () => {
        if (request.result === undefined) {
          // 没有任何存档记录 = 新玩家：这不是失败，绝不能 reject
          resolveOnce(emptySave(Date.now()));
          return;
        }
        try {
          resolveOnce(migrate(request.result, Date.now()));
        } catch (cause) {
          rejectOnce(cause);
        }
      };
      request.onerror = () => rejectOnce(request.error ?? new Error('读取存档失败'));
    });
  }

  /** 在给定连接上写一次；写失败（配额满 / 无痕模式）必须把原因抛给上层 */
  function writeSave(db: IDBDatabase, data: SaveData): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
        return;
      }
      tx.objectStore(STORE_NAME).put(data, SAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('存档写入失败'));
      tx.onabort = () => reject(tx.error ?? new Error('存档写入被中止'));
    });
  }

  return {
    health,
    async load(): Promise<SaveData> {
      const first = await connect();
      // 降级为内存：本次会话仍可玩，读到的只是内存里的（可能是空的）快照
      if (!first.db) return memory ?? emptySave(Date.now());

      const save = await readSave(first.db);
      if (save !== null) return save;

      // 连接刚好被别的标签页升级关掉：重连一次再读，别把"掉线"当成"新玩家"
      const again = await reconnect();
      if (!again.db) return memory ?? emptySave(Date.now());
      const retried = await readSave(again.db);
      // 连续两次连接失效：宁可让上层提示"读档失败"，也不能当空档（否则第一次写入会盖掉真实进度）
      if (retried === null) throw new Error('存档连接连续失效，本次读档放弃以保护磁盘上的存档');
      return retried;
    },
    async save(data: SaveData): Promise<void> {
      memory = data;
      let connection = await connect();
      // 没有 IndexedDB 时必须让调用方知道：以前这里直接 return，
      // 上层以为写成功了，孩子关掉页面才发现今天白玩（静默丢失是最坏的结果）。
      if (!connection.db) throw new StorageUnavailableError(connection.issue ?? 'error');

      try {
        await writeSave(connection.db, data);
        return;
      } catch (cause) {
        // 只有"连接被关掉"值得重连；配额满 / 无痕模式这类失败重试也不会成功
        if (!isClosedError(cause)) throw cause;
      }

      connection = await reconnect();
      if (!connection.db) throw new StorageUnavailableError(connection.issue ?? 'error');
      // 写失败同样必须让调用方知道（配额满 / 无痕模式）
      await writeSave(connection.db, data);
    },
  };
}

/**
 * 首屏只装"转发代理"，真正的音频实现（振荡器合成 + TTS）在 ./web-audio 里**懒加载**。
 *
 * 为什么能懒加载：首屏 gzip 60 KB 是硬线，而这 200 行合成/TTS 代码只有"孩子真的听到
 * 声音或点朗读"时才需要，且不参与任何玩法判定。
 * - `createWebPlatform()` 一执行就开始预取，孩子第一次点按之前通常已经就绪；
 * - 就绪前的 play/tone 丢一声（无害，界面上没有任何"正在播放"状态依赖它）；
 * - speak 会等实现到位再念，`done` 契约照样 resolve（不会把界面钉在"正在听"）；
 * - 静音开关必须同步可读（设置页在首帧就调 setMuted/isMuted），所以 muted 留在代理里。
 */
export function createLazyAudioBus(): AudioBus {
  let muted = false;
  let impl: AudioBus | null = null;
  const loading = import('./web-audio')
    .then(({ createWebAudioBus }) => {
      impl = createWebAudioBus();
      if (muted) impl.setMuted(true);
    })
    .catch(() => undefined);

  return {
    async unlock(): Promise<void> {
      await loading;
      await impl?.unlock();
    },
    play(key: SfxKey): void {
      impl?.play(key);
    },
    tone(freq: number, durationMs: number): void {
      impl?.tone(freq, durationMs);
    },
    speak(text: string, locale: Locale): SpeechHandle {
      if (muted) return { done: Promise.resolve('unavailable') };
      return {
        done: loading.then((): Promise<SpeechOutcome> | SpeechOutcome =>
          impl ? impl.speak(text, locale).done : 'unavailable',
        ),
      };
    },
    stopSpeech(): void {
      impl?.stopSpeech();
    },
    setMuted(next: boolean): void {
      muted = next;
      impl?.setMuted(next);
    },
    isMuted(): boolean {
      return muted;
    },
  };
}

export function createVisibilityLifecycle(): LifecycleBus {
  return {
    onPause(cb: () => void): () => void {
      const handler = (): void => {
        if (document.visibilityState === 'hidden') cb();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    onResume(cb: () => void): () => void {
      const handler = (): void => {
        if (document.visibilityState === 'visible') cb();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}

/**
 * 默认不采集任何信息：只在本地留一份最近事件轨迹，方便排障。
 *
 * flush() 刻意不发任何请求（儿童产品默认不上报）；recent() 是本机调试出口 ——
 * 以前 buffer 写完没人能读，属于死代码。
 */
export function createLocalTelemetry(): Telemetry & { recent(limit?: number): readonly TelemetryEntry[] } {
  const buffer: TelemetryEntry[] = [];
  return {
    track(type): void {
      buffer.push({ type, at: Date.now() });
      if (buffer.length > 500) buffer.shift();
    },
    recent(limit = 50): readonly TelemetryEntry[] {
      return buffer.slice(-limit);
    },
    async flush(): Promise<void> {
      // 刻意不发送：儿童产品默认不上报任何信息
    },
  };
}

export interface TelemetryEntry {
  /** 事件名（task:complete / scene:enter 等） */
  type: string;
  /** 本机时间戳（毫秒）；不联网，仅用于本地排障 */
  at: number;
}

export function createWebPlatform(): PlatformServices {
  // 移动端存储压力下浏览器可能清掉 IndexedDB：能申请持久存储就申请一次
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    void navigator.storage.persist();
  }
  return {
    storage: createIdbProgressStore(),
    audio: createLazyAudioBus(),
    lifecycle: createVisibilityLifecycle(),
    telemetry: createLocalTelemetry(),
    now: () => Date.now(),
  };
}