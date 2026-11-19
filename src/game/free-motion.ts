import { DEG, length, quatMul, type Quat, type Vec3 } from './math';
import { add3, normalQ, rotateBody, rotationQ, scale3 } from './free-math';

export const FREE_RULES_VERSION = 'rules-freestyle-1';
export const FREE_TICK_US = 5_000;
export const FREE_DECAY = Math.log(2) / 0.8;
const SWIPE_GAIN = 16;
const MAX_OMEGA = 2_880 * DEG;
export type FreeTarget = 'common' | 'dog' | 'rider';
export interface FreeBody { p: Vec3; q: Quat }
export interface FreePose { pivot: Vec3; dog: FreeBody; rider: FreeBody }
export type FreeOmega = Record<FreeTarget, Vec3>;
export interface FreeMotionInput { seq: number; atUs: number; target: FreeTarget; rotation: Vec3 }
export interface FreeSnapshot { pose: FreePose; omega: FreeOmega; velocity: Vec3 }
export interface FreeSpan {
  startUs: number; endUs: number; from: FreeSnapshot; to: FreeSnapshot; acceleration: Vec3;
}
export interface FreeMotionState extends FreeSnapshot {
  timeUs: number;
  acceleration: Vec3;
  halted: boolean;
  history: FreeSpan[];
  pending: FreeMotionInput[];
  seen: Map<number, FreeMotionInput>;
}
const copy3 = (v: Vec3): Vec3 => [...v];
const copyBody = (b: FreeBody): FreeBody => ({ p: copy3(b.p), q: [...b.q] });
export const copyFreePose = (p: FreePose): FreePose => ({ pivot: copy3(p.pivot), dog: copyBody(p.dog), rider: copyBody(p.rider) });
export function snapshotFree(s: FreeSnapshot): FreeSnapshot {
  return { pose: copyFreePose(s.pose), omega: { common: copy3(s.omega.common), dog: copy3(s.omega.dog), rider: copy3(s.omega.rider) }, velocity: copy3(s.velocity) };
}

export function createFreeMotion(opts: Partial<FreeSnapshot> & { timeUs?: number; acceleration?: Vec3 } = {}): FreeMotionState {
  const pose = opts.pose ?? {
    pivot: [0, 0.75, 0], dog: { p: [0, 0.5, 0], q: [0, 0, 0, 1] }, rider: { p: [0, 1.37, 0], q: [0, 0, 0, 1] },
  };
  const snap = snapshotFree({ pose, omega: opts.omega ?? { common: [0, 0, 0], dog: [0, 0, 0], rider: [0, 0, 0] }, velocity: opts.velocity ?? [0, 0, 0] });
  return { ...snap, timeUs: opts.timeUs ?? 0, acceleration: copy3(opts.acceleration ?? [0, 0, 0]), halted: false, history: [], pending: [], seen: new Map() };
}

/** 指令ではなく、減衰を含む実際の運動。姿勢の向きと位置を同じ支点で進める。 */
export function predictFree(from: FreeSnapshot, acceleration: Vec3, dtUs: number): FreeSnapshot {
  const dt = dtUs / 1e6;
  const decay = Math.exp(-FREE_DECAY * dt);
  const integral = -Math.expm1(-FREE_DECAY * dt) / FREE_DECAY;
  const deltaCommon = rotationQ(scale3(from.omega.common, integral));
  const pivot = add3(from.pose.pivot, add3(scale3(from.velocity, dt), scale3(acceleration, dt * dt / 2)));
  const shift = add3(scale3(from.velocity, dt), scale3(acceleration, dt * dt / 2));
  const dog = rotateBody(from.pose.dog, from.pose.pivot, deltaCommon);
  const rider = rotateBody(from.pose.rider, from.pose.pivot, deltaCommon);
  dog.p = add3(dog.p, shift); rider.p = add3(rider.p, shift);
  dog.q = normalQ(quatMul(rotationQ(scale3(add3(from.omega.common, from.omega.dog), integral)), from.pose.dog.q));
  rider.q = normalQ(quatMul(rotationQ(scale3(add3(from.omega.common, from.omega.rider), integral)), from.pose.rider.q));
  return {
    pose: { pivot, dog, rider },
    omega: { common: scale3(from.omega.common, decay), dog: scale3(from.omega.dog, decay), rider: scale3(from.omega.rider, decay) },
    velocity: add3(from.velocity, scale3(acceleration, dt)),
  };
}

export function sampleFreeSpan(span: FreeSpan, atUs: number): FreeSnapshot {
  if (atUs < span.startUs || atUs > span.endUs) throw new Error('Outside motion interval');
  return predictFree(span.from, span.acceleration, atUs - span.startUs);
}

function acceptInputs(s: FreeMotionState, inputs: readonly FreeMotionInput[]): void {
  for (const i of inputs) {
    const prev = s.seen.get(i.seq);
    if (prev) {
      if (JSON.stringify(prev) !== JSON.stringify(i)) throw new Error('Conflicting input id');
      continue;
    }
    if (!Number.isSafeInteger(i.seq) || i.seq < 1 || !Number.isSafeInteger(i.atUs) || i.atUs < s.timeUs ||
      !['common', 'dog', 'rider'].includes(i.target) || i.rotation.length !== 3 || !i.rotation.every(Number.isFinite)) throw new Error('Invalid motion input');
    const copy = { ...i, rotation: copy3(i.rotation) };
    s.seen.set(i.seq, copy); s.pending.push(copy);
  }
  s.pending.sort((a, b) => a.atUs - b.atUs || a.seq - b.seq);
}
function applyDue(s: FreeMotionState): void {
  while (s.pending.length && s.pending[0].atUs <= s.timeUs) {
    const i = s.pending.shift()!;
    const next = add3(s.omega[i.target], scale3(i.rotation, SWIPE_GAIN));
    s.omega[i.target] = length(next) > MAX_OMEGA ? scale3(next, MAX_OMEGA / length(next)) : next;
  }
}

/** 固定の刻みだけを進める。接触は同時刻の入力より先に履歴を閉じる。 */
export function advanceFreeMotion(s: FreeMotionState, untilUs: number, inputs: readonly FreeMotionInput[] = [], stopAt?: (span: FreeSpan) => number | null, exactBoundary = false): void {
  if (s.halted) return;
  if (!Number.isSafeInteger(untilUs) || untilUs < s.timeUs) throw new Error('Invalid motion clock');
  acceptInputs(s, inputs);
  applyDue(s);
  const target = exactBoundary ? untilUs : Math.floor(untilUs / FREE_TICK_US) * FREE_TICK_US;
  while (s.timeUs < target) {
    const tickEnd = Math.min(target, (Math.floor(s.timeUs / FREE_TICK_US) + 1) * FREE_TICK_US);
    while (s.timeUs < tickEnd) {
      const nextInputUs = s.pending[0]?.atUs ?? Infinity;
      const endUs = Math.min(tickEnd, nextInputUs);
      const from = snapshotFree(s);
      const span: FreeSpan = { startUs: s.timeUs, endUs, from, to: predictFree(from, s.acceleration, endUs - s.timeUs), acceleration: copy3(s.acceleration) };
      const stop = stopAt?.(span) ?? null;
      if (stop !== null && (!Number.isSafeInteger(stop) || stop < span.startUs || stop > endUs)) throw new Error('Invalid contact time');
      if (stop !== null) {
        span.endUs = stop; span.to = predictFree(from, s.acceleration, stop - s.timeUs);
      }
      Object.assign(s, snapshotFree(span.to));
      s.timeUs = span.endUs;
      if (span.endUs > span.startUs) s.history.push(span);
      if (stop !== null) { s.halted = true; return; }
      applyDue(s);
    }
  }
}
