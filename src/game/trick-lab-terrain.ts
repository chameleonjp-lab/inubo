import { RAIL_HALF_WIDTH } from './rules';

/**
 * 技の練習で使う短い地形（練習配置）。競技の道とは別に、計算と描画の両方がこの定義を読む。
 * 座標: s = 地形の前方（入口から）、x = 右、y = 上。単位はメートル。
 */

export type LabFixtureId = 'flat' | 'slope' | 'stairs' | 'gap' | 'kicker' | 'curb' | 'rail' | 'ramp';

export interface LabEdge {
  id: string;
  kind: 'curb' | 'rail';
  /** 上面の高さ。 */
  top: number;
  /** 縁の中心線の横位置（試行の開始時に、進入側に合わせて符号を決める）。 */
  x: number;
  halfWidth: number;
  s0: number;
  s1: number;
}

export interface LabFixture {
  id: LabFixtureId;
  name: string;
  kind: 'line' | 'ramp';
  /** 計算する区間の長さ。これを越えたら範囲外。 */
  length: number;
  /** 説明用の短い文。 */
  note: string;
}

export interface LabSurface {
  surfaceId: string;
  height: number;
  /** 前後方向の傾き（上り正の勾配）。 */
  grade: number;
}

/** 曲面ランプの寸法（半径2.4 m、上端70°）。 */
export const RAMP_RADIUS = 2.4;
export const RAMP_TOP_ANGLE = (70 * Math.PI) / 180;
export const RAMP_TOP_Q = RAMP_RADIUS * RAMP_TOP_ANGLE;
export const RAMP_TOP_HEIGHT = RAMP_RADIUS * (1 - Math.cos(RAMP_TOP_ANGLE));
/** 縁（コーピング）の半幅。 */
export const COPING_HALF_WIDTH = 0.06;

export const STAIRS = { topHeight: 0.6, s0: 4.0, tread: 0.35, rise: 0.2, steps: 3 } as const;
export const GAP = { s0: 4.6, width: 1.2, depth: 1.0 } as const;
export const KICKER = { s0: 3.0, length: 4.0, top: 0.6 } as const;
export const SLOPE_GRADE = -0.15;
/** 縁石とレールの初期値。横位置は進入側に合わせて試行ごとに決める。 */
export const CURB = { top: 0.35, s0: 4.0, s1: 7.0 } as const;
export const RAIL = { top: 0.5, s0: 4.0, s1: 7.0 } as const;
/** レールまでの横の距離。0.4 m の横移動を2回で中心線に届く。 */
export const EDGE_OFFSET = 0.8;

export const LAB_FIXTURES: Record<LabFixtureId, LabFixture> = {
  flat: { id: 'flat', name: '平地', kind: 'line', length: 14, note: '約12 mの直線。' },
  slope: { id: 'slope', name: '緩い坂', kind: 'line', length: 14, note: '15%の下り坂。' },
  stairs: { id: 'stairs', name: '階段', kind: 'line', length: 14, note: '高さ0.20 mの踏み面が3段。' },
  gap: { id: 'gap', name: 'ギャップ', kind: 'line', length: 14, note: '幅1.20 mの開口部。' },
  kicker: { id: 'kicker', name: '踏切台', kind: 'line', length: 18, note: '長さ4.0 m、上端0.60 m。' },
  curb: { id: 'curb', name: '縁石・レッジ', kind: 'line', length: 12, note: '高さ0.35 m、長さ3.0 m。' },
  rail: { id: 'rail', name: 'レール', kind: 'line', length: 12, note: '高さ0.50 m、長さ3.0 m。' },
  ramp: { id: 'ramp', name: '曲面ランプ', kind: 'ramp', length: RAMP_TOP_Q + 2, note: '半径2.4 m、上端70°。' },
};

/** 縁石・レールの配置。side: +1 = 開始位置から見て右側。 */
export function labEdge(fixture: LabFixtureId, side: 1 | -1): LabEdge | null {
  if (fixture === 'curb') return { id: 'curb-1', kind: 'curb', top: CURB.top, x: side * EDGE_OFFSET, halfWidth: RAIL_HALF_WIDTH, s0: CURB.s0, s1: CURB.s1 };
  if (fixture === 'rail') return { id: 'rail-1', kind: 'rail', top: RAIL.top, x: side * EDGE_OFFSET, halfWidth: RAIL_HALF_WIDTH, s0: RAIL.s0, s1: RAIL.s1 };
  return null;
}

/**
 * 直線の地形の路面。開口部（ギャップ）では null を返す。
 * 縁石・レールは別の障害物として扱い、ここでは地面だけを返す。
 */
export function sampleLabSurface(fixture: LabFixtureId, s: number): LabSurface | null {
  switch (fixture) {
    case 'slope':
      return { surfaceId: 'slope', height: SLOPE_GRADE * Math.max(0, s - 2), grade: s > 2 ? SLOPE_GRADE : 0 };
    case 'stairs': {
      if (s < STAIRS.s0) return { surfaceId: 'stairs-top', height: STAIRS.topHeight, grade: 0 };
      const i = Math.floor((s - STAIRS.s0) / STAIRS.tread);
      if (i < STAIRS.steps - 1) return { surfaceId: `stairs-${i + 1}`, height: STAIRS.topHeight - STAIRS.rise * (i + 1), grade: 0 };
      return { surfaceId: 'stairs-bottom', height: 0, grade: 0 };
    }
    case 'gap':
      if (s >= GAP.s0 && s < GAP.s0 + GAP.width) return null;
      return { surfaceId: s < GAP.s0 ? 'gap-take' : 'gap-land', height: 0, grade: 0 };
    case 'kicker': {
      const { s0, length, top } = KICKER;
      if (s >= s0 && s < s0 + length) return { surfaceId: 'kicker', height: top * (s - s0) / length, grade: top / length };
      return { surfaceId: s < s0 ? 'kicker-in' : 'kicker-land', height: 0, grade: 0 };
    }
    default:
      return { surfaceId: 'flat', height: 0, grade: 0 };
  }
}

/** 曲面ランプの弧の長さ q から、水平位置と高さ、傾き（ラジアン）を返す。q > 上端は台の上。 */
export function rampPoint(q: number): { s: number; y: number; angle: number } {
  if (q <= 0) return { s: q, y: 0, angle: 0 };
  if (q <= RAMP_TOP_Q) {
    const a = q / RAMP_RADIUS;
    return { s: RAMP_RADIUS * Math.sin(a), y: RAMP_RADIUS * (1 - Math.cos(a)), angle: a };
  }
  const top = rampPoint(RAMP_TOP_Q);
  return { s: top.s + (q - RAMP_TOP_Q), y: top.y, angle: 0 };
}
