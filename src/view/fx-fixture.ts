import type { FxProgram } from './trick-fx-81';

/**
 * 確認版の「固定比較」（Q02）で使う、時刻の決め方と結果の分け方。
 * 同じ姿勢・同じ時刻・同じカメラで「演出あり」「演出なし」を続けて描き、画素の差を比べる。
 */

export type FixturePhase = 'start' | 'peak' | 'end';
export type FixtureBackdrop = 'sky' | 'bright-road' | 'dark-road' | 'wall';
export const FIXTURE_BACKDROPS: readonly FixtureBackdrop[] = ['sky', 'bright-road', 'dark-road', 'wall'];

/** 空中の演出は、回り始めてからこの時間だけたった姿勢で始める（姿勢を毎回同じにする）。 */
export const FIXTURE_AIR_START_US = 300_000;
/** 1コマの長さ。描画の速さに左右されないよう、固定の刻みで進める。 */
export const FIXTURE_STEP_MS = 16;

/**
 * 各IDの「出始め・いちばん明るい頃・消える手前」の時刻（演出の開始からのms）。
 * 一度だけの短い光（F01 など）は、立ち上がりの長さから山を決める。続く演出と着地は寿命から決める。
 */
export function fixtureTimes(prog: FxProgram): Record<FixturePhase, number> {
  if (prog.kind === 'L') {
    const life = prog.lifetimeMs;
    return { start: 32, peak: Math.round(life * 0.3 / FIXTURE_STEP_MS) * FIXTURE_STEP_MS, end: Math.round(life * 0.85 / FIXTURE_STEP_MS) * FIXTURE_STEP_MS };
  }
  const oneShot = prog.recipe.every(step => step.dur > 0);
  if (oneShot) {
    const step = prog.recipe[0];
    const rise = step.p?.rise ?? Math.min(140, step.dur * 0.3);
    const peak = Math.max(48, Math.round((step.t0 + rise) / FIXTURE_STEP_MS) * FIXTURE_STEP_MS);
    const end = Math.round((step.t0 + step.dur * 0.85) / FIXTURE_STEP_MS) * FIXTURE_STEP_MS;
    return { start: 32, peak, end: Math.max(peak + FIXTURE_STEP_MS, end) };
  }
  return { start: 64, peak: 400, end: 896 };
}

export interface FixtureDiff {
  /** 比べた範囲（犬と人のまわり）の画素数。 */
  roiPixels: number;
  /** 色の差の合計（RGB）が30を超えた画素の数。 */
  changed: number;
  /** 色の差の合計が90を超えた（はっきり違う）画素の数。 */
  strong: number;
  /** いちばん大きく変わった画素の差（0〜765）。 */
  maxDelta: number;
}

export type FixtureStatus = 'valid' | 'invalid_fixture';
export type FixtureVisibility = 'clear' | 'weak' | 'buried';

export interface FixtureResult {
  id: string;
  phase: FixturePhase;
  tMs: number;
  backdrop: FixtureBackdrop;
  status: FixtureStatus;
  /** 無効の理由：not_active（そのIDが出ていない）・no_commands（描く命令が0）・webgl_lost・no_canvas。 */
  reason: string | null;
  activeIds: string[];
  commands: { lines: number; dots: number; decals: number };
  viewport: { width: number; height: number; dpr: number };
  diff: FixtureDiff | null;
  /** 有効なときだけ：clear（はっきり）・weak（弱い）・buried（描いたが背景に埋もれて差が出ない）。 */
  visibility: FixtureVisibility | null;
}

/** 描けたかどうか（無効の理由）と、描けたときの見え方を決める。 */
export function classifyFixture(id: string, activeIds: string[], commands: { lines: number; dots: number; decals: number }, diff: FixtureDiff | null, webglLost = false):
  Pick<FixtureResult, 'status' | 'reason' | 'visibility'> {
  if (webglLost) return { status: 'invalid_fixture', reason: 'webgl_lost', visibility: null };
  if (!diff) return { status: 'invalid_fixture', reason: 'no_canvas', visibility: null };
  if (!activeIds.includes(id)) return { status: 'invalid_fixture', reason: 'not_active', visibility: null };
  if (commands.lines + commands.dots + commands.decals === 0) return { status: 'invalid_fixture', reason: 'no_commands', visibility: null };
  const visibility: FixtureVisibility = diff.changed === 0 ? 'buried' : diff.strong >= 12 || diff.changed >= 80 ? 'clear' : 'weak';
  return { status: 'valid', reason: null, visibility };
}
