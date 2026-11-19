import type { DogLook } from '../content/types';
import { DEG, clamp, dot, length, quatAxisAngle, quatMul, quatRotate, type Vec3 } from './math';
import { add3, scale3, sub3 } from './free-math';
import { atBody } from './free-geometry';
import { advanceFreeMotion, copyFreePose, createFreeMotion, predictFree, sampleFreeSpan,
  type FreeMotionState, type FreePose, type FreeSpan, type FreeTarget } from './free-motion';
import { scoreFreeMotion } from './free-score';
import { offRoad, pointAt, type SegmentMotion } from './motion';
import { LANDING_OK_DEG, LANDING_PERFECT_DEG, RAIL_SNAP } from './rules';
import { baseGrade, baseHeight, gatePhase, railGrade, sampleAt, solidTop, supportGrade, type RailRt, type SectionRt, type Solid } from './track';
import type { LandingContact } from './scoring';
import type { JumpScore } from './tricks';
import type { JumpRec, SimState } from './types';

export const BOARD_PIVOT_Y = 0.75;
export const DOG_PIVOT_Y = 0.35;
export const DOG_SCALE = 1.35;
export const RIDER_SCALE = 0.72;
export const RIDER_HIP_Y = 0.62 * RIDER_SCALE;
export const riderFootHeight = (look: DogLook): number => (look.legLength + look.bodyHeight) * DOG_SCALE;

interface BodyPart { body: 'dog' | 'rider'; point: Vec3; radius: number; paw?: boolean }
export interface CourseFlight {
  heading: number;
  takeoffUs: number;
  controlled: boolean;
  motion: FreeMotionState;
  parts: BodyPart[];
  pads: Vec3[];
  shoes: Vec3[];
}

export interface CourseLanding {
  flight: CourseFlight;
  jump: JumpRec;
  contact: LandingContact;
  score: JumpScore;
  opp: string | null;
  travel: number;
  exits: { section: SectionRt; atUs: number }[];
}

export interface CourseAirHit {
  atUs: number;
  supportY: number;
  heading: number;
  pitch: number;
  rail?: RailRt;
  obstacle?: Solid;
  supportsPaw: boolean;
}

function makeParts(look: DogLook): BodyPart[] {
  const bodyY = look.legLength + look.bodyHeight / 2 - DOG_PIVOT_Y;
  const dogPart = (x: number, y: number, z: number, radius: number, paw = false): BodyPart =>
    ({ body: 'dog', point: scale3([x, y, z], DOG_SCALE), radius: radius * DOG_SCALE, paw });
  const riderPart = (x: number, y: number, z: number, radius: number): BodyPart =>
    ({ body: 'rider', point: scale3([x, y - 0.62, z], RIDER_SCALE), radius: radius * RIDER_SCALE });
  const paws = [-1, 1].flatMap(side => [-0.12, 0.12].map(z =>
    dogPart(side * look.bodyLength * 0.36, -DOG_PIVOT_Y + 0.045, z, 0.045, true)));
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
export function launchCourseFlight(look: DogLook, heading: number, pitch: number, atUs: number, prior?: FreeMotionState): CourseFlight {
  const pivot: Vec3 = [0, BOARD_PIVOT_Y, 0];
  const dogY = DOG_PIVOT_Y * DOG_SCALE;
  const riderY = riderFootHeight(look) + RIDER_HIP_Y;
  const q = quatMul(quatAxisAngle([0, 1, 0], -heading), quatAxisAngle([0, 0, 1], pitch));
  const bodyAt = (y: number) => ({ p: add3(pivot, quatRotate(q, [0, y - pivot[1], 0])), q });
  const pose = prior ? { ...copyFreePose(prior.pose), pivot } : { pivot, dog: bodyAt(dogY), rider: bodyAt(riderY) };
  const shoes = [-0.12, 0.12].map(z => scale3([0.04, 0.02 - 0.62, z], RIDER_SCALE));
  const pads = shoes.map(p => add3(p, [0, riderY - dogY, 0]));
  return { heading, takeoffUs: atUs, controlled: !!prior, motion: createFreeMotion({ pose, timeUs: atUs, omega: prior?.omega }), parts: makeParts(look), pads, shoes };
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

interface SurfaceSample extends Omit<CourseAirHit, 'atUs'> { distance: number }

/** 回っている身体の最初の接触を調べ、次の入力や描画フレームまで待たずに空中履歴を閉じる。 */
function firstCourseImpact(run: SimState, m: SegmentMotion, flight: CourseFlight, span: FreeSpan): CourseAirHit | null {
  const p = m.path;
  const start = pointAt(m, span.startUs - m.t0, run);
  const end = pointAt(m, span.endUs - m.t0, run);
  const candidates = p.solids.filter(so => so.s0 <= end.s + 2 && so.s1 >= start.s - 2 &&
    so.x0 <= Math.max(start.x, end.x) + 2 && so.x1 >= Math.min(start.x, end.x) - 2 && !run.ghostGates.includes(so.id));
  const floorActive = m.vy0 <= 0 || span.startUs >= flight.takeoffUs + 35_000;
  const sample = (atUs: number): SurfaceSample => {
    const pt = pointAt(m, atUs - m.t0, run);
    const { heading, kappa } = sampleAt(p, pt.s);
    const c = Math.cos(heading), s = Math.sin(heading);
    const pose = sampleFreeSpan(span, atUs).pose;
    let best: SurfaceSample = { distance: Infinity, supportY: 0, heading, pitch: 0, supportsPaw: false };
    for (const part of flight.parts) {
      const offset = atBody(pose[part.body], part.point);
      const along = pt.s + (c * offset[0] + s * offset[2]) / Math.max(0.3, 1 - kappa * pt.x);
      const across = pt.x - s * offset[0] + c * offset[2];
      const y = pt.y + offset[1];
      if (floorActive && !offRoad(p, along, across)) {
        const supportY = baseHeight(p, along);
        const pitch = Math.atan(baseGrade(p, along));
        const distance = (y - supportY) * Math.cos(pitch) - part.radius;
        if (distance < best.distance) best = { distance, supportY, heading, pitch, supportsPaw: !!part.paw };
      }
      for (const so of candidates) {
        if (so.kind === 'gate' && gatePhase(so.gate!, atUs).raise <= 1e-6) continue;
        const top = solidTop(p, so, along, atUs);
        const bottom = so.kind === 'rail' ? top - 0.14 : baseHeight(p, clamp(along, so.s0, so.s1));
        const pitch = so.kind === 'rail' ? Math.atan(railGrade(so.rail!)) :
          so.kind === 'kicker' ? Math.atan(supportGrade(p, along, across, top, atUs)) : 0;
        const dy = y > top ? (y - top) * Math.cos(pitch) : Math.max(0, bottom - y);
        const distance = Math.hypot(Math.max(0, so.s0 - along, along - so.s1),
          Math.max(0, so.x0 - across, across - so.x1), dy) - part.radius;
        if (distance >= best.distance) continue;
        const rail = so.rail;
        const fromAbove = !!part.paw && pt.vy <= 0 && y >= top && (so.standable ||
          (!!rail && pt.s >= rail.s0 - 0.45 && pt.s <= rail.s1 && Math.abs(pt.x - rail.x) <= RAIL_SNAP));
        // 踏切時に足が台を離れる途中の接触は許す。その後に台の側面や下に触れたら終了。
        if (!floorActive && so.kind === 'kicker') continue;
        best = { distance, supportY: top, heading, pitch, supportsPaw: fromAbove,
          ...(fromAbove ? { rail } : { obstacle: so }) };
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

function supportNormal(heading: number, pitch: number): Vec3 {
  return [-Math.cos(heading) * Math.sin(pitch), Math.cos(pitch), -Math.sin(heading) * Math.sin(pitch)];
}

function tiltDeg(flight: CourseFlight, normal: Vec3): number {
  const { dog, rider } = flight.motion.pose;
  const up: Vec3 = [0, 1, 0];
  return Math.acos(clamp(Math.min(dot(quatRotate(dog.q, up), normal), dot(quatRotate(rider.q, up), normal)), -1, 1)) / DEG;
}

function feetTogether(flight: CourseFlight): boolean {
  const { dog, rider } = flight.motion.pose;
  const [a, b] = flight.shoes.map(p => atBody(rider, p));
  const [c, d] = flight.pads.map(p => atBody(dog, p));
  return (length(sub3(a, c)) <= 0.18 && length(sub3(b, d)) <= 0.18) ||
    (length(sub3(a, d)) <= 0.18 && length(sub3(b, c)) <= 0.18);
}

export function gradeCourseLanding(flight: CourseFlight, heading: number, pitch: number, supportsPaw: boolean): JumpScore {
  const tilt = tiltDeg(flight, supportNormal(heading, pitch));
  const safe = supportsPaw && tilt <= LANDING_OK_DEG && feetTogether(flight);
  const grade = !safe ? 'crash' : tilt <= LANDING_PERFECT_DEG ? 'clean' : 'normal';
  const { points, base } = scoreFreeMotion(flight.motion.history, grade);
  return { base, points, names: base > 0 ? ['フリースタイル'] : [], composite: false, residualDeg: 0,
    tiltDeg: tilt, tenths: !safe ? 0 : grade === 'clean' ? 12 : 10 };
}

export function supportCourseFlight(flight: CourseFlight, shift: Vec3, heading: number, pitch: number, atUs: number): void {
  const pose = copyFreePose(flight.motion.pose);
  pose.dog.p = add3(pose.dog.p, shift);
  pose.rider.p = add3(pose.rider.p, shift);
  const normal = supportNormal(heading, pitch);
  const height = Math.min(...flight.parts.filter(p => p.paw).map(p => dot(atBody(pose.dog, p.point), normal) - p.radius));
  pose.pivot = [0, 0, 0];
  pose.dog.p = add3(pose.dog.p, scale3(normal, -height));
  pose.rider.p = add3(pose.rider.p, scale3(normal, -height));
  flight.motion = createFreeMotion({ pose, timeUs: atUs, omega: flight.motion.omega });
}

/** 着地候補は支持の上で回転の勢いが弱まる。得点用の空中履歴には足さない。 */
export function stabilizeCourseLanding(landing: CourseLanding, heading: number, pitch: number, atUs: number, travel: number): 'pending' | 'safe' | 'failed' {
  const { flight } = landing;
  const delta = atUs - flight.motion.timeUs;
  if (delta > 0) {
    advanceFreeMotion(flight.motion, atUs, [], undefined, true);
    const friction = Math.exp(-Math.log(2) * delta / 120_000);
    for (const key of ['common', 'dog', 'rider'] as const) flight.motion.omega[key] = scale3(flight.motion.omega[key], friction);
    flight.motion.history.length = 0;
  }
  const normal = supportNormal(heading, pitch);
  const { dog } = flight.motion.pose;
  const paws = flight.parts.filter(p => p.paw).map(p => dot(atBody(dog, p.point), normal) - p.radius);
  const min = Math.min(...paws);
  const shift = scale3(normal, -min);
  flight.motion.pose.dog.p = add3(flight.motion.pose.dog.p, shift);
  flight.motion.pose.rider.p = add3(flight.motion.pose.rider.p, shift);
  landing.travel += travel;
  const elapsed = atUs - landing.contact.atUs;
  if (tiltDeg(flight, normal) > LANDING_OK_DEG || !feetTogether(flight) ||
    (elapsed >= 40_000 && !landing.contact.onRail && paws.filter(y => y - min <= 0.04).length < 2)) return 'failed';
  if (elapsed >= 150_000 && landing.travel >= 0.2) return 'safe';
  return 'pending';
}
