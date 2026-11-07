import {
  ATTITUDE_TAU_US,
  BASE_SPEED,
  DROP_OVERREACH,
  EDGE_MARGIN,
  GRAVITY,
  LATERAL_SPEED,
  LAUNCH_ACCEL,
  RAIL_SNAP,
  SLOPE_ACCEL,
} from './rules';
import { clamp } from './math';
import { multiplierBp } from './items';
import {
  baseGrade,
  baseHeight,
  hwAt,
  lateralLimits,
  railGrade,
  railTopAt,
  sampleAt,
  supportGrade,
  supportHeight,
  type PathRt,
} from './track';
import type { SimState } from './types';

/**
 * 道に沿った前進、左右の目標位置への移動、高さ（重力）を扱う。
 * カーブでは横位置に応じて「実際に通った距離」で進む（内側ほど短い距離で同じだけ進む）。
 */

export function maxSpeed(run: SimState): number {
  return (BASE_SPEED * run.dog.speedIndex) / 100;
}

export function lateralSpeedOf(run: SimState): number {
  return (LATERAL_SPEED * run.dog.handlingIndex) / 100;
}

export function currentPath(run: SimState): PathRt {
  return run.course.paths.get(run.pathId)!;
}

/** 上りは緩やかに減速、下りは緩やかに加速する目標の倍率。 */
export function slopeFactor(grade: number): number {
  if (grade > 0) return Math.max(0.6, 1 - 2 * grade);
  return Math.min(1.35, 1 - 1.5 * grade);
}

export function surfaceGradeAt(run: SimState): number {
  const p = currentPath(run);
  if (run.mode === 'rail' && run.rail) return railGrade(run.course.railsById.get(run.rail.railId)!);
  return supportGrade(p, run.s, run.x, run.y, run.simUs);
}

/** 1刻みごとに通常速度（犬種と路面で決まる速さ）を更新する。効果の倍率はここでは掛けない。 */
export function updateBaseSpeed(run: SimState, dtUs: number): void {
  const vmax = maxSpeed(run);
  const dt = dtUs / 1e6;
  if (run.blocked) {
    run.baseSpeed = 0;
    return;
  }
  if (run.mode === 'falling') return;
  if (run.mode === 'air') {
    if (run.baseSpeed < 0.8 * vmax) run.baseSpeed = Math.min(vmax, run.baseSpeed + LAUNCH_ACCEL * dt);
    return;
  }
  const target = vmax * slopeFactor(surfaceGradeAt(run));
  const b = run.baseSpeed;
  if (b < target) run.baseSpeed = Math.min(target, b + (b < 0.8 * vmax ? LAUNCH_ACCEL : SLOPE_ACCEL) * dt);
  else if (b > target) run.baseSpeed = Math.max(target, b - SLOPE_ACCEL * dt);
}

/** 最終の前進速度。前方が塞がっていれば 0。効果の倍率を掛ける。 */
export function forwardSpeedAt(run: SimState, tUs: number): number {
  if (run.blocked || run.mode === 'falling' || run.finished) return 0;
  return (run.baseSpeed * multiplierBp(run.effects, tUs)) / 10_000;
}

export function targetLimits(p: PathRt, s: number): [number, number] {
  return lateralLimits(p, s, EDGE_MARGIN, DROP_OVERREACH);
}

export function setTarget(run: SimState, x: number): void {
  const [lo, hi] = targetLimits(currentPath(run), run.s);
  run.targetX = clamp(x, lo, hi);
}

/** 1区間の間、一定とみなす動きの値。 */
export interface SegmentMotion {
  path: PathRt;
  s0: number;
  x0: number;
  y0: number;
  vy0: number;
  /** 道に沿った距離が進む速さ m/s。 */
  dsdt: number;
  /** 横の速さ m/s（目標に着くまで一定）。 */
  latV: number;
  /** 目標の横位置に着くまでの時間 µs（着かない場合 Infinity）。 */
  reachUs: number;
  air: boolean;
  rail: boolean;
  t0: number;
}

export function segmentMotion(run: SimState, t0: number): SegmentMotion {
  const p = currentPath(run);
  const v = forwardSpeedAt(run, t0);
  const kappa = sampleAt(p, run.s).kappa;
  const onRail = run.mode === 'rail';
  const dsdt = onRail ? v : v / Math.max(0.3, 1 - kappa * run.x);
  let latV = 0;
  let reachUs = Infinity;
  if (!onRail && run.mode !== 'falling') {
    const d = run.targetX - run.x;
    // 側面に当たっている間は、その向きへは動かない（離れる向きには動ける）。
    const pushingWall = run.blocked?.face === 'side' && Math.sign(d) === run.blocked.side;
    if (Math.abs(d) > 1e-9 && !pushingWall) {
      const ls = lateralSpeedOf(run);
      latV = Math.sign(d) * ls;
      reachUs = (Math.abs(d) / ls) * 1e6;
    }
  }
  return { path: p, s0: run.s, x0: run.x, y0: run.y, vy0: run.vy, dsdt, latV, reachUs, air: run.mode === 'air' || run.mode === 'falling', rail: onRail, t0 };
}

export interface MotionPoint {
  s: number;
  x: number;
  y: number;
  vy: number;
}

/** 区間の開始から tau µs 後の位置。地上の高さはあとで路面へ合わせる。 */
export function pointAt(m: SegmentMotion, tau: number, run: SimState): MotionPoint {
  const dt = tau / 1e6;
  const s = m.s0 + m.dsdt * dt;
  const x = m.latV === 0 ? m.x0 : tau >= m.reachUs ? run.targetX : m.x0 + m.latV * dt;
  if (m.air) {
    return { s, x, y: m.y0 + m.vy0 * dt - 0.5 * GRAVITY * dt * dt, vy: m.vy0 - GRAVITY * dt };
  }
  if (m.rail && run.rail) {
    const r = run.course.railsById.get(run.rail.railId)!;
    return { s, x, y: railTopAt(r, s), vy: 0 };
  }
  return { s, x, y: m.y0, vy: 0 };
}

/** 道の端の外（落下側）にいるか。 */
export function offRoad(p: PathRt, s: number, x: number): boolean {
  const hw = hwAt(p, s);
  if (x < -hw) return p.edges[0] === 'drop';
  if (x > hw) return p.edges[1] === 'drop';
  return false;
}

/** 空中で足元が着く面の高さ。道の外では面がない。 */
export function landingSupport(p: PathRt, s: number, x: number, y: number, tUs: number): number {
  if (offRoad(p, s, x)) return -Infinity;
  return supportHeight(p, s, x, y, tUs);
}

/** 空中の基本姿勢を、下にある着地面の傾きへゆっくりそろえる。地上・手すりでは面に合わせる。 */
export function updateAttitude(run: SimState, dtUs: number): void {
  const p = currentPath(run);
  if (run.mode === 'ground') {
    run.basePitch = Math.atan(supportGrade(p, run.s, run.x, run.y, run.simUs));
    return;
  }
  if (run.mode === 'rail' && run.rail) {
    run.basePitch = Math.atan(railGrade(run.course.railsById.get(run.rail.railId)!));
    return;
  }
  let target = Math.atan(baseGrade(p, run.s));
  for (const r of p.rails) {
    if (run.s >= r.s0 && run.s <= r.s1 && Math.abs(run.x - r.x) <= RAIL_SNAP && run.y >= railTopAt(r, run.s) - 0.05) {
      target = Math.atan(railGrade(r));
    }
  }
  const k = 1 - Math.exp(-dtUs / ATTITUDE_TAU_US);
  run.basePitch += (target - run.basePitch) * k;
}

export function groundHeightUnder(run: SimState): number {
  const p = currentPath(run);
  return baseHeight(p, run.s);
}
