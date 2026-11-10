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
import { speechLang } from '@bamboo/game-kit';
import { nativeTextToSpeech } from './runtime';
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

  return {
    health,
    async load(): Promise<SaveData> {
      const { db } = await connect();
      if (!db) {
        // 降级为内存：本次会话仍可玩，读到的只是内存里的（可能是空的）快照
        return memory ?? emptySave(Date.now());
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const request = tx.objectStore(STORE_NAME).get(SAVE_KEY);
          request.onsuccess = () => {
            try {
              resolve(migrate(request.result, Date.now()));
            } catch {
              resolve(emptySave(Date.now()));
            }
          };
          request.onerror = () => resolve(emptySave(Date.now()));
        } catch {
          resolve(emptySave(Date.now()));
        }
      });
    },
    async save(data: SaveData): Promise<void> {
      memory = data;
      const { db, issue: openIssue } = await connect();
      // 没有 IndexedDB 时必须让调用方知道：以前这里直接 return，
      // 上层以为写成功了，孩子关掉页面才发现今天白玩（静默丢失是最坏的结果）。
      if (!db) throw new StorageUnavailableError(openIssue ?? 'error');
      // 写失败同样必须让调用方知道（配额满 / 无痕模式）
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(data, SAVE_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('存档写入失败'));
          tx.onabort = () => reject(tx.error ?? new Error('存档写入被中止'));
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    },
  };
}

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * 朗读兜底超时：Web Speech 契约要求 `done` 必须 resolve（否则界面永远停在"正在听"）。
 * 按中文约 5 字/秒估算，再加 2 秒调度余量；下限 2 秒、上限 15 秒。
 * 抽成导出纯函数是为了让"文本长度 → 超时"这条规则可单测（而不是埋在闭包里）。
 */
export function speechTimeoutMs(text: string): number {
  return Math.min(15_000, Math.max(2_000, (text.length / 5) * 1_000 + 2_000));
}

/**
 * 零音频文件的音频总线：音效用 WebAudio 振荡器合成，语音用浏览器 TTS。
 * 真配音进来时只改这一个文件，游戏与模板一行不用动（与 CHAGS 同一出口）。
 */
export function createWebAudioBus(): AudioBus {
  let audioCtx: AudioContext | null = null;
  let muted = false;

  function context(): AudioContext | null {
    if (audioCtx) return audioCtx;
    const win = window as WebkitWindow;
    const Ctor = window.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  }

  function tone(
    freq: number,
    duration: number,
    delay = 0,
    type: OscillatorType = 'sine',
    gainLevel = 0.18,
  ): void {
    const ctx = context();
    if (!ctx || muted) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainLevel, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    // 播完就断开：游戏厅「无限畅玩」可能连玩几十局，别让输入/输出节点长期挂在 audio graph 上
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  // 全部是"柔和的正向反馈"：没有吓人的低频轰鸣，也没有失败音效。
  const patterns: Record<SfxKey, () => void> = {
    tap: () => tone(560, 0.07, 0, 'triangle', 0.14),
    correct: () => {
      tone(660, 0.12);
      tone(880, 0.16, 0.1);
    },
    retry: () => {
      tone(392, 0.12, 0, 'triangle', 0.12);
      tone(330, 0.16, 0.1, 'triangle', 0.12);
    },
    pop: () => tone(760, 0.06, 0, 'sine', 0.12),
    bubble: () => {
      tone(620, 0.09, 0, 'sine', 0.1);
      tone(760, 0.08, 0.07, 'sine', 0.1);
    },
    water: () => {
      tone(520, 0.28, 0, 'sawtooth', 0.06);
      tone(700, 0.22, 0.06, 'sine', 0.07);
    },
    chew: () => {
      tone(220, 0.07, 0, 'square', 0.08);
      tone(190, 0.08, 0.09, 'square', 0.08);
    },
    jump: () => {
      tone(520, 0.1, 0, 'triangle');
      tone(780, 0.14, 0.08, 'triangle');
    },
    sleep: () => {
      tone(440, 0.35, 0, 'sine', 0.1);
      tone(330, 0.4, 0.18, 'sine', 0.08);
    },
    unlock: () => {
      tone(523, 0.12);
      tone(659, 0.12, 0.09);
      tone(784, 0.2, 0.18);
    },
    complete: () => {
      tone(523, 0.14);
      tone(659, 0.14, 0.12);
      tone(784, 0.14, 0.24);
      tone(1046, 0.3, 0.36);
    },
    sparkle: () => {
      tone(1175, 0.12, 0, 'sine', 0.1);
      tone(1568, 0.18, 0.08, 'sine', 0.08);
    },
  };

  /** 具名函数而不是 `this.stopSpeech()`：AudioBus 是注入式接口，解构调用时 this 会丢 */
  function stopSpeechNow(): void {
    const native = nativeTextToSpeech();
    if (native) {
      void native.stop().catch(() => undefined);
      return;
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  return {
    async unlock(): Promise<void> {
      const ctx = context();
      if (ctx && ctx.state === 'suspended') await ctx.resume();
      // iOS 上语音合成同样需要一次用户手势内的调用
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.resume();
    },
    play(key: SfxKey): void {
      patterns[key]();
    },
    tone(freq: number, durationMs: number): void {
      tone(freq, durationMs / 1000, 0, 'triangle', 0.15);
    },
    speak(text: string, locale: Locale): SpeechHandle {
      if (muted) return { done: Promise.resolve('unavailable') };

      // ① 原生 TTS（安卓壳）：Android WebView 没有 Web Speech API，只能走系统语音引擎
      const native = nativeTextToSpeech();
      if (native) {
        const done = native
          .speak({
            text,
            lang: speechLang(locale),
            rate: locale === 'en' ? 0.95 : 0.92,
            pitch: 1.08,
            // 与 Web Speech 口径一致：听得清，又不会在孩子耳边炸响
            volume: 0.8,
          })
          .then((): SpeechOutcome => 'ended')
          // 设备没装语音包时失败：静默降级，绝不把界面钉在"正在听"
          .catch((): SpeechOutcome => 'unavailable');
        return { done };
      }

      // ② 没有语音 API 的浏览器：走 unavailable
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
        return { done: Promise.resolve('unavailable') };
      }
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speechLang(locale);
      // 孩子的设备常在耳边：0.9 倍速、0.8 音量，听得清又不炸响
      utterance.rate = locale === 'en' ? 0.95 : 0.92;
      utterance.pitch = 1.08;
      utterance.volume = 0.8;
      const voices = speechSynthesis.getVoices();
      const prefix = locale === 'en' ? 'en' : 'zh';
      const match = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
      if (match) utterance.voice = match;
      const done = new Promise<SpeechOutcome>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const settle = (outcome: SpeechOutcome): void => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          timer = null;
          resolve(outcome);
        };
        utterance.onend = () => settle('ended');
        utterance.onerror = () => settle('unavailable');
        // 兜底：某些 WebView / 被 cancel 打断的 utterance 不会触发 end/error，
        // 契约要求 done 必须 resolve（否则调用方永远停在"正在听"）。
        timer = setTimeout(() => settle('unavailable'), speechTimeoutMs(text));
        speechSynthesis.speak(utterance);
      });
      return { done };
    },
    stopSpeech(): void {
      stopSpeechNow();
    },
    setMuted(next: boolean): void {
      muted = next;
      if (muted) stopSpeechNow();
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
    audio: createWebAudioBus(),
    lifecycle: createVisibilityLifecycle(),
    telemetry: createLocalTelemetry(),
    now: () => Date.now(),
  };
}