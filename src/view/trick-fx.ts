import { fxId, fxProgram, type FxId, type FxKind, type FxProgram, type FxTarget } from './trick-fx-81';

export type { FxId, FxKind, FxProgram, FxTarget } from './trick-fx-81';

/**
 * 81種類の演出から、段階と対象を選ぶ純粋な関数。画面・時刻・乱数には依存しない。
 * ここで扱う点は「見た目専用の難度値」で、ゲームの得点・記録・ランキングには一切戻さない。
 */

/** 派手さFと着地Lの10段階の下限（以上で判定）。 */
export const FX_FL_THRESHOLDS = [1, 80, 160, 260, 400, 550, 700, 950, 1250, 1650] as const;
/** 空中の軌跡Aの7段階の下限（以上で判定）。 */
export const FX_A_THRESHOLDS = [1, 160, 400, 700, 950, 1250, 1650] as const;
/** 着地L01〜L10の文字の表示上限（ms）。 */
export const FX_LANDING_DURATIONS_MS = [1000, 1100, 1200, 1350, 1500, 1600, 1700, 1800, 1900, 2000] as const;

/**
 * 見た目の段階を決めるための難度値。犬だけ・人だけの技でも基礎回転点が満点なら最高段階に届くよう、
 * 基礎点を1.65倍した値と実際の技点の大きい方を使う。表示する得点・加点・保存には使わない。
 */
export function visualDifficultyPoints(basePoints: number, actualTrickPoints: number): number {
  const base = Math.max(0, Math.min(1000, Math.floor(Number.isFinite(basePoints) ? basePoints : 0)));
  const actual = Math.max(0, Math.min(2050, Math.floor(Number.isFinite(actualTrickPoints) ? actualTrickPoints : 0)));
  return Math.min(2050, Math.max(actual, Math.round(base * 1.65)));
}

/** 下限の表から段階（1始まり）を返す。1点未満・NaN・負の値は0（段階なし）。 */
export function fxLevel(points: number, thresholds: readonly number[]): number {
  if (!Number.isFinite(points) || points < thresholds[0]) return 0;
  let level = 0;
  for (const min of thresholds) if (points >= min) level++;
  return level;
}
export const emphasisLevel = (points: number): number => fxLevel(points, FX_FL_THRESHOLDS);
export const trailLevel = (points: number): number => fxLevel(points, FX_A_THRESHOLDS);
export const landingLevel = (points: number): number => fxLevel(points, FX_FL_THRESHOLDS);

/** 計算側の対象（common/dog/rider）を演出の対象（B/D/H）へ写す。 */
export function fxTargetOf(target: 'common' | 'dog' | 'rider' | null | undefined): FxTarget | null {
  return target === 'common' ? 'B' : target === 'dog' ? 'D' : target === 'rider' ? 'H' : null;
}
export function isFxTarget(value: unknown): value is FxTarget {
  return value === 'B' || value === 'H' || value === 'D';
}

export interface LandingFx {
  target: FxTarget;
  difficulty: number;
  emphasis: FxProgram;
  trail: FxProgram;
  landing: FxProgram;
}

/**
 * 着地で確定した実回転の対象と、確定した基礎点・技点から、着地Lと（文字用の）F・Aを決める。
 * 技が成立していない着地（0点）は普通の着地として扱い、null を返す。
 */
export function chooseLandingFx(target: FxTarget | null, basePoints: number, trickPoints: number): LandingFx | null {
  if (!target) return null;
  const difficulty = visualDifficultyPoints(basePoints, trickPoints);
  const l = landingLevel(difficulty);
  if (l < 1) return null;
  return {
    target, difficulty,
    emphasis: fxProgram(fxId(target, 'F', emphasisLevel(difficulty))!),
    trail: fxProgram(fxId(target, 'A', Math.max(1, trailLevel(difficulty)))!),
    landing: fxProgram(fxId(target, 'L', l)!),
  };
}

/** 空中の派手さF・軌跡Aを選ぶ。踏切直後はF01だけ、Aは実際に回り始めてから。 */
export function chooseAirFx(target: FxTarget, difficulty: number, rotating: boolean): { emphasis: FxId; trail: FxId | null } {
  return {
    emphasis: fxId(target, 'F', Math.max(1, emphasisLevel(difficulty)))!,
    trail: rotating ? fxId(target, 'A', Math.max(1, trailLevel(difficulty)))! : null,
  };
}

/** 着地音の名前（B/H/D × L01〜L10 の30種類）。 */
export function landingSoundName(target: FxTarget, level: number): string {
  return `trickLanding${target}${String(Math.max(1, Math.min(10, level))).padStart(2, '0')}`;
}

export function kindOf(id: FxId): FxKind {
  return id[2] as FxKind;
}
