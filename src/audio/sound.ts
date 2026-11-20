import type { Settings } from '../storage/records';
import type { Cue } from '../view/effects';

/**
 * 音。1回鳴らす音（出来事ごと）と、接触中・走行中の連続音（手すりの滑走音、足音、風）を分ける。
 * 鳴らすかどうかの判断（SoundScheduler）は再生（AudioEngine）と分け、ブラウザなしで検査できるようにする。
 * - 同じ音が短い間に重なったら1回にする。同じ壁に当たり続けても接触音は最初の1回だけ。
 * - 消音中の音はためない（消音を解いたときにまとめて鳴らない）。
 * - 再開したときは、音量 0 から少しずつ戻す（復帰時に大きな音を出さない）。
 */

export interface SoundCommand {
  name: string;
  gain: number;
  /** 音の高さの倍率（区間の連続成功で段を上げる、逆回転で順を反転するなど）。 */
  pitch: number;
  reverse: boolean;
}

export interface LoopState {
  steps: { intervalMs: number; gain: number } | null;
  wind: { gain: number } | null;
  grind: { gain: number; rate: number } | null;
}

export interface MotionForSound {
  mode: 'ground' | 'air' | 'rail' | 'falling';
  speed: number;
  maxSpeed: number;
  downhill: boolean;
  paused: boolean;
  finished: boolean;
}

const DEDUPE_MS = 70;
const SAME_OBJECT_MS = 650;
const RESUME_RAMP_MS = 450;

export class SoundScheduler {
  private lastByName = new Map<string, number>();
  private lastByObj = new Map<string, number>();
  private resumedAtMs = -Infinity;
  private paused = false;
  /** 着地音を鳴らした走行とジャンプ（同じ着地の通知が重なっても1回だけ鳴らす）。 */
  private landedJumps = new Set<string>();

  constructor(private settings: Settings) {}

  setSettings(s: Settings): void {
    this.settings = s;
  }

  get audible(): boolean {
    return this.settings.soundOn && this.settings.volume > 0;
  }

  setPaused(paused: boolean, nowMs: number): void {
    if (this.paused && !paused) this.resumedAtMs = nowMs;
    this.paused = paused;
  }

  /** 全体の音量。再開の直後は 0 から戻す。 */
  master(nowMs: number): number {
    if (!this.audible || this.paused) return 0;
    const ramp = Math.min(1, Math.max(0, (nowMs - this.resumedAtMs) / RESUME_RAMP_MS));
    return this.settings.volume * (Number.isFinite(this.resumedAtMs) ? ramp : 1);
  }

  /** 演出から、今鳴らす1回の音を決める。 */
  onCues(cues: Cue[], nowMs: number): SoundCommand[] {
    const out: SoundCommand[] = [];
    if (!this.audible) return out;
    for (const c of cues) {
      if (!c.sound) continue;
      if (this.paused && c.sound !== 'ambientDown') continue;
      if (c.effect === 'E13' && c.sound.startsWith('trickLanding') && typeof c.data?.jumpId === 'number') {
        const key = `${c.runId}:${c.data.jumpId}`;
        if (this.landedJumps.has(key)) continue;
        this.landedJumps.add(key);
        if (this.landedJumps.size > 200) this.landedJumps.delete(this.landedJumps.values().next().value!);
      }
      const lastName = this.lastByName.get(c.sound);
      if (lastName !== undefined && nowMs - lastName < DEDUPE_MS) continue;
      if (c.objId && c.sound === 'thud') {
        const lastObj = this.lastByObj.get(c.objId);
        if (lastObj !== undefined && nowMs - lastObj < SAME_OBJECT_MS) continue;
        this.lastByObj.set(c.objId, nowMs);
      }
      this.lastByName.set(c.sound, nowMs);
      const streak = typeof c.data?.streak === 'number' ? c.data.streak : 0;
      const name = String(c.data?.name ?? '');
      out.push({
        name: c.sound,
        gain: this.master(nowMs),
        pitch: c.sound === 'stepUp' ? 1 + 0.12 * Math.max(0, streak - 1) : 1,
        reverse: (c.sound === 'dogSpinV' || c.sound === 'dogSpinH') && (name.includes('後ろ') || name.includes('左')),
      });
    }
    return out;
  }

  /** 連続音: 足音の間隔と風は速さに合わせ、滑走音は手すりに触れている間だけ鳴らす。 */
  loops(m: MotionForSound, nowMs: number): LoopState {
    const g = this.master(nowMs);
    if (g <= 0 || m.paused || m.finished) return { steps: null, wind: null, grind: null };
    const f = Math.max(0, Math.min(1.4, m.speed / Math.max(1, m.maxSpeed)));
    return {
      steps: m.mode === 'ground' && !m.downhill && m.speed > 0.5 ? { intervalMs: 420 - 230 * Math.min(1, f), gain: g * 0.5 } : null,
      wind: m.speed > 2 ? { gain: g * (m.mode === 'air' ? 0.35 : 0.18) * f } : null,
      grind: m.mode === 'rail' ? { gain: g * 0.5, rate: 0.8 + 0.5 * f } : null,
    };
  }
}

// ---------------------------------------------------------------------------
// ブラウザでの再生（Web Audio で音を合成する。外部の音声ファイルは使わない）。
// ---------------------------------------------------------------------------

type Tone = { f: number; t: number; d: number; type?: OscillatorType; g?: number };

const TONES: Record<string, Tone[]> = {
  select: [{ f: 880, t: 0, d: 0.06 }],
  decide: [{ f: 660, t: 0, d: 0.07 }, { f: 990, t: 0.07, d: 0.09 }],
  back: [{ f: 520, t: 0, d: 0.08, type: 'triangle' }],
  beat: [{ f: 440, t: 0, d: 0.08, type: 'square', g: 0.4 }],
  go: [{ f: 660, t: 0, d: 0.08 }, { f: 880, t: 0.06, d: 0.12 }, { f: 1320, t: 0.12, d: 0.18 }],
  kickUp: [{ f: 140, t: 0, d: 0.05, type: 'square', g: 0.3 }],
  jump: [{ f: 300, t: 0, d: 0.06, type: 'triangle' }],
  jumpBig: [{ f: 260, t: 0, d: 0.06, type: 'triangle' }, { f: 520, t: 0.05, d: 0.18, type: 'sine', g: 0.5 }],
  dogSpinV: [{ f: 520, t: 0, d: 0.06 }, { f: 700, t: 0.06, d: 0.06 }],
  dogSpinH: [{ f: 600, t: 0, d: 0.06, type: 'triangle' }, { f: 800, t: 0.06, d: 0.06, type: 'triangle' }],
  bodyWhoosh: [{ f: 220, t: 0, d: 0.22, type: 'sawtooth', g: 0.18 }],
  bodyWhoosh2: [{ f: 220, t: 0, d: 0.22, type: 'sawtooth', g: 0.18 }, { f: 760, t: 0.12, d: 0.05 }],
  compositeCue: [{ f: 980, t: 0, d: 0.05, g: 0.5 }],
  chord2: [{ f: 660, t: 0, d: 0.28 }, { f: 990, t: 0, d: 0.28 }],
  hintSoft: [{ f: 400, t: 0, d: 0.1, type: 'sine', g: 0.3 }],
  tap: [{ f: 520, t: 0, d: 0.04, type: 'triangle', g: 0.5 }],
  stepChoose: [{ f: 180, t: 0, d: 0.04, type: 'square', g: 0.25 }],
  railOn: [{ f: 1200, t: 0, d: 0.05, type: 'triangle' }],
  confirm: [{ f: 1046, t: 0, d: 0.08 }],
  landSoft: [{ f: 180, t: 0, d: 0.08, type: 'triangle' }],
  landPerfect: [{ f: 1046, t: 0, d: 0.12 }, { f: 1568, t: 0.08, d: 0.16 }],
  trickLandingTap: [{ f: 330, t: 0, d: 0.09, type: 'triangle', g: 0.54 }],
  trickLandingChime: [{ f: 523, t: 0, d: 0.09, g: 0.53 }, { f: 784, t: 0.065, d: 0.13, g: 0.48 }],
  trickLandingRise: [
    { f: 523, t: 0, d: 0.1, g: 0.54 }, { f: 659, t: 0.065, d: 0.12, g: 0.49 }, { f: 1047, t: 0.13, d: 0.16, g: 0.43 },
  ],
  trickLandingChord: [
    { f: 392, t: 0, d: 0.12, type: 'triangle', g: 0.5 }, { f: 523, t: 0.055, d: 0.11, g: 0.42 },
    { f: 784, t: 0.13, d: 0.22, g: 0.32 }, { f: 1047, t: 0.13, d: 0.24, g: 0.27 }, { f: 1319, t: 0.13, d: 0.25, g: 0.2 },
  ],
  trickLandingFinale: [
    { f: 262, t: 0, d: 0.19, type: 'triangle', g: 0.5 }, { f: 523, t: 0.045, d: 0.12, g: 0.37 },
    { f: 659, t: 0.095, d: 0.12, g: 0.39 }, { f: 784, t: 0.145, d: 0.14, g: 0.4 },
    { f: 1047, t: 0.21, d: 0.3, g: 0.29 }, { f: 1319, t: 0.21, d: 0.28, g: 0.23 }, { f: 1568, t: 0.21, d: 0.24, g: 0.17 },
  ],
  landBad: [{ f: 110, t: 0, d: 0.14, type: 'square', g: 0.4 }],
  recover: [{ f: 260, t: 0, d: 0.06, type: 'triangle' }, { f: 330, t: 0.06, d: 0.06, type: 'triangle' }],
  thud: [{ f: 90, t: 0, d: 0.12, type: 'square', g: 0.6 }],
  kick: [{ f: 150, t: 0, d: 0.05, type: 'square', g: 0.3 }],
  bell: [{ f: 1760, t: 0, d: 0.2, type: 'sine', g: 0.4 }],
  mech: [{ f: 130, t: 0, d: 0.12, type: 'sawtooth', g: 0.2 }],
  flag: [{ f: 784, t: 0, d: 0.08, type: 'triangle' }],
  fallDown: [{ f: 600, t: 0, d: 0.1 }, { f: 400, t: 0.1, d: 0.1 }, { f: 250, t: 0.2, d: 0.16 }],
  respawn: [{ f: 523, t: 0, d: 0.08 }, { f: 784, t: 0.08, d: 0.12 }],
  bag: [{ f: 300, t: 0, d: 0.05, type: 'square', g: 0.3 }, { f: 700, t: 0.06, d: 0.08 }, { f: 1050, t: 0.13, d: 0.1 }],
  up2: [{ f: 700, t: 0, d: 0.08 }, { f: 1050, t: 0.08, d: 0.1 }],
  downSoft: [{ f: 600, t: 0, d: 0.1, type: 'sine', g: 0.3 }, { f: 450, t: 0.1, d: 0.12, type: 'sine', g: 0.3 }],
  slip: [{ f: 240, t: 0, d: 0.16, type: 'sawtooth', g: 0.25 }],
  stepsBack: [{ f: 330, t: 0, d: 0.06, type: 'triangle', g: 0.4 }],
  wood: [{ f: 640, t: 0, d: 0.05, type: 'triangle' }],
  stepUp: [{ f: 660, t: 0, d: 0.08 }],
  chord3: [{ f: 523, t: 0, d: 0.3 }, { f: 659, t: 0, d: 0.3 }, { f: 784, t: 0, d: 0.3 }],
  demoBeat: [{ f: 600, t: 0, d: 0.04, g: 0.4 }],
  stamp: [{ f: 220, t: 0, d: 0.06, type: 'square', g: 0.4 }, { f: 660, t: 0.04, d: 0.08 }],
  ambientDown: [{ f: 400, t: 0, d: 0.12, type: 'sine', g: 0.25 }],
  ambientUp: [{ f: 500, t: 0, d: 0.12, type: 'sine', g: 0.2 }],
  readyCue: [{ f: 440, t: 0, d: 0.06 }, { f: 440, t: 0.12, d: 0.06 }],
  arrive: [{ f: 784, t: 0, d: 0.12 }, { f: 1046, t: 0.1, d: 0.2 }],
  tick: [{ f: 880, t: 0, d: 0.04, g: 0.4 }],
  best3: [{ f: 659, t: 0, d: 0.1 }, { f: 880, t: 0.1, d: 0.1 }, { f: 1318, t: 0.2, d: 0.2 }],
  windSlide: [{ f: 200, t: 0, d: 0.3, type: 'sawtooth', g: 0.12 }],
  stepSwitch: [{ f: 260, t: 0, d: 0.03, type: 'square', g: 0.18 }],
  skid: [{ f: 180, t: 0, d: 0.12, type: 'sawtooth', g: 0.14 }],
};

/**
 * 81種類の着地L の音。段階ごとに音の並び・重ね方・長さを変える（外部の音声ファイルは使わない）。
 * 両方Bは犬（三角波・低め）と人（正弦波・高め）が交互に応える。人だけHは高めで軽く、犬だけDは低めで柔らかい。
 * どの段階も同時に鳴る音は7つまで。急に大きな音にしないよう、音が増えるほど1音ずつは小さくする。
 */
type NoteStep = [semitone: number, t: number, d: number];
const FX_LANDING_PATTERNS: readonly (readonly NoteStep[])[] = [
  [[-5, 0, 0.09]], // 01 低い単音を短く1回
  [[7, 0, 0.24]], // 02 明るい単音＋短い余韻
  [[0, 0, 0.09], [4, 0.07, 0.12]], // 03 2音が順に上がる
  [[-12, 0, 0.16], [7, 0, 0.16]], // 04 低音と高音の二音が同時
  [[0, 0, 0.08], [4, 0.06, 0.08], [7, 0.12, 0.14]], // 05 3音の短い上昇
  [[-5, 0, 0.1], [4, 0.07, 0.1], [12, 0.14, 0.18]], // 06 中低音から高音への3音
  [[0, 0, 0.08], [4, 0.06, 0.08], [7, 0.12, 0.08], [12, 0.18, 0.12], [16, 0.26, 0.3], [19, 0.26, 0.3]], // 07 4音の上昇＋柔らかい和音
  [[-12, 0, 0.1], [12, 0.08, 0.14], [16, 0.08, 0.14], [-12, 0.2, 0.1], [19, 0.28, 0.22]], // 08 低音の拍と高音の和音を交互
  [[0, 0, 0.07], [2, 0.05, 0.07], [4, 0.1, 0.07], [7, 0.15, 0.07], [9, 0.2, 0.08], [12, 0.25, 0.42]], // 09 6音の連続上昇＋長めの余韻
  [[-12, 0, 0.22], [0, 0.05, 0.12], [4, 0.1, 0.12], [7, 0.15, 0.14], [12, 0.23, 0.34], [16, 0.23, 0.32], [19, 0.23, 0.3]], // 10 7音の和音フィナーレ
];
const FX_LANDING_BASE = { B: 392, H: 494, D: 311 } as const;
for (const [target, base] of Object.entries(FX_LANDING_BASE) as ['B' | 'H' | 'D', number][]) {
  FX_LANDING_PATTERNS.forEach((pattern, i) => {
    const each = 0.56 / Math.sqrt(pattern.length);
    TONES[`trickLanding${target}${String(i + 1).padStart(2, '0')}`] = pattern.map(([semi, at, d], k) => ({
      f: base * 2 ** (semi / 12),
      t: at,
      d: target === 'D' ? d * 1.15 : target === 'H' ? d * 0.9 : d,
      type: target === 'D' ? 'triangle' : target === 'H' ? 'sine' : k % 2 ? 'sine' : 'triangle',
      g: each,
    }));
  });
}

/** すべての1回音に合成の定義があるかを検査で確かめるため、名前の一覧を出す。 */
export function synthNames(): string[] {
  return Object.keys(TONES);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private grindOsc: OscillatorNode | null = null;
  private grindGain: GainNode | null = null;
  private nextStepMs = 0;
  private trickLandingNotes = new Set<OscillatorNode>();

  /** 最初の操作・再開の操作の中で呼ぶ（ブラウザはユーザー操作から音を開始できる）。 */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  stopTrickLanding(): void {
    for (const osc of this.trickLandingNotes) osc.stop();
    this.trickLandingNotes.clear();
  }

  suspend(): void {
    try {
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    } catch {
      /* 無視 */
    }
  }

  play(cmd: SoundCommand): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || cmd.gain <= 0) return;
    const tones = TONES[cmd.name];
    if (!tones) return;
    const now = ctx.currentTime;
    const isTrickLanding = cmd.name.startsWith('trickLanding');
    if (isTrickLanding) this.stopTrickLanding();
    const list = cmd.reverse ? tones.slice().reverse().map((t, i, arr) => ({ ...t, t: arr[arr.length - 1 - i].t })) : tones;
    for (const t of list) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = t.type ?? 'sine';
      osc.frequency.value = t.f * cmd.pitch;
      const peak = 0.25 * (t.g ?? 1) * cmd.gain;
      g.gain.setValueAtTime(0, now + t.t);
      g.gain.linearRampToValueAtTime(peak, now + t.t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t.t + t.d);
      osc.connect(g).connect(this.master);
      osc.start(now + t.t);
      osc.stop(now + t.t + t.d + 0.02);
      if (isTrickLanding) {
        this.trickLandingNotes.add(osc);
        osc.onended = () => this.trickLandingNotes.delete(osc);
      }
    }
  }

  private noiseBurst(gain: number, dur: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || gain <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain * 0.4, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 0.5, dur + 0.05);
  }

  /** 毎フレーム呼ぶ。全体の音量と連続音を、判断の結果に合わせる。 */
  update(masterGain: number, loops: LoopState, nowMs: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    if (masterGain <= 0) this.stopTrickLanding();
    this.master.gain.setTargetAtTime(masterGain > 0 ? 1 : 0, t, 0.05);
    // 風
    if (loops.wind) {
      if (!this.windSrc) {
        this.windSrc = ctx.createBufferSource();
        this.windSrc.buffer = this.noise;
        this.windSrc.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        this.windSrc.connect(f).connect(this.windGain).connect(this.master);
        this.windSrc.start();
      }
      this.windGain!.gain.setTargetAtTime(loops.wind.gain * 0.5, t, 0.1);
    } else if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0, t, 0.1);
    }
    // 手すりの滑走音（触れている間だけ）
    if (loops.grind) {
      if (!this.grindOsc) {
        this.grindOsc = ctx.createOscillator();
        this.grindOsc.type = 'sawtooth';
        this.grindGain = ctx.createGain();
        this.grindGain.gain.value = 0;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        this.grindOsc.connect(f).connect(this.grindGain).connect(this.master);
        this.grindOsc.start();
      }
      this.grindOsc.frequency.setTargetAtTime(240 * loops.grind.rate, t, 0.05);
      this.grindGain!.gain.setTargetAtTime(loops.grind.gain * 0.12, t, 0.03);
    } else if (this.grindGain) {
      this.grindGain.gain.setTargetAtTime(0, t, 0.02);
    }
    // 足音（速いほど間隔が短い）
    if (loops.steps && nowMs >= this.nextStepMs) {
      this.noiseBurst(loops.steps.gain * masterGain, 0.05, 1400);
      this.nextStepMs = nowMs + loops.steps.intervalMs;
    }
  }
}
