import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_SCHEMA_VERSION } from '@bamboo/game-kit';
import { emptySave } from '@bamboo/progress';
import {
  createIdbProgressStore,
  createLocalTelemetry,
  createVisibilityLifecycle,
  createWebAudioBus,
  openIdbDatabase,
  speechTimeoutMs,
  StorageUnavailableError,
} from './web';
import type { OpenResult } from './web';

/**
 * platform 层单测：不引入 jsdom / fake-indexeddb，全部用最小手写 fake。
 *
 * 盯的是三条"静默失败会让家长以为进度还在"的路径：
 * 1. IndexedDB 的 open/load/save 三态（正常 / open 不可用 / 写失败）；
 * 2. open 失败**不是永久结论**：blocked / 超时之后仍会按冷却重试（以前缓存成永久降级）；
 * 3. Web Speech 的 `done` 契约：没有 onend/onerror 时必须按文本长度超时 resolve。
 *
 * fake 的形状只实现被测代码真正用到的部分（transaction / objectStore / get / put 与四个回调），
 * 够用且能一眼看懂；换成 fake-indexeddb 反而不容易看清"哪一步失败"。
 */

/* ------------------------------------------------------------------ *
 * 最小 IndexedDB fake
 * ------------------------------------------------------------------ */

class FakeRequest<T> {
  result: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(result: T) {
    this.result = result;
  }

  succeed(value: T): void {
    this.result = value;
    this.onsuccess?.();
  }

  fail(cause: Error): void {
    this.error = cause;
    this.onerror?.();
  }
}

class FakeTransaction {
  error: Error | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly request: FakeRequest<unknown>;

  constructor(request: FakeRequest<unknown>) {
    this.request = request;
  }

  objectStore(): { get: () => FakeRequest<unknown>; put: () => void } {
    return { get: () => this.request, put: () => undefined };
  }

  complete(): void {
    this.oncomplete?.();
  }

  fail(cause: Error): void {
    this.error = cause;
    this.onerror?.();
  }
}

interface FakeDbOptions {
  /** 读写事务一创建就抛错（模拟存储被系统禁用） */
  transactionThrows?: boolean;
}

function makeDb(options: FakeDbOptions = {}) {
  const request = new FakeRequest<unknown>(undefined);
  const transactions: FakeTransaction[] = [];
  const db = {
    objectStoreNames: { contains: (): boolean => true },
    transaction: (): FakeTransaction => {
      if (options.transactionThrows === true) throw new Error('transaction 不可用');
      const tx = new FakeTransaction(request);
      transactions.push(tx);
      return tx;
    },
  } as unknown as IDBDatabase;
  return { db, request, transactions };
}

/** 让 load/save 里的 await 链路与 handler 赋值跑到，再手动触发回调 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 把 reject 收成值，避免"断言前先 await"时出现 unhandled rejection */
const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * IndexedDB 三态
 * ------------------------------------------------------------------ */

describe('IndexedDB 存档：正常 / open 不可用 / 写失败', () => {
  it('正常 open：load 读到存档，缺失字段由 migrate 补齐', async () => {
    const fake = makeDb();
    const store = createIdbProgressStore({ open: async () => ({ db: fake.db, issue: null }) });

    const loading = store.load();
    await flush();
    fake.request.succeed({ pet: { shoots: 9 } });
    const save = await loading;

    expect(save.pet.shoots).toBe(9);
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(store.health()).toEqual({ state: 'ready', issue: null, failures: 0 });
  });

  it('load 返回坏数据：退回空档而不是抛错（坏档不能挡住启动）', async () => {
    const fake = makeDb();
    const store = createIdbProgressStore({ open: async () => ({ db: fake.db, issue: null }) });

    const loading = store.load();
    await flush();
    fake.request.succeed({ schemaVersion: 'oops', pet: 'nope', tasks: 42, days: 'nope' });
    const save = await loading;

    expect(save.pet.shoots).toBe(3);
    expect(save.pet.name).toBe('竹竹');
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('load：读写事务一创建就抛错时同样退回空档', async () => {
    const fake = makeDb({ transactionThrows: true });
    const store = createIdbProgressStore({ open: async () => ({ db: fake.db, issue: null }) });

    const save = await store.load();
    expect(save.pet.shoots).toBe(3);
  });

  it('save：事务 complete 后 resolve', async () => {
    const fake = makeDb();
    const store = createIdbProgressStore({ open: async () => ({ db: fake.db, issue: null }) });

    const saving = store.save(emptySave(Date.now()));
    await flush();
    fake.transactions[0].complete();

    await expect(saving).resolves.toBeUndefined();
  });

  it('save 失败（配额满 / 无痕模式）：reject 上抛，不能静默丢进度', async () => {
    const fake = makeDb();
    const store = createIdbProgressStore({ open: async () => ({ db: fake.db, issue: null }) });

    const outcome = rejection(store.save(emptySave(Date.now())));
    await flush();
    fake.transactions[0].fail(new Error('QuotaExceededError'));

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('QuotaExceededError');
  });

  it('open blocked：读退内存空档，写抛 StorageUnavailableError(blocked)', async () => {
    const open = vi.fn(async (): Promise<OpenResult> => ({ db: null, issue: 'blocked' }));
    // 冷却设得足够长：这条用例只看"这一次降级"，重试由下一条用例覆盖
    const store = createIdbProgressStore({ open, retryDelayMs: 1_000_000 });

    await expect(store.load()).resolves.toMatchObject({ pet: { shoots: 3 } });

    const error = await rejection(store.save(emptySave(Date.now())));
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as StorageUnavailableError).issue).toBe('blocked');
    expect(store.health()).toEqual({ state: 'degraded', issue: 'blocked', failures: 1 });
    // 冷却期内的 load / save 共用同一次失败，不会每次都重新 open
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('open 超时后按冷却重试：同一次会话里恢复后仍能落盘（不再永久放弃）', async () => {
    let clock = 1_000;
    let attempts = 0;
    const fake = makeDb();
    const open = vi.fn(async (): Promise<OpenResult> => {
      attempts += 1;
      return attempts === 1 ? { db: null, issue: 'timeout' } : { db: fake.db, issue: null };
    });
    const store = createIdbProgressStore({ open, retryDelayMs: 5_000, now: () => clock });

    const first = await rejection(store.save(emptySave(clock)));
    expect(first).toBeInstanceOf(StorageUnavailableError);
    expect(attempts).toBe(1);

    // 冷却期内的第二次写入：快速失败，不重复 open
    const second = await rejection(store.save(emptySave(clock)));
    expect(second).toBeInstanceOf(StorageUnavailableError);
    expect(attempts).toBe(1);

    // 冷却期过后：重新 open 并成功落盘 —— 这次会话不会永远停在内存档
    clock += 5_000;
    const third = store.save(emptySave(clock));
    await flush();
    expect(attempts).toBe(2);
    fake.transactions[0].complete();
    await expect(third).resolves.toBeUndefined();
    expect(store.health()).toEqual({ state: 'ready', issue: null, failures: 1 });
  });

  it('没有 IndexedDB（unsupported）：永久降级，不做无意义的反复重试', async () => {
    let clock = 0;
    let attempts = 0;
    const open = vi.fn(async (): Promise<OpenResult> => {
      attempts += 1;
      return { db: null, issue: 'unsupported' };
    });
    const store = createIdbProgressStore({ open, retryDelayMs: 0, now: () => clock });

    await expect(store.load()).resolves.toMatchObject({ pet: { shoots: 3 } });
    clock += 10_000;
    await expect(store.load()).resolves.toMatchObject({ pet: { shoots: 3 } });
    expect(attempts).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 真实 openIdbDatabase（fake indexedDB + fake timers）
 * ------------------------------------------------------------------ */

interface FakeOpenRequest {
  result: IDBDatabase;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
}

function installIndexedDb(requests: FakeOpenRequest[]): void {
  vi.stubGlobal('indexedDB', {
    open: (): FakeOpenRequest => {
      const request: FakeOpenRequest = {
        result: { objectStoreNames: { contains: () => false }, close: () => undefined } as unknown as IDBDatabase,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      requests.push(request);
      return request;
    },
  });
}

describe('真实 openIdbDatabase：超时兜底与不缓存结论', () => {
  it('3 秒无回调：settle 为 timeout，启动流程绝不被挂死', async () => {
    vi.useFakeTimers();
    const requests: FakeOpenRequest[] = [];
    installIndexedDb(requests);

    const result = openIdbDatabase();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toEqual({ db: null, issue: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('onblocked：立刻降级为 blocked，并清掉超时定时器', async () => {
    vi.useFakeTimers();
    const requests: FakeOpenRequest[] = [];
    installIndexedDb(requests);

    const result = openIdbDatabase();
    requests[0].onblocked?.();

    await expect(result).resolves.toEqual({ db: null, issue: 'blocked' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超时不是永久结论：下一次调用仍会重新 open，成功后拿到连接', async () => {
    vi.useFakeTimers();
    const requests: FakeOpenRequest[] = [];
    installIndexedDb(requests);

    const first = openIdbDatabase();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(first).resolves.toEqual({ db: null, issue: 'timeout' });

    const second = openIdbDatabase();
    requests[1].onsuccess?.();
    const resolved = await second;

    expect(resolved.db).not.toBeNull();
    expect(resolved.issue).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 浏览器 TTS：done 必须 resolve
 * ------------------------------------------------------------------ */

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function installSpeech(): { spoken: FakeUtterance[]; cancel: ReturnType<typeof vi.fn> } {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn();
  class Utterance implements FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }
  // 没有原生桥；window 必须有（runtime.ts 的 capacitor() 会读它）
  vi.stubGlobal('window', {});
  vi.stubGlobal('speechSynthesis', {
    speak: (utterance: FakeUtterance): void => {
      spoken.push(utterance);
    },
    cancel,
    resume: (): void => undefined,
    getVoices: (): unknown[] => [],
  });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return { spoken, cancel };
}

describe('TTS：SpeechHandle.done 契约', () => {
  it('speechTimeoutMs：按文本长度估算并夹在 2s–15s', () => {
    expect(speechTimeoutMs('')).toBe(2_000);
    expect(speechTimeoutMs('你好')).toBe(2_400);
    expect(speechTimeoutMs('a'.repeat(10))).toBe(4_000);
    // 再长也不会超过 15 秒：不能让孩子干等一个永远不来的回调
    expect(speechTimeoutMs('a'.repeat(100))).toBe(15_000);
  });

  it('没有 onend/onerror 时按文本长度超时 settle 为 unavailable', async () => {
    vi.useFakeTimers();
    const { spoken } = installSpeech();
    const bus = createWebAudioBus();

    const handle = bus.speak('你好，竹竹', 'zh-CN');
    expect(spoken).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(speechTimeoutMs(spoken[0].text));
    await expect(handle.done).resolves.toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('onend 触发时 settle 为 ended，超时兜底不会覆盖真实结局', async () => {
    vi.useFakeTimers();
    const { spoken } = installSpeech();
    const bus = createWebAudioBus();

    const handle = bus.speak('刷牙', 'zh-CN');
    spoken[0].onend?.();
    await expect(handle.done).resolves.toBe('ended');

    await vi.advanceTimersByTimeAsync(20_000);
    await expect(handle.done).resolves.toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('onerror 触发时 settle 为 unavailable（没装语音包 / 被系统打断）', async () => {
    const { spoken } = installSpeech();
    const bus = createWebAudioBus();

    const handle = bus.speak('晚安', 'zh-CN');
    spoken[0].onerror?.();
    await expect(handle.done).resolves.toBe('unavailable');
  });

  it('静音时 speak 立即 unavailable，并取消正在念的语音', async () => {
    const { spoken, cancel } = installSpeech();
    const bus = createWebAudioBus();

    bus.setMuted(true);
    expect(cancel).toHaveBeenCalled();
    await expect(bus.speak('你好', 'zh-CN').done).resolves.toBe('unavailable');
    expect(spoken).toHaveLength(0);
  });

  it('没有 Web Speech API：直接 unavailable（安卓 WebView 走原生桥）', async () => {
    vi.stubGlobal('window', {});
    const bus = createWebAudioBus();
    await expect(bus.speak('你好', 'zh-CN').done).resolves.toBe('unavailable');
  });

  it('原生 TTS 桥存在时优先走原生，失败静默降级', async () => {
    const stop = vi.fn(async (): Promise<void> => undefined);
    const speak = vi.fn(async (): Promise<void> => undefined);
    vi.stubGlobal('window', { Capacitor: { Plugins: { TextToSpeech: { speak, stop } } } });
    const bus = createWebAudioBus();

    await expect(bus.speak('你好', 'zh-CN').done).resolves.toBe('ended');
    expect(speak).toHaveBeenCalledTimes(1);
    bus.stopSpeech();
    expect(stop).toHaveBeenCalled();

    const failing = vi.fn(async (): Promise<void> => {
      throw new Error('没有语音包');
    });
    vi.stubGlobal('window', { Capacitor: { Plugins: { TextToSpeech: { speak: failing, stop } } } });
    await expect(createWebAudioBus().speak('你好', 'zh-CN').done).resolves.toBe('unavailable');
  });
});

/* ------------------------------------------------------------------ *
 * 遥测与生命周期（同属平台出口，顺手锁住"不上报"与"真切换才回调"）
 * ------------------------------------------------------------------ */

describe('本地遥测', () => {
  it('只留最近 500 条，recent 可限量；flush 不发任何请求', async () => {
    const telemetry = createLocalTelemetry();
    for (let i = 0; i < 520; i += 1) telemetry.track('session:start', { at: i });

    expect(telemetry.recent(10)).toHaveLength(10);
    expect(telemetry.recent(2_000)).toHaveLength(500);
    // track 自己打时间戳（payload 里的 at 不参与），这里只锁"砍到最近 500 条"
    expect(telemetry.recent(2_000).at(-1)?.type).toBe('session:start');
    await expect(telemetry.flush()).resolves.toBeUndefined();
  });
});

describe('生命周期', () => {
  it('只有 visibility 真正切换时才回调，退订后不再触发', () => {
    type Handler = () => void;
    const handlers: Handler[] = [];
    const visibility = { state: 'visible' };
    vi.stubGlobal('document', {
      get visibilityState(): string {
        return visibility.state;
      },
      addEventListener: (_type: string, handler: Handler): void => {
        handlers.push(handler);
      },
      removeEventListener: (_type: string, handler: Handler): void => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      },
    });

    const bus = createVisibilityLifecycle();
    const paused = vi.fn();
    const resumed = vi.fn();
    const offPause = bus.onPause(paused);
    bus.onResume(resumed);

    visibility.state = 'hidden';
    handlers.forEach((handler) => handler());
    expect(paused).toHaveBeenCalledTimes(1);
    expect(resumed).not.toHaveBeenCalled();

    visibility.state = 'visible';
    handlers.forEach((handler) => handler());
    expect(resumed).toHaveBeenCalledTimes(1);

    offPause();
    visibility.state = 'hidden';
    handlers.forEach((handler) => handler());
    expect(paused).toHaveBeenCalledTimes(1);
  });
});
