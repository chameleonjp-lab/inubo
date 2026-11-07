/** 描画ライブラリに頼らない、計算側だけで使う小さな数学の道具。 */

export type Vec3 = [number, number, number];
/** 四元数 [x, y, z, w]。 */
export type Quat = [number, number, number, number];

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0→1 で傾きが 0 から始まり 0 で終わる補間。 */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

/** 軸（正規化済み）まわりに angle ラジアン回す四元数。 */
export function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** 2つのベクトルのなす角（度）。 */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const c = clamp(dot(a, b) / (length(a) * length(b)), -1, 1);
  return Math.acos(c) / DEG;
}

/** 小数の誤差で境界の判定が揺れないよう、細かい桁で丸める。 */
export function roundTo(v: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
