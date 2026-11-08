import type { CourseId, DogId } from '../content/types';
import type { RunResult } from '../game/types';
import type { ReplayData } from '../view/replay';

/**
 * 端末内の記録。コース・コースの版・ルールの版を組にして、総合の自己最高と完走タイムの自己最速を別々に保存する。
 * 最速の記録と、その走りの再生データは同じキーに一体で保存する（片方だけ残ることがない）。
 * 保存できない環境（プライベートブラウズなど）でも、今回の結果はそのまま読める。
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.m.set(key, value);
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
  keys(): string[] {
    return [...this.m.keys()];
  }
}

/** ブラウザの保存領域を、読み書きの失敗で止まらないように包む。使えなければ記憶領域を使う。 */
export function browserStorage(prefix = ''): StorageLike {
  try {
    const ls = globalThis.localStorage;
    const k = prefix + '__inubo_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return {
      getItem: (key) => {
        try {
          return ls.getItem(prefix + key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => ls.setItem(prefix + key, value),
      removeItem: (key) => {
        try {
          ls.removeItem(prefix + key);
        } catch {
          /* 無視 */
        }
      },
    };
  } catch {
    return new MemoryStorage();
  }
}

const NS = 'inubo:v1';

export interface RecordKey {
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
}

export function recordKeyOf(r: RecordKey): string {
  return `${r.courseId}|${r.courseVersion}|${r.rulesVersion}`;
}

export interface RecordEntry {
  runId: string;
  dogId: DogId;
  total: number;
  recordCs: number;
  timeScore: number;
  trickScore: number;
  savedAt: number;
}

interface BestTimeBlob {
  entry: RecordEntry;
  replay: ReplayData | null;
}

function read<T>(store: StorageLike, key: string): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: StorageLike, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function entryOf(r: RunResult, savedAt: number): RecordEntry {
  return { runId: r.runId, dogId: r.dogId, total: r.total, recordCs: r.recordCs, timeScore: r.timeScore, trickScore: r.trickScore, savedAt };
}

export interface SaveOutcome {
  /** 保存の処理をしたか（練習・未完走は保存しない）。 */
  attempted: boolean;
  /** 書き込みに失敗した場合 false。今回の結果の表示には影響しない。 */
  saved: boolean;
  newBestScore: boolean;
  newBestTime: boolean;
  newStamp: boolean;
  newChallenge: boolean;
}

export class Records {
  constructor(private store: StorageLike) {}

  private bestScoreKey(k: RecordKey): string {
    return `${NS}:bestScore:${recordKeyOf(k)}`;
  }

  private bestTimeKey(k: RecordKey): string {
    return `${NS}:bestTime:${recordKeyOf(k)}`;
  }

  bestScore(k: RecordKey): RecordEntry | null {
    return read<RecordEntry>(this.store, this.bestScoreKey(k));
  }

  bestTime(k: RecordKey): RecordEntry | null {
    return read<BestTimeBlob>(this.store, this.bestTimeKey(k))?.entry ?? null;
  }

  /**
   * 最速の走りの再生データ。記録と同じ走行・同じ版のものだけを返す。
   * 欠けている・別の走行のものなら null（表示を休め、別の走行の絵を当てない）。
   */
  bestTimeReplay(k: RecordKey): ReplayData | null {
    const blob = read<BestTimeBlob>(this.store, this.bestTimeKey(k));
    if (!blob || !blob.replay) return null;
    const rp = blob.replay;
    if (rp.runId !== blob.entry.runId || rp.dogId !== blob.entry.dogId) return null;
    if (rp.courseId !== k.courseId || rp.courseVersion !== k.courseVersion || rp.rulesVersion !== k.rulesVersion) return null;
    if (!Array.isArray(rp.frames) || rp.frames.length < 2) return null;
    return rp;
  }

  stamps(): Partial<Record<DogId, Partial<Record<CourseId, true>>>> {
    return read(this.store, `${NS}:stamps`) ?? {};
  }

  challenges(): Record<string, true> {
    return read(this.store, `${NS}:challenges`) ?? {};
  }

  /**
   * 完走した競技走行を保存する。保存の直前に既存の値を読み直して比べるので、
   * 別のタブで遅い走行を保存しても最速を巻き戻さない。同点・同タイムは先に保存した走行を残す。
   */
  saveLocalResult(result: RunResult, replay: ReplayData | null, now = Date.now()): SaveOutcome {
    const out: SaveOutcome = { attempted: false, saved: true, newBestScore: false, newBestTime: false, newStamp: false, newChallenge: false };
    if (result.mode !== 'competition') return out;
    out.attempted = true;
    const k: RecordKey = { courseId: result.courseId, courseVersion: result.courseVersion, rulesVersion: result.rulesVersion };
    const entry = entryOf(result, now);

    const prevScore = this.bestScore(k);
    if (!prevScore || result.total > prevScore.total) {
      out.newBestScore = true;
      out.saved = write(this.store, this.bestScoreKey(k), entry) && out.saved;
    }
    const prevTime = this.bestTime(k);
    if (!prevTime || result.recordCs < prevTime.recordCs) {
      out.newBestTime = true;
      const usable = replay && replay.runId === result.runId ? replay : null;
      out.saved = write(this.store, this.bestTimeKey(k), { entry, replay: usable } satisfies BestTimeBlob) && out.saved;
    }
    const stamps = this.stamps();
    if (!stamps[result.dogId]?.[result.courseId]) {
      out.newStamp = true;
      stamps[result.dogId] = { ...(stamps[result.dogId] ?? {}), [result.courseId]: true };
      out.saved = write(this.store, `${NS}:stamps`, stamps) && out.saved;
    }
    if (result.challengeDone) {
      const ch = this.challenges();
      const ck = `${result.courseId}|${result.courseVersion}`;
      if (!ch[ck]) {
        out.newChallenge = true;
        ch[ck] = true;
        out.saved = write(this.store, `${NS}:challenges`, ch) && out.saved;
      }
    }
    return out;
  }
}

// ---- 設定と登録情報 ----

export interface Settings {
  soundOn: boolean;
  /** 0〜1。保存済みの 0 も有効な値として扱う。 */
  volume: number;
  shake: boolean;
  light: 'normal' | 'weak';
  ghost: boolean;
}

export const DEFAULT_SETTINGS: Settings = { soundOn: true, volume: 0.8, shake: true, light: 'normal', ghost: true };

export function loadSettings(store: StorageLike): Settings {
  const s = read<Partial<Settings>>(store, `${NS}:settings`) ?? {};
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : DEFAULT_SETTINGS.soundOn,
    volume: typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : DEFAULT_SETTINGS.volume,
    shake: typeof s.shake === 'boolean' ? s.shake : DEFAULT_SETTINGS.shake,
    light: s.light === 'weak' || s.light === 'normal' ? s.light : DEFAULT_SETTINGS.light,
    ghost: typeof s.ghost === 'boolean' ? s.ghost : DEFAULT_SETTINGS.ghost,
  };
}

export function saveSettings(store: StorageLike, s: Settings): boolean {
  return write(store, `${NS}:settings`, s);
}

export interface Profile {
  name: string;
  participantId: string;
  clothes: string;
  helmet: string;
  lastDog: DogId;
  lastCourse: CourseId;
}

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadProfile(store: StorageLike): Profile {
  const p = read<Partial<Profile>>(store, `${NS}:profile`) ?? {};
  const profile: Profile = {
    name: typeof p.name === 'string' ? p.name.slice(0, 16) : '',
    participantId: typeof p.participantId === 'string' && p.participantId ? p.participantId : newId(),
    clothes: typeof p.clothes === 'string' ? p.clothes : '#e4572e',
    helmet: typeof p.helmet === 'string' ? p.helmet : '#2e86ab',
    lastDog: p.lastDog === 'corgi' || p.lastDog === 'whippet' ? p.lastDog : 'shiba',
    lastCourse: 'park',
  };
  if (!p.participantId) write(store, `${NS}:profile`, profile);
  return profile;
}

export function saveProfile(store: StorageLike, p: Profile): boolean {
  return write(store, `${NS}:profile`, p);
}
