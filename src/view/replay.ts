import { quatAxisAngle, quatMul, type Quat, type Vec3 } from '../game/math';
import { courseFlightPose } from '../game/free-flight';
import { isFreestyleVersion, type FreeBody, type FreeTarget } from '../game/free-motion';
import { FxRunReader } from './trick-fx-sim';
import type { FxVisualEvent } from './trick-fx-timeline';
import { bodyQuat, dogQuat } from '../game/tricks';
import { sampleAt, worldXZ } from '../game/track';
import type { CourseId, DogId } from '../content/types';
import type { SimState } from '../game/types';

// 共通と個別の最高速度が重なっても、隣り合う姿勢の回転を180度未満に保つ。
export const FREE_REPLAY_STEP_MS = 20;

/**
 * 最速の走りの再生データ。各時刻の位置と姿勢を、犬種と一緒に残す。
 * 再生は見るためだけに使い、当たり判定・取得・採点には関与しない。
 */

export interface ReplayData {
  runId: string;
  dogId: DogId;
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  motionVersion?: 'freestyle-1';
  /** 記録の間隔（ms）。 */
  stepMs: number;
  /** 最初の12値は従来どおり。自由回転中だけ犬・人の相対位置(mm)と世界姿勢(×1000)を後ろに加える。 */
  frames: number[][];
  /**
   * 81種類の演出の出来事（段階・対象が変わった瞬間と着地だけ）。新しい走行だけが持つ。
   * 無い記録は演出なしで再生し、姿勢から演出を推測して作らない。
   */
  visualEvents?: FxVisualEvent[];
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  body: Quat;
  dog: Quat;
  free?: { dog: FreeBody; rider: FreeBody };
}

/** 計算の状態から、世界座標の姿勢を求める（描画と再生で共通）。 */
export function poseOf(run: SimState, s = run.s, x = run.x, y = run.y, tUs = run.simUs): Pose {
  const p = run.course.paths.get(run.pathId)!;
  const [wx, wz] = worldXZ(p, Math.max(0, Math.min(p.length, s)), x);
  const heading = sampleAt(p, Math.max(0, Math.min(p.length, s))).heading;
  const rotations = run.jump?.resolution.rotations ?? [];
  const base = quatAxisAngle([0, 0, 1], run.basePitch);
  const flight = run.freeFlight;
  return { x: wx, y, z: wz, heading, body: quatMul(base, bodyQuat(rotations, tUs)), dog: dogQuat(rotations, tUs),
    ...(flight ? { free: courseFlightPose(flight, tUs) } : {}) };
}

export class ReplayRecorder {
  private frames: number[][] = [];
  private nextUs = 0;
  private fx = new FxRunReader();
  private visual: FxVisualEvent[] = [];
  /** selected は画面で選んでいる回す対象（踏切直後の演出に使う。画面の描画と同じ値）。 */
  constructor(private stepMs = 100, private selected: () => FreeTarget = () => 'common') {}

  /** 計算を進めるたびに呼ぶ。stepMs ごとに1枚残す。 */
  sample(run: SimState): void {
    while (run.simUs >= this.nextUs) {
      const p = poseOf(run);
      const q = (v: number) => Math.round(v * 1000);
      const frame = [Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100), Math.round(p.heading * 1000), ...p.body.map(q), ...p.dog.map(q)];
      if (p.free) frame.push(...p.free.dog.p.map(q), ...p.free.dog.q.map(q), ...p.free.rider.p.map(q), ...p.free.rider.q.map(q));
      this.frames.push(frame);
      this.nextUs += this.stepMs * 1000;
    }
    // 画面と同じ決め方で演出の出来事を残す（走行の時計だけで決まるので、描画の速さに左右されない）。
    for (const { ev } of this.fx.read(run, this.selected())) this.visual.push(ev);
  }

  finish(run: SimState): ReplayData {
    return {
      runId: run.id.runId,
      dogId: run.id.dogId,
      courseId: run.id.courseId,
      courseVersion: run.id.courseVersion,
      rulesVersion: run.id.rulesVersion,
      ...(isFreestyleVersion(run.id.rulesVersion) ? { motionVersion: 'freestyle-1' as const } : {}),
      stepMs: this.stepMs,
      frames: this.frames.slice(),
      ...(this.visual.length ? { visualEvents: this.visual.slice().sort((a, b) => a.tUs - b.tUs) } : {}),
    };
  }
}

function nlerpQuat(a: number[], b: number[], t: number): Quat {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const q: Quat = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** 再生データの、走行時刻 tUs の姿勢（前後の記録を補間）。範囲外なら null。 */
export function replayPoseAt(rp: ReplayData, tUs: number): Pose | null {
  const f = tUs / 1000 / rp.stepMs;
  const i = Math.floor(f);
  if (i < 0 || i >= rp.frames.length - 1) return null;
  const a = rp.frames[i];
  const b = rp.frames[i + 1];
  const t = f - i;
  const L = (k: number) => a[k] + (b[k] - a[k]) * t;
  let dh = b[3] - a[3];
  while (dh > 3142) dh -= 6283;
  while (dh < -3142) dh += 6283;
  const qa = (k: number) => [a[k] / 1000, a[k + 1] / 1000, a[k + 2] / 1000, a[k + 3] / 1000];
  const qb = (k: number) => [b[k] / 1000, b[k + 1] / 1000, b[k + 2] / 1000, b[k + 3] / 1000];
  const fa = a.length === 26, fb = b.length === 26;
  const nearest = t < 0.5 ? a : b;
  const freeBody = (k: number): FreeBody => {
    const read = fa && fb ? L : (entry: number) => nearest[entry];
    const p: Vec3 = [read(k) / 1000, read(k + 1) / 1000, read(k + 2) / 1000];
    const q = fa && fb ? nlerpQuat(qa(k + 3), qb(k + 3), t) :
      nlerpQuat(nearest.slice(k + 3, k + 7).map(v => v / 1000), [0, 0, 0, 1], 0);
    return { p, q };
  };
  return {
    x: L(0) / 100,
    y: L(1) / 100,
    z: L(2) / 100,
    heading: (a[3] + dh * t) / 1000,
    body: nlerpQuat(qa(4), qb(4), t),
    dog: nlerpQuat(qa(8), qb(8), t),
    ...(rp.motionVersion === 'freestyle-1' && nearest.length === 26 ? { free: { dog: freeBody(12), rider: freeBody(19) } } : {}),
  };
}
