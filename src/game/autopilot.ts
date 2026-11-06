import { STEER_GAIN, TICK_US } from './rules';
import { advanceRun } from './run';
import { uAtS } from './track';
import type { RouteStep, TrickPlan } from '../content/types';
import type { GestureFact, SimState } from './types';

/**
 * 自動操縦。コースのデータに書いた手順（どこで横へ動く・跳ぶ・技を出す）を、
 * 人の指と同じ入力（指を置く → 払う → 離す）に変えて渡す。試験と自動再生で使う。
 */
export class Autopilot {
  private i = 0;
  private strokeId: number;
  private waitingTrick: TrickPlan | null = null;
  private trickJumpId = -1;

  constructor(private steps: RouteStep[], strokeBase = 1_000_000) {
    this.strokeId = strokeBase;
  }

  get done(): boolean {
    return this.i >= this.steps.length && !this.waitingTrick;
  }

  /** 今の状態を見て、出すべき入力を返す（時刻は今の走行時計）。 */
  poll(run: SimState): GestureFact[] {
    const out: GestureFact[] = [];
    const now = run.simUs;
    if (this.waitingTrick && run.mode === 'air' && run.jump && run.jump.jumpId !== this.trickJumpId) {
      out.push(...this.trickFacts(this.waitingTrick, Math.max(now, run.jump.takeoffUs + this.waitingTrick.afterUs)));
      this.trickJumpId = run.jump.jumpId;
      this.waitingTrick = null;
    }
    while (this.i < this.steps.length) {
      const st = this.steps[this.i];
      const p = run.course.paths.get(run.pathId)!;
      const u = uAtS(p, run.s);
      if (st.path && st.path !== run.pathId) {
        // 別の道を選んでいる場合、その位置を過ぎたら手順を飛ばす。
        if (u >= st.at + 3) {
          this.i++;
          continue;
        }
        break;
      }
      if (u < st.at) break;
      // 横払いと前払いは地上（手すりの上を含む）の操作。空中では着地を待つ（空中の払いは技になるため）。
      if (('steer' in st || 'jump' in st) && run.mode !== 'ground' && run.mode !== 'rail') break;
      this.i++;
      if ('steer' in st) {
        const id = this.strokeId++;
        out.push({ kind: 'down', atUs: now, strokeId: id });
        out.push({ kind: 'steer', atUs: now, strokeId: id, dx: (st.steer - run.targetX) / STEER_GAIN });
        out.push({ kind: 'up', atUs: now + 1, strokeId: id, cancelled: false });
      } else if ('jump' in st) {
        const id = this.strokeId++;
        out.push({ kind: 'down', atUs: now, strokeId: id });
        out.push({ kind: 'forward', atUs: now, strokeId: id });
        out.push({ kind: 'up', atUs: now + 1, strokeId: id, cancelled: false });
      } else if ('trick' in st) {
        if (run.mode === 'air' && run.jump && run.jump.jumpId !== this.trickJumpId) {
          out.push(...this.trickFacts(st.trick, Math.max(now + 1, run.jump.takeoffUs + st.trick.afterUs)));
          this.trickJumpId = run.jump.jumpId;
        } else {
          this.waitingTrick = st.trick;
        }
      }
    }
    return out;
  }

  private trickFacts(plan: TrickPlan, t: number): GestureFact[] {
    const out: GestureFact[] = [];
    const style = plan.style ?? 'two';
    if (plan.dog && plan.body !== undefined && style === 'one') {
      const id = this.strokeId++;
      out.push({ kind: 'down', atUs: t, strokeId: id });
      out.push({ kind: 'circle', atUs: t + 150_000, strokeId: id, vertical: plan.dog.vertical, clockwise: plan.dog.clockwise, aspect: plan.dog.vertical ? 1.4 : 1 });
      out.push({ kind: 'line', atUs: t + 250_000, strokeId: id, dir8: plan.body, afterCircle: true });
      out.push({ kind: 'up', atUs: t + 250_000, strokeId: id, cancelled: false });
      return out;
    }
    const a = this.strokeId++;
    const b = this.strokeId++;
    if (plan.dog) out.push({ kind: 'down', atUs: t, strokeId: a });
    if (plan.body !== undefined) out.push({ kind: 'down', atUs: t + 10, strokeId: b });
    if (plan.dog) {
      out.push({ kind: 'circle', atUs: t + 150_000, strokeId: a, vertical: plan.dog.vertical, clockwise: plan.dog.clockwise, aspect: plan.dog.vertical ? 1.4 : 1 });
      out.push({ kind: 'up', atUs: t + 170_000, strokeId: a, cancelled: false });
    }
    if (plan.body !== undefined) {
      out.push({ kind: 'line', atUs: t + 160_000, strokeId: b, dir8: plan.body, afterCircle: false });
      out.push({ kind: 'up', atUs: t + 160_000, strokeId: b, cancelled: false });
    }
    return out;
  }
}

/** 自動操縦で最後まで走らせる（上限時間つき）。描画間隔 stepUs ごとに進める。 */
export function runWithAutopilot(run: SimState, steps: RouteStep[], opts: { stepUs?: number; maxUs?: number } = {}): SimState {
  const pilot = new Autopilot(steps);
  const stepUs = opts.stepUs ?? TICK_US;
  const maxUs = opts.maxUs ?? 240_000_000;
  let t = run.simUs;
  while (!run.finished && t < maxUs) {
    const facts = pilot.poll(run);
    t += stepUs;
    advanceRun(run, t, facts);
  }
  return run;
}
