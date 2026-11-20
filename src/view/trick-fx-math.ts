/** 演出の描画で使う小さな計算。毎フレーム新しい入れ物を作らないよう、結果は out に書く。 */

export interface Vec { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

export const vec = (): Vec => ({ x: 0, y: 0, z: 0 });
export const setV = (o: Vec, x: number, y: number, z: number): Vec => { o.x = x; o.y = y; o.z = z; return o; };
export const copyV = (o: Vec, a: Vec): Vec => setV(o, a.x, a.y, a.z);
export const subV = (o: Vec, a: Vec, b: Vec): Vec => setV(o, a.x - b.x, a.y - b.y, a.z - b.z);
/** o = a + b × s */
export const addScaled = (o: Vec, a: Vec, b: Vec, s: number): Vec => setV(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const lenV = (a: Vec): number => Math.hypot(a.x, a.y, a.z);
export const dotV = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const distV = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const crossV = (o: Vec, a: Vec, b: Vec): Vec =>
  setV(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lerpV = (o: Vec, a: Vec, b: Vec, t: number): Vec =>
  setV(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export function normV(o: Vec): Vec {
  const l = lenV(o);
  return l < 1e-6 ? setV(o, 0, 1, 0) : setV(o, o.x / l, o.y / l, o.z / l);
}
/** 四元数 q で (x, y, z) を回した向き。 */
export function rotateV(o: Vec, q: Quat, x: number, y: number, z: number): Vec {
  // v' = v + w·t + q×t（t = 2 q×v）
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return setV(o,
    x + q.w * tx + (q.y * tz - q.z * ty),
    y + q.w * ty + (q.z * tx - q.x * tz),
    z + q.w * tz + (q.x * ty - q.y * tx));
}
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const easeOut = (x: number): number => 1 - (1 - clamp01(x)) ** 2;

/** 一度だけの演出の明るさ。立ち上がって、保ち、消える。範囲の外は0。 */
export function envelope(u: number, dur: number, rise: number, fall: number): number {
  if (u < 0 || u > dur) return 0;
  return Math.min(1, u / Math.max(1, rise)) * Math.min(1, (dur - u) / Math.max(1, fall));
}

/** 法線 n に直交する平面の向き u・w を求める。hint の向きを u に近づける。 */
export function planeBasis(n: Vec, hint: Vec, u: Vec, w: Vec): void {
  addScaled(u, hint, n, -dotV(hint, n));
  if (lenV(u) < 1e-4) {
    setV(u, -n.z, 0, n.x);
    if (lenV(u) < 1e-4) setV(u, 1, 0, 0);
  }
  normV(u);
  crossV(w, n, u);
  normV(w);
}

export const HISTORY_CAP = 40;

/** 計測点の最近の位置（時刻つき）。最大40点を使い回す。 */
export class PointRing {
  readonly data = new Float32Array(HISTORY_CAP * 4);
  head = 0;
  count = 0;
  push(x: number, y: number, z: number, t: number): void {
    const i = this.head * 4;
    this.data[i] = x; this.data[i + 1] = y; this.data[i + 2] = z; this.data[i + 3] = t;
    this.head = (this.head + 1) % HISTORY_CAP;
    this.count = Math.min(HISTORY_CAP, this.count + 1);
  }
  /** k=0 が最新の点の位置（data の添字）。 */
  index(k: number): number {
    return (((this.head - 1 - k) % HISTORY_CAP) + HISTORY_CAP) % HISTORY_CAP * 4;
  }
  read(k: number, out: Vec): Vec {
    const i = this.index(k);
    return setV(out, this.data[i], this.data[i + 1], this.data[i + 2]);
  }
  time(k: number): number {
    return this.data[this.index(k) + 3];
  }
  /** 指定時刻かそれより前の、いちばん新しい点。 */
  before(t: number, out: Vec): boolean {
    for (let k = 0; k < this.count; k++) {
      if (this.time(k) <= t) { this.read(k, out); return true; }
    }
    return false;
  }
  copyFrom(o: PointRing): void {
    this.data.set(o.data);
    this.head = o.head;
    this.count = o.count;
  }
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export type Rgb = readonly [number, number, number];
/** 犬は橙、人は青。琥珀は犬の上位段階、青白は人の上位段階、白は交点の強調。 */
export const FX_RGB: Readonly<Record<'dog' | 'rider' | 'amber' | 'ice' | 'white', Rgb>> = {
  dog: [1, 0.58, 0.2],
  rider: [0.3, 0.62, 1],
  amber: [1, 0.74, 0.22],
  ice: [0.72, 0.88, 1],
  white: [1, 1, 0.94],
};
