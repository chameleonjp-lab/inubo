import { DEG, clamp, dot, length, type Vec3 } from '../game/math';
import { add3, cross3, scale3, unit3 } from '../game/free-math';
import type { FreeMotionInput, FreeTarget } from '../game/free-motion';

interface Point { x: number; y: number }
interface Finger { point: Point; target: FreeTarget }
/** 指の軌跡を仮想球に投影する。ジェスチャー名や技の判定は行わない。 */
export class FreePointerController {
  private fingers = new Map<number, Finger>();
  private width = 1;
  private height = 1;
  private seq = 0;
  constructor(private basis = { right: [1, 0, 0] as Vec3, up: [0, 1, 0] as Vec3, toward: [0, 0, 1] as Vec3 }) {}
  get activeCount(): number { return this.fingers.size; }
  setSurface(width: number, height: number): void {
    this.clear(); this.width = Math.max(1, width); this.height = Math.max(1, height);
  }
  down(id: number, x: number, y: number, target: FreeTarget): boolean {
    if (!Number.isFinite(x + y) || this.fingers.has(id)) return false;
    for (const f of this.fingers.values()) if (f.target === target || f.target === 'common' || target === 'common') return false;
    this.fingers.set(id, { point: this.point(x, y), target }); return true;
  }
  move(id: number, x: number, y: number, atUs: number): FreeMotionInput[] {
    const f = this.fingers.get(id);
    if (!f || !Number.isFinite(x + y) || !Number.isSafeInteger(atUs)) return [];
    const end = this.point(x, y), inputs: FreeMotionInput[] = [];
    const visit = (a: Point, b: Point, depth = 0) => {
      const pa = this.project(a), pb = this.project(b);
      const angle = Math.acos(clamp(dot(pa, pb), -1, 1));
      // 画面上の直線の中点を通す。対蹠点の外積は軸として使わない。
      // 球の内外境界では投影経路が曲がる。15度の上限より細かく取り、
      // 端末が途中のイベントを省いても速度加算の誤差を抑える。
      if (angle > 0.5 * DEG && depth < 20) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        visit(a, mid, depth + 1); visit(mid, b, depth + 1); return;
      }
      const axis = cross3(pa, pb);
      if (length(axis) < 1e-12 || angle < 1e-10) return;
      const v = scale3(unit3(axis), angle);
      const world = add3(add3(scale3(this.basis.right, v[0]), scale3(this.basis.up, v[1])), scale3(this.basis.toward, v[2]));
      inputs.push({ seq: ++this.seq, atUs, target: f.target, rotation: world });
    };
    visit(f.point, end); f.point = end; return inputs;
  }
  up(id: number): void { this.fingers.delete(id); }
  cancel(id: number): void { this.up(id); }
  clear(): void { this.fingers.clear(); }
  private point(x: number, y: number): Point {
    const radius = 0.45 * Math.min(this.width, this.height);
    return { x: clamp((x - this.width / 2) / radius, -4, 4), y: clamp((this.height / 2 - y) / radius, -4, 4) };
  }
  private project(p: Point): Vec3 {
    const r2 = p.x * p.x + p.y * p.y;
    return r2 <= 1 ? [p.x, p.y, Math.sqrt(1 - r2)] : unit3([p.x, p.y, 0]);
  }
}
