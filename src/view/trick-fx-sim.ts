import { GRAVITY, JUMP_VY, KICKER_VY, RAIL_JUMP_VY } from '../game/rules';
import { isFreestyleVersion, type FreeTarget } from '../game/free-motion';
import type { SimEvent, SimState } from '../game/types';
import { FxTimeline, predictedAirUs, type FxFlightView, type FxVisualEvent } from './trick-fx-timeline';

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
  };
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
        for (const ev of this.timeline.land(e.atUs, jumpId, d)) out.push({ ev, source: e });
      } else if (e.kind === 'landFail' || e.kind === 'collide' || e.kind === 'fall') {
        for (const ev of this.timeline.end(e.atUs, jumpId)) out.push({ ev });
      }
    }
    for (const ev of this.timeline.observe(run.simUs, flightViewOf(run), selected)) out.push({ ev });
    return out;
  }
}
