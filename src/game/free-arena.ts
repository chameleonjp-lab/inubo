import { length, type Vec3 } from './math';
import { freeParts, type FreePart } from './free-geometry';
import { advanceFreeMotion, createFreeMotion, sampleFreeSpan, type FreeMotionInput, type FreeMotionState, type FreeSpan } from './free-motion';
import { scoreFreeMotion, type FreeScore } from './free-score';

export type FreeScenario = 'flat' | 'wall' | 'rail';
export interface FreeBox { id: 'wall' | 'rail'; min: Vec3; max: Vec3; color: string }
export function freeBoxes(scenario: FreeScenario): FreeBox[] {
  return scenario === 'wall' ? [{ id: 'wall', min: [3, 0, -1.5], max: [3.1, 4, 1.5], color: '#d36f61' }] :
    scenario === 'rail' ? [{ id: 'rail', min: [1.6, 0.60, -0.10], max: [5.6, 0.75, 0.10], color: '#748d9e' }] : [];
}
interface Contact { atUs: number; surface: FreeBox['id'] }
export interface FreeResult extends FreeScore { landing: 'landed' | 'blocked'; cutoffUs: number; surface: 'floor' | Contact['surface'] }

function boxDistance(p: Vec3, box: FreeBox): number {
  const d = p.map((v, i) => Math.max(box.min[i] - v, 0, v - box.max[i]));
  return Math.hypot(...d);
}
function clearance(parts: FreePart[], boxes: FreeBox[]): { distance: number; surface: Contact['surface'] } {
  let best = { distance: Infinity, surface: boxes[0].id };
  for (const part of parts) {
    for (const box of boxes) {
      const distance = boxDistance(part.p, box) - part.radius;
      if (distance < best.distance) best = { distance, surface: box.id };
    }
  }
  return best;
}
/** 移動範囲で接触しない区間を除き、残りを前半から調べる。 */
function firstFreeContact(span: FreeSpan, boxes: FreeBox[]): Contact | null {
  if (!boxes.length) return null;
  const w = span.from.omega;
  const speedBound = length(span.from.velocity) + length(span.acceleration) * (span.endUs - span.startUs) / 1e6 +
    4 * (length(w.common) + Math.max(length(w.dog), length(w.rider))) + 1;
  const sample = (t: number) => clearance(freeParts(sampleFreeSpan(span, t).pose), boxes);
  const search = (a: number, b: number, ca: ReturnType<typeof sample>, cb: ReturnType<typeof sample>, depth: number): Contact | null => {
    if (ca.distance <= 1e-7) return { atUs: Math.ceil(a), surface: ca.surface };
    // どの時点も近い方の端点から区間の半分以内。両端が離れていても途中を省かない。
    if (Math.min(ca.distance, cb.distance) > speedBound * (b - a) / 2e6 + 1e-7) return null;
    if (depth >= 32) {
      // 5ms / 2^32 < 0.000002us。保守上限の残差は数値許容差へ含める。
      // 閾値の直前に残る丸め誤差で合法な回転の処理を停止させない。
      const near = ca.distance <= cb.distance ? ca : cb;
      return { atUs: Math.ceil(b), surface: near.surface };
    }
    const mid = (a + b) / 2, cm = sample(mid);
    return search(a, mid, ca, cm, depth + 1) ?? search(mid, b, cm, cb, depth + 1);
  };
  return search(span.startUs, span.endUs, sample(span.startUs), sample(span.endUs), 0);
}

/** 記録・通信を持たない、自由操作を試す1回の跳躍。 */
export class FreeArena {
  motion: FreeMotionState = createFreeMotion();
  phase: 'ready' | 'air' | 'done' = 'ready';
  cutoffUs: number | null = null;
  result: FreeResult | null = null;
  private floorUs = 0;
  constructor(readonly scenario: FreeScenario = 'flat') {}
  jump(high = false): void {
    if (this.phase !== 'ready') return;
    const speed = high ? 9 : 5.6;
    const gravity = 9.8;
    this.floorUs = Math.round(2 * speed / gravity * 1e6);
    this.motion = createFreeMotion({ velocity: [2, speed, 0], acceleration: [0, -gravity, 0] });
    this.phase = 'air';
  }
  advance(untilUs: number, inputs: readonly FreeMotionInput[] = []): void {
    if (this.phase !== 'air') return;
    const boxes = freeBoxes(this.scenario);
    let surface: FreeResult['surface'] = 'floor';
    const reachesFloor = untilUs >= this.floorUs;
    advanceFreeMotion(this.motion, Math.min(untilUs, this.floorUs), inputs, span => {
      const hit = firstFreeContact(span, boxes);
      if (hit) {
        surface = hit.surface;
        return hit.atUs;
      }
      return span.endUs >= this.floorUs ? this.floorUs : null;
    }, reachesFloor);
    if (!this.motion.halted) return;
    this.cutoffUs = this.motion.timeUs;
    const trick = scoreFreeMotion(this.motion.history, this.cutoffUs, 0);
    if (surface === 'floor') {
      // 支持面へ戻ったら、表示だけ標準の姿勢に戻す。採点には接地前の実回転を使う。
      const { pivot } = this.motion.pose;
      const rest = createFreeMotion().pose;
      this.motion.pose = { pivot: [pivot[0], rest.pivot[1], pivot[2]],
        dog: { ...rest.dog, p: [pivot[0], rest.dog.p[1], pivot[2]] },
        rider: { ...rest.rider, p: [pivot[0], rest.rider.p[1], pivot[2]] } };
    }
    const blocked = surface !== 'floor';
    this.result = { ...trick, ...(blocked ? { points: 0, tier: 0, label: '障害物に接触' } : {}),
      landing: blocked ? 'blocked' : 'landed', cutoffUs: this.cutoffUs, surface };
    this.phase = 'done';
  }
}
