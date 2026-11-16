import { clamp, length, quatAxisAngle, quatMul, quatRotate, type Quat, type Vec3 } from './math';

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit3 = (v: Vec3): Vec3 => length(v) > 1e-12 ? scale3(v, 1 / length(v)) : [0, 0, 0];
export function normalQ(q: Quat): Quat {
  const n = Math.hypot(...q);
  if (!Number.isFinite(n) || n < 1e-12) throw new Error('Invalid orientation');
  return q.map(v => v / n) as Quat;
}
export function rotationQ(v: Vec3): Quat {
  const n = length(v);
  return n < 1e-14 ? [0, 0, 0, 1] : quatAxisAngle(scale3(v, 1 / n), n);
}
export function qDistance(a: Quat, b: Quat): number {
  return 2 * Math.acos(clamp(Math.abs(a.reduce((n, v, i) => n + v * b[i], 0)), 0, 1));
}
export function rotateBody(body: { p: Vec3; q: Quat }, pivot: Vec3, delta: Quat): { p: Vec3; q: Quat } {
  return { p: add3(pivot, quatRotate(delta, sub3(body.p, pivot))), q: normalQ(quatMul(delta, body.q)) };
}
