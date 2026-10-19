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
import { emptySave, migrate } from '@bamboo/progress';

const DB_NAME = 'bamboobuddy';
const STORE_NAME = 'kv';
const SAVE_KEY = 'save';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    // 隐私模式 / 存储被禁 / 旧标签页占着升级：open 可能永不回调 ——
    // 超时就退内存档，绝不让启动流程挂在这里（CHAGS 踩过的坑）。
    const timer = setTimeout(() => resolve(null), 3000);
    const request = indexedDB.open(DB_NAME, 1);
    const settle = (db: IDBDatabase | null): void => {
      clearTimeout(timer);
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => settle(request.result);
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  });
}

/** IndexedDB 存档；不可用时自动降级为内存（无痕模式 / 测试） */
export function createIdbProgressStore(): ProgressStore {
  let memory: SaveData | null = null;
  const dbPromise = openDb();

  return {
    async load(): Promise<SaveData> {
      const db = await dbPromise;
      if (!db) return memory ?? emptySave(Date.now());
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
      const db = await dbPromise;
      if (!db) return;
      // 写失败必须让调用方知道（配额满 / 无痕模式）：存档静默丢失是最坏的结果
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
      // 静音 / 没有语音 API：都走 unavailable，界面绝不会卡在"正在听"
      if (muted || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
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
        const settle = (outcome: SpeechOutcome): void => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };
        utterance.onend = () => settle('ended');
        utterance.onerror = () => settle('unavailable');
        speechSynthesis.speak(utterance);
      });
      return { done };
    },
    stopSpeech(): void {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    },
    setMuted(next: boolean): void {
      muted = next;
      if (muted) this.stopSpeech();
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

/** 默认不采集任何信息：只在本地留一份事件轨迹，方便调试与将来的家长报告 */
export function createLocalTelemetry(): Telemetry {
  const buffer: { type: string; at: number }[] = [];
  return {
    track(type): void {
      buffer.push({ type, at: Date.now() });
      if (buffer.length > 500) buffer.shift();
    },
    async flush(): Promise<void> {
      // 刻意不发送：儿童产品默认不上报任何信息
    },
  };
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