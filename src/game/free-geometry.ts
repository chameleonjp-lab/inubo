import { length, quatRotate, type Vec3 } from './math';
import { add3, scale3, sub3, unit3 } from './free-math';
import type { FreeBody, FreePose } from './free-motion';

export interface FreePart { id: string; p: Vec3; radius: number; load: boolean; color: string }
export const dogFeet: Vec3[] = [-0.35, 0.35].flatMap(x => [-0.14, 0.14].map(z => [x, -0.45, z] as Vec3));
export const dogPads: Vec3[] = [[-0.35, 0.17, 0], [0.35, 0.17, 0]];
export const riderFeet: Vec3[] = [[-0.35, -0.7, 0], [0.35, -0.7, 0]];
export const atBody = (b: FreeBody, p: Vec3): Vec3 => add3(b.p, quatRotate(b.q, p));

/** 同じ球群を表示と衝突に使う。今回は共通モデル1体で操作を確認する。 */
export function freeParts(pose: FreePose): FreePart[] {
  const parts: FreePart[] = [];
  const add = (id: string, p: Vec3, radius: number, color: string, load = false) => parts.push({ id, p, radius, color, load });
  const dog = (id: string, p: Vec3, r: number, c = '#c78947', load = false) => add(id, atBody(pose.dog, p), r, c, load);
  for (let i = 0; i < 7; i++) dog(`dog-body-${i}`, [-0.30 + i * 0.1, 0, 0], 0.20);
  dog('dog-head', [0.45, 0.17, 0], 0.19); dog('dog-nose', [0.61, 0.15, 0], 0.095, '#392b23');
  dog('dog-ear-a', [0.41, 0.34, -0.1], 0.07); dog('dog-ear-b', [0.41, 0.34, 0.1], 0.07);
  dog('dog-tail', [-0.49, 0.15, 0], 0.11);
  dogFeet.forEach((p, i) => {
    dog(`paw-${i}`, p, 0.05, '#654732', true);
    for (let k = 1; k <= 3; k++) dog(`dog-leg-${i}-${k}`, [p[0], -0.45 + k * 0.09, p[2]], 0.055);
  });
  dogPads.forEach((p, i) => dog(`pad-${i}`, p, 0.035, '#285850'));
  const rider = (id: string, p: Vec3, r: number, c = '#eb683d') => add(id, atBody(pose.rider, p), r, c);
  rider('hip', [0, 0, 0], 0.14, '#243b61');
  rider('torso-a', [0, 0.18, 0], 0.16); rider('torso-b', [0, 0.34, 0], 0.15);
  rider('head', [0, 0.61, 0], 0.14, '#f4cfab'); rider('helmet', [0, 0.70, 0], 0.15, '#2f7889');
  riderFeet.forEach((foot, i) => {
    const hip: Vec3 = [i ? 0.13 : -0.13, 0, 0];
    const d = sub3(foot, hip), distance = length(d), along = unit3(d);
    const a = (0.38 ** 2 - 0.37 ** 2 + distance ** 2) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, 0.38 ** 2 - a ** 2));
    const knee = add3(add3(hip, scale3(along, a)), [0, 0, bend]);
    for (const [j, pair] of [[hip, knee], [knee, foot]].entries()) {
      for (let k = 0; k <= 4; k++) rider(`rider-leg-${i}-${j}-${k}`, add3(pair[0], scale3(sub3(pair[1], pair[0]), k / 4)), 0.055, '#243b61');
    }
    rider(`shoe-${i}`, foot, 0.065, '#edf5eb');
    const armPoints: Vec3[] = [[i ? 0.16 : -0.16, 0.31, 0], [i ? 0.36 : -0.36, 0.16, 0.05], [i ? 0.47 : -0.47, 0.04, 0.12]];
    armPoints.forEach((p, k) => rider(`arm-${i}-${k}`, p, 0.06, k === 2 ? '#f4cfab' : '#eb683d'));
  });
  return parts;
}
export function feetOnPads(pose: FreePose): boolean {
  const pads = dogPads.map(p => atBody(pose.dog, p));
  const feet = riderFeet.map(p => atBody(pose.rider, p));
  return (length(sub3(feet[0], pads[0])) <= 0.18 && length(sub3(feet[1], pads[1])) <= 0.18) ||
    (length(sub3(feet[0], pads[1])) <= 0.18 && length(sub3(feet[1], pads[0])) <= 0.18);
}
