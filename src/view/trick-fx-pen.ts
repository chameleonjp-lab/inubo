import { PointRing, setV, vec, type Rgb, type Vec } from './trick-fx-math';

/** 床の印の形。0=肉球、1=靴底、2=手のひら、3=星。 */
export type DecalShape = 0 | 1 | 2 | 3;

/** 描画の受け口。Three.js の実装と、検査用の記録の実装を差し替えられる。 */
export interface FxSink {
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, a: number): void;
  dot(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void;
  decal(x: number, y: number, z: number, yaw: number, shape: DecalShape, size: number, r: number, g: number, b: number, a: number): void;
  /** 一度だけ粒を出す。dirX/dirZ の向きへ spread（ラジアン）の幅で広げる。 */
  burst(n: number, x: number, y: number, z: number, r: number, g: number, b: number,
    speed: number, up: number, life: number, dirX: number, dirZ: number, spread: number): void;
}

const MIN_ALPHA = 0.003;

/** 形を線・点・床の印に分解する道具。 */
export class FxPen {
  sink: FxSink | null = null;
  private p = vec();
  private q = vec();

  line(a: Vec, b: Vec, c: Rgb, alpha: number): void {
    if (alpha > MIN_ALPHA) this.sink!.line(a.x, a.y, a.z, b.x, b.y, b.z, c[0], c[1], c[2], alpha);
  }
  dot(p: Vec, size: number, c: Rgb, alpha: number): void {
    if (alpha > MIN_ALPHA && size > 0) this.sink!.dot(p.x, p.y, p.z, size, c[0], c[1], c[2], alpha);
  }
  decal(p: Vec, yaw: number, shape: DecalShape, size: number, c: Rgb, alpha: number): void {
    if (alpha > MIN_ALPHA && size > 0) this.sink!.decal(p.x, p.y, p.z, yaw, shape, size, c[0], c[1], c[2], alpha);
  }
  burst(n: number, p: Vec, c: Rgb, speed: number, up: number, life: number, dirX: number, dirZ: number, spread: number): void {
    if (n > 0) this.sink!.burst(Math.round(n), p.x, p.y, p.z, c[0], c[1], c[2], speed, up, life, dirX, dirZ, spread);
  }

  /** 中心 o、平面の向き u・w、半径 ru・rw の楕円の弧（a0 から a1 まで）。taper で始点側を薄くする。 */
  arc(o: Vec, u: Vec, w: Vec, ru: number, rw: number, a0: number, a1: number, segs: number, c: Rgb, alpha: number, taper = false): void {
    for (let i = 0; i <= segs; i++) {
      const t = a0 + (a1 - a0) * i / segs;
      const cu = Math.cos(t) * ru, sw = Math.sin(t) * rw;
      setV(this.q, o.x + u.x * cu + w.x * sw, o.y + u.y * cu + w.y * sw, o.z + u.z * cu + w.z * sw);
      if (i > 0) this.line(this.p, this.q, c, taper ? alpha * i / segs : alpha);
      setV(this.p, this.q.x, this.q.y, this.q.z);
    }
  }

  /** 床の上の円（stretch で進行方向に伸ばす）。 */
  groundArc(o: Vec, r: number, c: Rgb, alpha: number, a0 = 0, a1 = Math.PI * 2, yaw = 0, stretch = 1): void {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i <= 28; i++) {
      const t = a0 + (a1 - a0) * i / 28;
      const f = Math.cos(t) * r * stretch, s = Math.sin(t) * r;
      setV(this.q, o.x + cs * f - sn * s, o.y, o.z + sn * f + cs * s);
      if (i > 0) this.line(this.p, this.q, c, alpha);
      setV(this.p, this.q.x, this.q.y, this.q.z);
    }
  }

  /** 4方向の光の筋と中心の点でできた小さな星。 */
  star(p: Vec, size: number, c: Rgb, alpha: number): void {
    const s = this.sink!;
    for (let i = 0; i < 4; i++) {
      const t = i * Math.PI / 4, k = i % 2 ? 0.55 : 1;
      const dx = Math.cos(t) * size * k, dy = Math.sin(t) * size * k;
      s.line(p.x - dx, p.y - dy, p.z, p.x + dx, p.y + dy, p.z, c[0], c[1], c[2], alpha);
    }
    this.dot(p, size * 0.7, c, alpha);
  }

  /**
   * 計測点の履歴を線にする。新しいほど明るい。
   * style: 0=実線、1=筆（先が太く尾が細い）、2=破線、3=先端に点、4=流星、5=点線。
   */
  trail(ring: PointRing, nowMs: number, windowMs: number, c: Rgb, alpha: number, style: number, dotSize = 0.05): void {
    const s = this.sink!;
    let px = 0, py = 0, pz = 0, has = false;
    for (let k = 0; k < ring.count; k++) {
      const i = ring.index(k);
      const t = ring.data[i + 3];
      if (t > nowMs) continue;
      const age = nowMs - t;
      if (age > windowMs) break;
      const x = ring.data[i], y = ring.data[i + 1], z = ring.data[i + 2];
      const fresh = 1 - age / windowMs;
      const a = alpha * (style === 1 || style === 4 ? fresh * fresh : fresh);
      if (style === 5) {
        if (!has || Math.hypot(x - px, y - py, z - pz) > 0.07) {
          s.dot(x, y, z, dotSize * (0.7 + 0.5 * fresh), c[0], c[1], c[2], a);
          px = x; py = y; pz = z; has = true;
        }
        continue;
      }
      if (has && !(style === 2 && k % 2 === 1)) {
        s.line(px, py, pz, x, y, z, c[0], c[1], c[2], a);
        if (style === 1 && fresh > 0.5) s.line(px, py + 0.018, pz, x, y + 0.018, z, c[0], c[1], c[2], a * 0.6);
      }
      if (!has && (style === 3 || style === 4)) s.dot(x, y, z, style === 4 ? 0.07 : 0.05, c[0], c[1], c[2], alpha);
      px = x; py = y; pz = z; has = true;
    }
  }
}
