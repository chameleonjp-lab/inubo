import { DEG, length, quatRotate, type Vec3 } from './math';
import { add3, scale3 } from './free-math';
import { atBody, dogFeet, feetOnPads, freeParts, type FreePart } from './free-geometry';
import { advanceFreeMotion, copyFreePose, createFreeMotion, FREE_TICK_US, sampleFreeSpan, type FreeMotionInput, type FreeMotionState, type FreeSpan } from './free-motion';
import { scoreFreeMotion, type FreeLanding, type FreeScore } from './free-score';

export type FreeScenario = 'flat' | 'wall' | 'rail';
export interface FreeBox { id: 'wall' | 'rail'; min: Vec3; max: Vec3; color: string }
export function freeBoxes(scenario: FreeScenario): FreeBox[] {
  return scenario === 'wall' ? [{ id: 'wall', min: [3, 0, -1.5], max: [3.1, 4, 1.5], color: '#d36f61' }] :
    scenario === 'rail' ? [{ id: 'rail', min: [1.6, 0.60, -0.10], max: [5.6, 0.75, 0.10], color: '#748d9e' }] : [];
}
interface Contact { atUs: number; part: FreePart; surface: 'floor' | 'wall' | 'rail' }
export interface FreeResult extends FreeScore { landing: FreeLanding; cutoffUs: number; surface: Contact['surface']; reason: string }

function boxDistance(p: Vec3, box: FreeBox): number {
  const d = p.map((v, i) => Math.max(box.min[i] - v, 0, v - box.max[i]));
  return Math.hypot(...d);
}
function clearance(parts: FreePart[], boxes: FreeBox[], includeFloor: boolean): { distance: number; part: FreePart; surface: Contact['surface'] } {
  let best = { distance: Infinity, part: parts[0], surface: 'floor' as Contact['surface'] };
  for (const part of parts) {
    const floor = part.p[1] - part.radius;
    if (includeFloor && floor < best.distance) best = { distance: floor, part, surface: 'floor' };
    for (const box of boxes) {
      const distance = boxDistance(part.p, box) - part.radius;
      if (distance < best.distance) best = { distance, part, surface: box.id };
    }
  }
  return best;
}
/** 移動範囲で接触しない区間を除き、残りを前半から調べる。 */
export function firstFreeContact(span: FreeSpan, boxes: FreeBox[], includeFloor = true): Contact | null {
  const w = span.from.omega;
  const speedBound = length(span.from.velocity) + length(span.acceleration) * (span.endUs - span.startUs) / 1e6 +
    4 * (length(w.common) + Math.max(length(w.dog), length(w.rider))) + 1;
  const sample = (t: number) => clearance(freeParts(sampleFreeSpan(span, t).pose), boxes, includeFloor);
  const search = (a: number, b: number, ca: ReturnType<typeof sample>, cb: ReturnType<typeof sample>, depth: number): Contact | null => {
    if (ca.distance <= 1e-7) return { atUs: Math.ceil(a), part: ca.part, surface: ca.surface };
    // どの時点も近い方の端点から区間の半分以内。両端が離れていても途中を省かない。
    if (Math.min(ca.distance, cb.distance) > speedBound * (b - a) / 2e6 + 1e-7) return null;
    if (depth >= 32) {
      // 5ms / 2^32 < 0.000002us。保守上限の残差は数値許容差へ含める。
      // 閾値の直前に残る丸め誤差で合法な回転の処理を停止させない。
      const near = ca.distance <= cb.distance ? ca : cb;
      return { atUs: Math.ceil(b), part: near.part, surface: near.surface };
    }
    const mid = (a + b) / 2, cm = sample(mid);
    return search(a, mid, ca, cm, depth + 1) ?? search(mid, b, cm, cb, depth + 1);
  };
  return search(span.startUs, span.endUs, sample(span.startUs), sample(span.endUs), 0);
}

/** 記録・通信を持たない、自由操作を試す1回の跳躍。 */
export class FreeArena {
  motion: FreeMotionState = createFreeMotion();
  phase: 'ready' | 'air' | 'settling' | 'done' = 'ready';
  cutoffUs: number | null = null;
  airHistory: FreeSpan[] = [];
  result: FreeResult | null = null;
  previousResult: FreeResult | null = null;
  private contact: Contact | null = null;
  private contactX = 0;
  constructor(readonly scenario: FreeScenario = 'flat') {}
  jump(high = false): void {
    if (this.phase === 'air') return;
    if (this.phase === 'settling') { this.finish('crash', '安定を確認する前に再ジャンプ'); this.previousResult = this.result; }
    const start = this.phase === 'settling' || this.phase === 'done' ? this.motion.timeUs : 0;
    const pose = copyFreePose(this.motion.pose);
    const feet = dogFeet.map(p => atBody(pose.dog, p));
    // 支持点を移しても身体を移動させず、空中の共通支点へ切り替える。
    pose.pivot = add3(scale3(feet.reduce((sum, p) => add3(sum, p), [0, 0, 0] as Vec3), 1 / feet.length), [0, 0.70, 0]);
    const floor = Math.min(...freeParts(pose).map(p => p.p[1] - p.radius));
    const lift: Vec3 = [0, 0.0001 - floor, 0];
    pose.pivot = add3(pose.pivot, lift); pose.dog.p = add3(pose.dog.p, lift); pose.rider.p = add3(pose.rider.p, lift);
    this.motion = createFreeMotion({ pose, omega: this.motion.omega, timeUs: start, velocity: [2, high ? 9 : 5.6, 0], acceleration: [0, -9.8, 0] });
    this.phase = 'air'; this.cutoffUs = null; this.result = null; this.airHistory = []; this.contact = null;
  }
  advance(untilUs: number, inputs: readonly FreeMotionInput[] = []): void {
    if (this.phase === 'ready' || this.phase === 'done') return;
    if (this.phase === 'air') {
      advanceFreeMotion(this.motion, untilUs, inputs, span => {
        const hit = firstFreeContact(span, freeBoxes(this.scenario));
        if (hit) this.contact = hit;
        return hit?.atUs ?? null;
      });
      if (!this.motion.halted) return;
      this.cutoffUs = this.motion.timeUs; this.airHistory = this.motion.history;
      const hit = this.contact!;
      if (hit.surface !== 'floor' || !hit.part.load || !this.validAttitude()) { this.finish('crash', hit.surface === 'floor' ? '足から支えられず転倒' : '障害物に接触'); return; }
      // 空中履歴を切り離し、支持点へ支点を移す。向き・位置・回転速度は連続に保つ。
      const p = copyFreePose(this.motion.pose); p.pivot = [hit.part.p[0], 0, hit.part.p[2]];
      this.contactX = p.pivot[0];
      const pending = this.motion.pending.filter(i => i.atUs > this.cutoffUs!);
      this.motion = createFreeMotion({ pose: p, omega: this.motion.omega, timeUs: this.cutoffUs, velocity: [2, 0, 0] });
      advanceFreeMotion(this.motion, this.motion.timeUs, pending);
      this.phase = 'settling';
    }
    if (this.phase === 'settling') {
      // 接触後の入力は次の地上動作。既に閉じた空中履歴へ戻さない。
      const later = inputs.filter(i => i.atUs > this.cutoffUs!);
      advanceFreeMotion(this.motion, this.motion.timeUs, later);
      const target = Math.floor(untilUs / FREE_TICK_US) * FREE_TICK_US;
      while (this.motion.timeUs < target && this.phase === 'settling') {
        const boundaries = [40_000, 150_000].map(dt => this.cutoffUs! + dt).filter(t => t > this.motion.timeUs);
        const end = Math.min(target, (Math.floor(this.motion.timeUs / FREE_TICK_US) + 1) * FREE_TICK_US, ...boundaries);
        const before = this.motion.timeUs;
        advanceFreeMotion(this.motion, end, [], span => firstFreeContact(span, freeBoxes(this.scenario), false)?.atUs ?? null, true);
        if (this.motion.halted) { this.finish('crash', '着地の確認中に障害物へ接触'); break; }
        // 法線方向の押し返しと接地摩擦。姿勢を正解角へ補正しない。
        const ground = Math.min(...freeParts(this.motion.pose).map(p => p.p[1] - p.radius));
        const shift: Vec3 = [0, -ground, 0];
        this.motion.pose.pivot = add3(this.motion.pose.pivot, shift);
        this.motion.pose.dog.p = add3(this.motion.pose.dog.p, shift); this.motion.pose.rider.p = add3(this.motion.pose.rider.p, shift);
        const friction = Math.exp(-Math.log(2) * (this.motion.timeUs - before) / 120_000);
        for (const key of ['common', 'dog', 'rider'] as const) this.motion.omega[key] = scale3(this.motion.omega[key], friction);
        const elapsed = this.motion.timeUs - this.cutoffUs!;
        const supporting = dogFeet.filter(p => atBody(this.motion.pose.dog, p)[1] - 0.05 <= 0.04).length;
        if (!this.validAttitude() || (elapsed >= 40_000 && supporting < 2)) this.finish('crash', '着地後に支持を失った');
        else if (elapsed >= 150_000 && this.motion.pose.pivot[0] - this.contactX >= 0.2) {
          const up = quatRotate(this.motion.pose.dog.q, [0, 1, 0]);
          this.finish(up[1] >= Math.cos(10 * DEG) ? 'clean' : 'normal', '着地が安定した');
        }
      }
    }
  }
  private validAttitude(): boolean {
    return quatRotate(this.motion.pose.dog.q, [0, 1, 0])[1] >= Math.cos(30 * DEG) &&
      quatRotate(this.motion.pose.rider.q, [0, 1, 0])[1] >= Math.cos(30 * DEG) && feetOnPads(this.motion.pose);
  }
  private finish(landing: FreeLanding, reason: string): void {
    this.result = { ...scoreFreeMotion(this.airHistory, landing), landing, cutoffUs: this.cutoffUs ?? this.motion.timeUs, surface: this.contact?.surface ?? 'floor', reason };
    this.phase = 'done';
  }
}
