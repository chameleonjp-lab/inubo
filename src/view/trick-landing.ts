import { chooseTrickFx, type TrickFxVariant } from './trick-fx';

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
  fx: TrickFxVariant;
}

export function trickLandingText(name: string, points: number, trickPoints: number, sectionUsed = false,
  extra: { basePoints?: number; switchBonus?: number; switchCount?: number } = {}): TrickLandingText {
  return {
    name,
    score: points > 0 ? `＋${points.toLocaleString('ja-JP')}` : sectionUsed ? '区間採点済み' : '加点なし',
    full: (extra.basePoints ?? trickPoints) === 1_000,
    switchBonus: Math.max(0, extra.switchBonus ?? 0),
    switchCount: Math.max(0, extra.switchCount ?? 0),
    fx: chooseTrickFx(trickPoints, name),
  };
}
