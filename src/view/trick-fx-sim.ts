import { GRAVITY, JUMP_VY, KICKER_VY, RAIL_JUMP_VY } from '../game/rules';
import { FREE_DECAY, FREE_RULES_VERSION, isFreestyleVersion, rotationTime, type FreeMotionState, type FreeTarget } from '../game/free-motion';
import { add3 } from '../game/free-math';
import { length } from '../game/math';
import type { FxSpinSample } from './trick-fx-engine';
import { railGrade, sampleAt, supportGrade, worldXZ } from '../game/track';
import type { SimEvent, SimState } from '../game/types';
import { FxTimeline, predictedAirUs, type FxContact, type FxFlightView, type FxVisualEvent } from './trick-fx-timeline';

/** 走行の状態から、演出の時間割に渡す空中の情報を作る。空中でなければ null。 */
export function flightViewOf(run: SimState): FxFlightView | null {
  const flight = run.freeFlight, jump = run.jump;
  if (!flight || !jump) return null;
  // 予測滞空時間は踏切の種類だけで決まる（表示専用。着地位置や採点には使わない）。
  const vy = jump.kind === 'kicker' ? KICKER_VY : jump.kind === 'rail' ? RAIL_JUMP_VY : jump.kind === 'drop' ? 0 : JUMP_VY;
  return {
    jumpId: jump.jumpId,
    takeoffUs: flight.takeoffUs,
    predictedAirUs: predictedAirUs(vy, GRAVITY),
    heading: flight.heading,
    motionTimeUs: flight.motion.timeUs,
    history: flight.motion.history,
    inputs: flight.motion.seen.values(),
    directionCombos: run.id.rulesVersion === FREE_RULES_VERSION,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 着地の出来事（道・道のりmm・横位置・高さ）から、接地点の世界座標・進行方向・接地面の傾きを求める。
 * 描画の時点の身体の位置は使わない。手すりの上なら手すりの傾き、地面なら地面（踏切台を含む）の傾き。
 * 保存の大きさを抑えるため、mm・1/1000ラジアンに丸める。
 */
export function contactOfEvent(run: SimState, e: SimEvent): FxContact | null {
  const p = run.course.paths.get(e.pathId);
  if (!p || !Number.isFinite(e.sMm) || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return null;
  const s = Math.max(0, Math.min(p.length, e.sMm / 1000));
  const [x, z] = worldXZ(p, s, e.x);
  const railId = e.data?.onRail;
  const rail = typeof railId === 'string' ? run.course.railsById.get(railId) : undefined;
  const grade = rail ? railGrade(rail) : supportGrade(p, s, e.x, e.y, e.atUs);
  return { x: round3(x), y: round3(e.y), z: round3(z), yaw: round3(sampleAt(p, s).heading), grade: round3(grade) };
}

export interface FxRunEvent {
  ev: FxVisualEvent;
  /** 着地の出来事（接地の位置を読むため）。 */
  source?: SimEvent;
}

/**
 * 走行の出来事と空中の状態を読み、演出の出来事を作る。画面の描画と再生データの記録で同じものを使う。
 * 自由回転のルール以外の走行では何も出さない（旧ルールの着地は新しい演出の対象外）。
 */
export class FxRunReader {
  readonly timeline = new FxTimeline();
  private index = 0;
  private runId = '';

  reset(): void {
    this.timeline.reset();
    this.index = 0;
    this.runId = '';
  }

  read(run: SimState, selected: FreeTarget): FxRunEvent[] {
    if (!isFreestyleVersion(run.id.rulesVersion)) return [];
    if (run.id.runId !== this.runId || run.events.length < this.index) {
      this.timeline.reset();
      this.index = 0;
      this.runId = run.id.runId;
    }
    const out: FxRunEvent[] = [];
    // 先に確定した出来事（着地・衝突）を読み、そのあと空中の状態を読む。
    for (; this.index < run.events.length; this.index++) {
      const e = run.events[this.index];
      const d = e.data ?? {};
      const jumpId = typeof d.jumpId === 'number' ? d.jumpId : null;
      if (e.kind === 'land' && jumpId !== null) {
        for (const ev of this.timeline.land(e.atUs, jumpId, d)) {
          // 着地L には、その出来事の接地点を付ける（描画・記録・再生で同じ値を使う）。
          if (ev.kind === 'L') {
            const contact = contactOfEvent(run, e);
            if (contact) ev.contact = contact;
          }
          out.push({ ev, source: e });
        }
      } else if (e.kind === 'landFail' || e.kind === 'collide' || e.kind === 'fall') {
        for (const ev of this.timeline.end(e.atUs, jumpId)) out.push({ ev });
      }
    }
    for (const ev of this.timeline.observe(run.simUs, flightViewOf(run), selected)) out.push({ ev });
    return out;
  }
}

/**
 * ゲームが計算した実際の回転を、描画の時刻に合わせて読む（F03）。
 * 描画の前後の姿勢差（最短の回転）からは求めないので、1フレームで180度を超える速い回転や逆回転でも向きを取り違えない。
 * 累積角は履歴の区間ごとに積分し、同じジャンプの中では前回の続きから足す。
 */
export class FxSpinReader {
  private key = '';
  private index = 0;
  private lastUs = -1;
  private done = { dog: 0, rider: 0 };
  private out: FxSpinSample = { dog: { omega: { x: 0, y: 0, z: 0 }, accum: 0 }, rider: { omega: { x: 0, y: 0, z: 0 }, accum: 0 } };

  reset(): void {
    this.key = '';
  }

  read(motion: Pick<FreeMotionState, 'history' | 'timeUs' | 'omega'>, key: string, atUs: number): FxSpinSample {
    if (key !== this.key || atUs < this.lastUs) {
      this.key = key; this.index = 0; this.done.dog = 0; this.done.rider = 0;
    }
    this.lastUs = atUs;
    const history = motion.history;
    // 描画の時刻までに終わった区間を積分済みに足す。
    while (this.index < history.length && history[this.index].endUs <= atUs) {
      const span = history[this.index++];
      const integral = rotationTime(span.endUs - span.startUs);
      this.done.dog += length(add3(span.from.omega.common, span.from.omega.dog)) * integral;
      this.done.rider += length(add3(span.from.omega.common, span.from.omega.rider)) * integral;
    }
    const open = history[this.index];
    // 描画の時刻を含む区間（または最後の計算の後）の途中までを足し、その時刻の角速度を求める。
    let omega = motion.omega, dt = 0;
    if (open && open.startUs <= atUs) { omega = open.from.omega; dt = atUs - open.startUs; }
    else if (atUs > motion.timeUs) dt = Math.min(5_000, atUs - motion.timeUs);
    const decay = Math.exp(-FREE_DECAY * dt / 1e6), part = rotationTime(dt);
    for (const body of ['dog', 'rider'] as const) {
      const w = add3(omega.common, omega[body]);
      const o = this.out[body];
      o.omega.x = w[0] * decay; o.omega.y = w[1] * decay; o.omega.z = w[2] * decay;
      o.accum = this.done[body] + length(w) * part;
    }
    return this.out;
  }
}
