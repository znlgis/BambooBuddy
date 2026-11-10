import type { AudioBus, Locale, SfxKey, SpeechHandle, SpeechOutcome } from '@bamboo/game-kit';
import { speechLang } from '@bamboo/game-kit';
import { nativeTextToSpeech } from './runtime';

/**
 * 音频与朗读实现（**懒加载模块**）。
 *
 * 为什么单独一个文件：首屏 gzip 预算是硬线（60 KB），而这 200 行振荡器合成 + TTS
 * 只有"孩子真的听到声音/点朗读"时才需要。外壳通过 createWebPlatform().audio 拿到的
 * 是一个转发代理（见 web.ts 的 createLazyAudioBus），页面上第一次用户手势之前通常已经
 * 预取完成；即便没完成，音效丢掉一声也不会影响任何玩法判定，而朗读的 done 契约仍保证 resolve。
 *
 * 单测直接从这里导入（createWebAudioBus / speechTimeoutMs），web.ts 不再静态引用本模块。
 */

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
