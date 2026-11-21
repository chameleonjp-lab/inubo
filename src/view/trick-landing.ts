import { FX_LANDING_DURATIONS_MS, chooseLandingFx, isFxTarget, type FxId, type FxTarget } from './trick-fx';

/** 従来の5段階（技名の文字の強さと、旧ルールの記録の着地音）。新しい81種類の段階とは別に残す。 */
export const TRICK_LANDING = [
  { sound: 'trickLandingTap', durationMs: 1_000 },
  { sound: 'trickLandingChime', durationMs: 1_200 },
  { sound: 'trickLandingRise', durationMs: 1_400 },
  { sound: 'trickLandingChord', durationMs: 1_700 },
  { sound: 'trickLandingFinale', durationMs: 2_000 },
] as const;

export interface TrickLandingText {
  name: string;
  score: string;
  full: boolean;
  switchBonus: number;
  switchCount: number;
  directionCount: number;
  /** 着地の実回転の対象（B=両方、H=人、D=犬）。情報が無い記録では null。 */
  fxTarget: FxTarget | null;
  emphasisId: FxId | null;
  trailId: FxId | null;
  landingId: FxId | null;
  /** 着地L の段階（1〜10）。無ければ0。 */
  landingLevel: number;
  /** 着地L の表示上限（ms）。無ければ null（従来の5段階の長さを使う）。 */
  durationMs: number | null;
}

export function trickLandingText(name: string, points: number, trickPoints: number, sectionUsed = false,
  extra: { basePoints?: number; switchBonus?: number; switchCount?: number; directionCount?: number; fxTarget?: unknown } = {}): TrickLandingText {
  const basePoints = extra.basePoints ?? trickPoints;
  const chosen = chooseLandingFx(isFxTarget(extra.fxTarget) ? extra.fxTarget : null, basePoints, trickPoints);
  return {
    name,
    // 区間が採点済みでも、演出の段階は技の難しさで決める。点の表示だけ「区間採点済み」にする。
    score: points > 0 ? `＋${points.toLocaleString('ja-JP')}` : sectionUsed ? '区間採点済み' : '加点なし',
    full: basePoints === 1_000,
    switchBonus: Math.max(0, extra.switchBonus ?? 0),
    switchCount: Math.max(0, extra.switchCount ?? 0),
    directionCount: Math.max(0, extra.directionCount ?? 0),
    fxTarget: chosen?.target ?? null,
    emphasisId: chosen?.emphasis.id ?? null,
    trailId: chosen?.trail.id ?? null,
    landingId: chosen?.landing.id ?? null,
    landingLevel: chosen?.landing.level ?? 0,
    durationMs: chosen ? FX_LANDING_DURATIONS_MS[chosen.landing.level - 1] : null,
  };
}
