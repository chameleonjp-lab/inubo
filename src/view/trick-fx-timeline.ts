import { add3 } from '../game/free-math';
import { DEG, length } from '../game/math';
import { directionOf, scoreTargetSwitches } from '../game/free-score';
import { DIRECTION_NAMES } from '../game/free-trick-catalog';
import { FREE_MAX_DEG_PER_SEC, rotationTime, type FreeMotionInput, type FreeSpan, type FreeTarget } from '../game/free-motion';
import { chooseLandingFx, emphasisLevel, fxTargetOf, isFxTarget, trailLevel, visualDifficultyPoints } from './trick-fx';
import { fxId, type FxId, type FxTarget } from './trick-fx-81';

/**
 * 1回のジャンプの「どの演出を、いつから出すか」を決める。描画とは分け、走行の時計（simulation時刻）だけで決める。
 * - 空中の段階は踏切から90msごとの固定時刻でだけ見直す。描画の速さ（30/60/120fps）や間引きで結果が変わらない。
 * - 空中の途中点は、踏切で一度だけ決めた予測滞空時間を分母にした暫定値。途中の「理論上限なので満点」扱いは使わない。
 * - 同じジャンプの中で段階は下げない。着地Lは1ジャンプに1回だけ。
 * - 出力は段階や対象が変わった瞬間だけの小さな出来事の列で、そのまま再生データにも残せる。
 */

export const FX_AIR_TICK_US = 90_000;
const HALF_TURN = 180;
/**
 * 空中の表示専用の難度（F01対応）。公式の得点・閾値には使わない。
 * - 物理上限（1身体あたり3600度/秒）の90%で回し続けていれば「全力」とみなす。
 * - 予測滞空時間の80%を過ぎるまでは、どれほど速く回しても最高段階（難度1650）に届かせない。
 */
export const FX_AIR_EFFORT_RATE = 0.9;
export const FX_AIR_MATURE_SHARE = 0.8;
const FX_AIR_EARLY_CAP = 1649;
const MIN_AIR_US = 450_000;
const MAX_AIR_US = 1_800_000;

/** F=派手さ、A=軌跡、L=着地、C=連携が実際に成立した瞬間、X=着地演出なしでジャンプが終わった。 */
export type FxEventKind = 'F' | 'A' | 'L' | 'C' | 'X';
export interface FxVisualEvent {
  tUs: number;
  jumpId: number;
  kind: FxEventKind;
  target: FxTarget | null;
  level: number;
  id: FxId | null;
  /**
   * 着地L だけが持つ接地点（世界座標の m、yaw はラジアン、grade は接地面の傾き）。
   * 再生では、この位置で着地の演出を描く（そのときのゴーストの位置は使わない）。
   */
  contact?: FxContact;
}

export interface FxContact { x: number; y: number; z: number; yaw: number; grade?: number }

export interface FxFlightView {
  jumpId: number;
  takeoffUs: number;
  /** 踏切時に一度だけ決めた、表示用の予測滞空時間。 */
  predictedAirUs: number;
  heading: number;
  /** 回転の記録がそろっている時刻。 */
  motionTimeUs: number;
  history: readonly FreeSpan[];
  inputs: Iterable<FreeMotionInput>;
}

/** 上向きの初速と重力から、表示だけに使う予測滞空時間を求める（0.45〜1.8秒）。 */
export function predictedAirUs(upwardSpeed: number, gravity: number): number {
  const seconds = gravity > 0 && Number.isFinite(upwardSpeed) ? 2 * Math.max(0, upwardSpeed) / gravity : 0;
  return Math.round(Math.min(MAX_AIR_US, Math.max(MIN_AIR_US, seconds * 1e6)));
}

export interface LandingInfo {
  fxTarget?: unknown;
  trickBase?: unknown;
  trickPoints?: unknown;
}

interface JumpState {
  jumpId: number;
  takeoffUs: number;
  predictedAirUs: number;
  target: FxTarget;
  fLevel: number;
  aLevel: number;
  rotating: boolean;
  combo: number;
  nextTick: number;
  inputCount: number;
  accepted: FreeMotionInput[];
  spanIndex: number;
  dog: number[];
  rider: number[];
  ended: boolean;
}

const nonZero = (input: FreeMotionInput) => length(input.rotation) > 1e-7;

export class FxTimeline {
  private jump: JumpState | null = null;
  private landed = new Set<number>();

  reset(): void {
    this.jump = null;
    this.landed.clear();
  }

  /** 空中の状態を読む。flight が null なら、空中ではない。 */
  observe(nowUs: number, flight: FxFlightView | null, selected: FreeTarget): FxVisualEvent[] {
    const out: FxVisualEvent[] = [];
    if (!flight) {
      if (this.jump && !this.jump.ended) this.finish(nowUs, out);
      return out;
    }
    if (!this.jump || this.jump.jumpId !== flight.jumpId) {
      if (this.jump && !this.jump.ended) this.finish(flight.takeoffUs, out);
      const target = fxTargetOf(selected) ?? 'B';
      this.jump = {
        jumpId: flight.jumpId, takeoffUs: flight.takeoffUs, predictedAirUs: Math.max(MIN_AIR_US, flight.predictedAirUs), target,
        fLevel: 1, aLevel: 0, rotating: false, combo: 0, nextTick: 1, inputCount: 0, accepted: [], spanIndex: 0,
        dog: Array<number>(DIRECTION_NAMES.length).fill(0), rider: Array<number>(DIRECTION_NAMES.length).fill(0), ended: false,
      };
      // 踏切の直後は、選んでいる対象のF01だけを小さく出す。
      out.push(this.event(flight.takeoffUs, 'F', target, 1));
    }
    const j = this.jump;
    if (j.ended) return out;
    // 新しく受理された回転入力（入力の記録は追加順に並ぶ）。
    let index = 0;
    const fresh: FreeMotionInput[] = [];
    for (const input of flight.inputs) {
      if (index++ < j.inputCount) continue;
      fresh.push(input);
    }
    j.inputCount = index;
    fresh.sort((a, b) => a.atUs - b.atUs || a.seq - b.seq);
    const limit = Math.min(nowUs, flight.motionTimeUs);
    let next = 0;
    for (;;) {
      const tickUs = j.takeoffUs + j.nextTick * FX_AIR_TICK_US;
      const input = fresh[next];
      if (input && input.atUs <= tickUs) {
        next++;
        this.acceptInput(j, input, out);
        continue;
      }
      if (tickUs > limit) break;
      j.nextTick++;
      this.tick(j, flight, tickUs, out);
    }
    while (next < fresh.length) this.acceptInput(j, fresh[next++], out);
    return out;
  }

  /** 着地の出来事。同じジャンプには一度だけ。技が成立していなければ普通の着地（X）。 */
  land(atUs: number, jumpId: number, info: LandingInfo): FxVisualEvent[] {
    if (this.landed.has(jumpId)) return [];
    this.landed.add(jumpId);
    if (this.jump && this.jump.jumpId === jumpId) this.jump.ended = true;
    const target = isFxTarget(info.fxTarget) ? info.fxTarget : null;
    const chosen = chooseLandingFx(target, Number(info.trickBase ?? 0), Number(info.trickPoints ?? 0));
    if (!chosen) return [{ tUs: atUs, jumpId, kind: 'X', target: null, level: 0, id: null }];
    return [{ tUs: atUs, jumpId, kind: 'L', target: chosen.target, level: chosen.landing.level, id: chosen.landing.id }];
  }

  /** 衝突・着地失敗・落下などで、成功演出なしにジャンプが終わった。 */
  end(atUs: number, jumpId: number | null): FxVisualEvent[] {
    const j = this.jump;
    if (!j || j.ended || (jumpId !== null && jumpId !== j.jumpId)) return [];
    const out: FxVisualEvent[] = [];
    this.finish(atUs, out);
    return out;
  }

  private finish(atUs: number, out: FxVisualEvent[]): void {
    const j = this.jump!;
    j.ended = true;
    out.push({ tUs: atUs, jumpId: j.jumpId, kind: 'X', target: null, level: 0, id: null });
  }

  private event(tUs: number, kind: 'F' | 'A', target: FxTarget, level: number): FxVisualEvent {
    return { tUs, jumpId: this.jump!.jumpId, kind, target, level, id: fxId(target, kind, level) };
  }

  private acceptInput(j: JumpState, input: FreeMotionInput, out: FxVisualEvent[]): void {
    j.accepted.push(input);
    if (!nonZero(input)) return;
    const target = fxTargetOf(input.target) ?? j.target;
    const changed = target !== j.target;
    j.target = target;
    // 対象を切り替えたら、次に受理した回転から新しい対象の演出に移る。
    if (changed) out.push(this.event(input.atUs, 'F', target, j.fLevel));
    if (!j.rotating || changed) {
      j.rotating = true;
      j.aLevel = Math.max(1, j.aLevel);
      out.push(this.event(input.atUs, 'A', target, j.aLevel));
    }
  }

  private tick(j: JumpState, flight: FxFlightView, tickUs: number, out: FxVisualEvent[]): void {
    const { base, bonus, count, mature } = this.provisional(j, flight, tickUs);
    const raw = visualDifficultyPoints(base, base + bonus);
    // 踏切から予測滞空時間の80%までは最高段階を出さない（序盤の誤った最高演出を防ぐ）。
    const difficulty = mature ? raw : Math.min(FX_AIR_EARLY_CAP, raw);
    const f = Math.max(1, emphasisLevel(difficulty));
    if (f > j.fLevel) {
      j.fLevel = f;
      out.push(this.event(tickUs, 'F', j.target, f));
    }
    const a = Math.max(1, trailLevel(difficulty));
    if (j.rotating && a > j.aLevel) {
      j.aLevel = a;
      out.push(this.event(tickUs, 'A', j.target, a));
    }
    // 連携の印は、実回転を伴う切替で連携数が本当に増えたときだけ。
    if (count > j.combo) {
      j.combo = count;
      out.push({ tUs: tickUs, jumpId: j.jumpId, kind: 'C', target: j.target, level: count, id: null });
    }
  }

  /**
   * tickUs までの実回転から、表示用の暫定の基礎点と連携点を求める。
   * 基礎点は「経過時間に対して、物理上限の90%で回し続けた量にどれだけ近いか（effort）」と
   * 「予測滞空時間のどこまで来たか（成熟度）」の積で決める。単独の犬・人でも、全力で回し続ければ1000に届く。
   */
  private provisional(j: JumpState, flight: FxFlightView, tickUs: number): { base: number; bonus: number; count: number; mature: boolean } {
    const history = flight.history;
    while (j.spanIndex < history.length && history[j.spanIndex].endUs <= tickUs) {
      this.accumulate(j.dog, j.rider, history[j.spanIndex], history[j.spanIndex].endUs - history[j.spanIndex].startUs, flight.heading);
      j.spanIndex++;
    }
    const dog = j.dog.slice(), rider = j.rider.slice();
    const open = history[j.spanIndex];
    if (open && open.startUs < tickUs) this.accumulate(dog, rider, open, tickUs - open.startUs, flight.heading);
    const qualifies = (amount: number) => amount >= HALF_TURN - 1e-7;
    const directions = dog.filter((amount, i) => qualifies(Math.max(amount, rider[i]))).length;
    const qualifiedTotal = (amounts: number[]) => amounts.filter(qualifies).reduce((sum, amount) => sum + amount, 0);
    const measured = Math.max(qualifiedTotal(dog), qualifiedTotal(rider));
    const end = j.spanIndex + (open && open.startUs < tickUs ? 1 : 0);
    const inputs = j.accepted.filter(input => input.atUs <= tickUs);
    const combo = scoreTargetSwitches(history.slice(0, end), inputs);
    const elapsedUs = Math.min(j.predictedAirUs, Math.max(0, tickUs - j.takeoffUs));
    const mature = elapsedUs >= j.predictedAirUs * FX_AIR_MATURE_SHARE;
    if (!directions || elapsedUs <= 0) return { base: 0, bonus: combo.bonus, count: combo.count, mature };
    const effort = Math.min(1, measured / (elapsedUs / 1e6 * FREE_MAX_DEG_PER_SEC * FX_AIR_EFFORT_RATE));
    const maturity = Math.min(1, elapsedUs / (j.predictedAirUs * FX_AIR_MATURE_SHARE));
    const base = Math.max(1, Math.floor(1000 * effort * maturity));
    return { base, bonus: combo.bonus, count: combo.count, mature };
  }

  private accumulate(dog: number[], rider: number[], span: FreeSpan, dtUs: number, heading: number): void {
    const integral = rotationTime(dtUs) / DEG;
    const dogOmega = add3(span.from.omega.common, span.from.omega.dog);
    const riderOmega = add3(span.from.omega.common, span.from.omega.rider);
    dog[directionOf(dogOmega, heading)] += length(dogOmega) * integral;
    rider[directionOf(riderOmega, heading)] += length(riderOmega) * integral;
  }
}
