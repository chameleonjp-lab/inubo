import type { DogLook } from '../content/types';
import { clamp, length, quatAxisAngle, quatMul, quatRotate, type Vec3 } from './math';
import { add3, scale3 } from './free-math';
import { atBody } from './free-geometry';
import { advanceFreeMotion, createFreeMotion, predictFree, sampleFreeSpan,
  type FreeMotionState, type FreePose, type FreeSpan, type FreeTarget } from './free-motion';
import { pointAt, type SegmentMotion } from './motion';
import { baseHeight, gatePhase, sampleAt, solidTop, type Solid } from './track';
import type { SimState } from './types';

export const BOARD_PIVOT_Y = 0.75;
export const DOG_PIVOT_Y = 0.35;
export const DOG_SCALE = 1.35;
export const RIDER_SCALE = 0.72;
export const RIDER_HIP_Y = 0.62 * RIDER_SCALE;
export const riderFootHeight = (look: DogLook): number => (look.legLength + look.bodyHeight) * DOG_SCALE;

interface BodyPart { body: 'dog' | 'rider'; point: Vec3; radius: number }
export interface CourseFlight {
  heading: number;
  takeoffUs: number;
  controlled: boolean;
  motion: FreeMotionState;
  parts: BodyPart[];
}

export interface CourseAirHit {
  atUs: number;
  obstacle: Solid;
}

function makeParts(look: DogLook): BodyPart[] {
  const bodyY = look.legLength + look.bodyHeight / 2 - DOG_PIVOT_Y;
  const dogPart = (x: number, y: number, z: number, radius: number): BodyPart =>
    ({ body: 'dog', point: scale3([x, y, z], DOG_SCALE), radius: radius * DOG_SCALE });
  const riderPart = (x: number, y: number, z: number, radius: number): BodyPart =>
    ({ body: 'rider', point: scale3([x, y - 0.62, z], RIDER_SCALE), radius: radius * RIDER_SCALE });
  const paws = [-1, 1].flatMap(side => [-0.12, 0.12].map(z =>
    dogPart(side * look.bodyLength * 0.36, -DOG_PIVOT_Y + 0.045, z, 0.045)));
  const legParts = paws.map(paw => dogPart(paw.point[0] / DOG_SCALE,
    -DOG_PIVOT_Y + 0.5 * look.legLength, paw.point[2] / DOG_SCALE, 0.05));
  const torso = [-1, 0, 1].map(side => dogPart(side * (look.bodyLength - look.bodyHeight) / 2, bodyY, 0, look.bodyHeight / 2));
  const headX = look.bodyLength / 2 + 0.08;
  const headY = bodyY + look.bodyHeight * 0.45;
  return [
    ...paws, ...legParts, ...torso,
    dogPart(headX, headY, 0, 0.17), dogPart(headX + 0.2, headY - 0.04, 0, 0.08),
    dogPart(-look.bodyLength / 2, bodyY + 0.12, 0, 0.12),
    riderPart(0, 1.28, 0, 0.15), riderPart(0, 0.88, 0, 0.23),
    ...[-0.23, 0.23].map(z => riderPart(0, 0.57, z, 0.08)),
    ...[-0.12, 0.12].flatMap(z => [riderPart(0, 0.31, z, 0.06), riderPart(0.04, 0.02, z, 0.055)]),
  ];
}

/** 位置は移動基準点からの世界向きの差分。コース上の移動と重力は従来どおり一度だけ計算する。 */
export function launchCourseFlight(look: DogLook, heading: number, pitch: number, atUs: number): CourseFlight {
  const pivot: Vec3 = [0, BOARD_PIVOT_Y, 0];
  const dogY = DOG_PIVOT_Y * DOG_SCALE;
  const riderY = riderFootHeight(look) + RIDER_HIP_Y;
  const q = quatMul(quatAxisAngle([0, 1, 0], -heading), quatAxisAngle([0, 0, 1], pitch));
  const bodyAt = (y: number) => ({ p: add3(pivot, quatRotate(q, [0, y - pivot[1], 0])), q });
  const pose = { pivot, dog: bodyAt(dogY), rider: bodyAt(riderY) };
  return { heading, takeoffUs: atUs, controlled: false, motion: createFreeMotion({ pose, timeUs: atUs }), parts: makeParts(look) };
}

export function applyCourseRotation(flight: CourseFlight, atUs: number, seq: number, target: FreeTarget, screen: Vec3): void {
  // 入力の軸は踏切時の道の向きで固定する。カメラの揺れや次のカーブでは変わらない。
  const c = Math.cos(flight.heading), s = Math.sin(flight.heading);
  const rotation: Vec3 = [-s * screen[0] - c * screen[2], screen[1], c * screen[0] - s * screen[2]];
  flight.controlled = true;
  advanceFreeMotion(flight.motion, atUs, [{ atUs, seq, target, rotation }], undefined, true);
}

export function courseFlightPose(flight: CourseFlight, atUs: number): FreePose {
  const motion = flight.motion;
  return atUs > motion.timeUs && !motion.halted
    ? predictFree(motion, [0, 0, 0], clamp(atUs - motion.timeUs, 0, 5_000)).pose : motion.pose;
}

interface SurfaceSample { distance: number; obstacle: Solid }

/** 回っている身体と壁などの衝突時刻を調べる。床や手すりへの着地は走行側で扱う。 */
function firstCourseImpact(run: SimState, m: SegmentMotion, flight: CourseFlight, span: FreeSpan): CourseAirHit | null {
  const p = m.path;
  const start = pointAt(m, span.startUs - m.t0, run);
  const end = pointAt(m, span.endUs - m.t0, run);
  const candidates = p.solids.filter(so => !so.standable && so.kind !== 'rail' && so.s0 <= end.s + 2 && so.s1 >= start.s - 2 &&
    so.x0 <= Math.max(start.x, end.x) + 2 && so.x1 >= Math.min(start.x, end.x) - 2 && !run.ghostGates.includes(so.id));
  if (!candidates.length) return null;
  const sample = (atUs: number): SurfaceSample => {
    const pt = pointAt(m, atUs - m.t0, run);
    const { heading, kappa } = sampleAt(p, pt.s);
    const c = Math.cos(heading), s = Math.sin(heading);
    const pose = sampleFreeSpan(span, atUs).pose;
    let best: SurfaceSample = { distance: Infinity, obstacle: candidates[0] };
    for (const part of flight.parts) {
      const offset = atBody(pose[part.body], part.point);
      const along = pt.s + (c * offset[0] + s * offset[2]) / Math.max(0.3, 1 - kappa * pt.x);
      const across = pt.x - s * offset[0] + c * offset[2];
      const y = pt.y + offset[1];
      for (const so of candidates) {
        if (so.kind === 'gate' && gatePhase(so.gate!, atUs).raise <= 1e-6) continue;
        const top = solidTop(p, so, along, atUs);
        const bottom = baseHeight(p, clamp(along, so.s0, so.s1));
        const dy = Math.max(0, y - top, bottom - y);
        const distance = Math.hypot(Math.max(0, so.s0 - along, along - so.s1),
          Math.max(0, so.x0 - across, across - so.x1), dy) - part.radius;
        if (distance < best.distance) best = { distance, obstacle: so };
      }
    }
    return best;
  };
  const angular = span.from.omega;
  const speedBound = Math.abs(m.dsdt) * 4 + Math.abs(m.latV) * 3 + Math.max(Math.abs(start.vy), Math.abs(end.vy)) +
    8 + 6 * (length(angular.common) + Math.max(length(angular.rider), length(angular.dog)));
  const search = (a: number, b: number, left: SurfaceSample, right: SurfaceSample): CourseAirHit | null => {
    if (left.distance <= 1e-7) return { ...left, atUs: a };
    if (Math.min(left.distance, right.distance) > speedBound * (b - a) / 2e6 + 1e-7) return null;
    if (b - a <= 1) return right.distance <= 1e-7 ? { ...right, atUs: b } : null;
    const mid = Math.floor((a + b) / 2), center = sample(mid);
    return search(a, mid, left, center) ?? search(mid, b, center, right);
  };
  return search(span.startUs, span.endUs, sample(span.startUs), sample(span.endUs));
}

export function advanceCourseFlight(run: SimState, m: SegmentMotion, untilUs: number): CourseAirHit | null {
  const flight = run.freeFlight;
  if (!flight) return null;
  if (!flight.controlled) {
    flight.motion.timeUs = untilUs;
    return null;
  }
  let hit: CourseAirHit | null = null;
  advanceFreeMotion(flight.motion, untilUs, [], span => {
    hit = firstCourseImpact(run, m, flight, span);
    return hit?.atUs ?? null;
  }, true);
  return hit;
}
