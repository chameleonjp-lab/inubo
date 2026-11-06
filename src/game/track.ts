import type { CourseDef, Edge, Key, NextDef, ObjectDef, PathDef, SectionDef } from '../content/types';
import { RAIL_HALF_WIDTH, STEP_UP } from './rules';
import { clamp, lerp, smoothstep } from './math';

/**
 * コースの定義を、走行計算で使える形に組み立てる。
 * 各道は共通の「背骨」から横にずらして作るので、分岐と合流の位置で道がつながる。
 * 道の上の位置は、その道の中心線に沿った距離 s（m）と横位置 x（m、右が正）で表す。
 */

export const SPINE_STEP = 0.25;

export interface GateRt {
  periodUs: number;
  offsetUs: number;
  height: number;
}

/** 骨形ゲートの1周期: ランプ点灯 → 上昇 → 上がったまま → 下降 → 下がったまま。 */
export const GATE_LAMP_US = 900_000;
export const GATE_MOVE_US = 300_000;
export const GATE_UP_US = 1_600_000;

export type GatePhase = 'down' | 'lamp' | 'rising' | 'up' | 'falling';

export function gatePhase(g: GateRt, tUs: number): { phase: GatePhase; raise: number; phaseStartUs: number } {
  const period = g.periodUs;
  const p = (((tUs + g.offsetUs) % period) + period) % period;
  const base = tUs - p;
  const a = GATE_LAMP_US;
  const b = a + GATE_MOVE_US;
  const c = b + GATE_UP_US;
  const d = c + GATE_MOVE_US;
  if (p < a) return { phase: 'lamp', raise: 0, phaseStartUs: base };
  if (p < b) return { phase: 'rising', raise: (p - a) / GATE_MOVE_US, phaseStartUs: base + a };
  if (p < c) return { phase: 'up', raise: 1, phaseStartUs: base + b };
  if (p < d) return { phase: 'falling', raise: 1 - (p - c) / GATE_MOVE_US, phaseStartUs: base + c };
  return { phase: 'down', raise: 0, phaseStartUs: base + d };
}

export type SolidKind = 'fence' | 'wall' | 'kicker' | 'gate' | 'rail';

export interface Solid {
  id: string;
  kind: SolidKind;
  pathId: string;
  s0: number;
  s1: number;
  x0: number;
  x1: number;
  /** 足が乗れる上面か。手すりは乗れる面ではなく、滑走として別に扱う。 */
  standable: boolean;
  height: number;
  look?: string;
  gate?: GateRt;
  rail?: RailRt;
}

export interface RailRt {
  id: string;
  pathId: string;
  s0: number;
  s1: number;
  x: number;
  /** 両端の上面の高さ（絶対値）。 */
  H0: number;
  H1: number;
}

export interface ItemRt {
  id: string;
  kind: 'food' | 'poop' | 'guide';
  pathId: string;
  s: number;
  x: number;
  y: number;
}

export interface CheckpointRt {
  id: string;
  pathId: string;
  s: number;
  x: number;
}

export interface SectionRt {
  key: string;
  pathId: string;
  index: number;
  s0Mm: number;
  s1Mm: number;
  opp: string;
}

export interface StairsRt {
  id: string;
  s0: number;
  s1: number;
  steps: number;
  hTop: number;
  hBottom: number;
}

export interface ArrowRt {
  id: string;
  s: number;
  side: 'left' | 'right';
  dir: 'left' | 'right';
}

export interface PathRt {
  id: string;
  def: PathDef;
  length: number;
  /** 道幅の半分の最大値（描画の目安）。位置ごとの値は hwAt で求める。 */
  halfWidth: number;
  edges: [Edge, Edge];
  n: number;
  hw: Float64Array;
  u: Float64Array;
  s: Float64Array;
  px: Float64Array;
  pz: Float64Array;
  h: Float64Array;
  heading: Float64Array;
  kappa: Float64Array;
  offStart: number;
  offEnd: number;
  solids: Solid[];
  rails: RailRt[];
  items: ItemRt[];
  checkpoints: CheckpointRt[];
  sections: SectionRt[];
  stairs: StairsRt[];
  arrows: ArrowRt[];
  next: NextDef;
}

export interface CourseRt {
  def: CourseDef;
  paths: Map<string, PathRt>;
  start: { pathId: string; s: number };
  goal: { pathId: string; s: number } | null;
  /** 進み具合の分母（背骨の距離）。 */
  progressLength: number;
  opportunities: string[];
  solidsById: Map<string, Solid>;
  railsById: Map<string, RailRt>;
  itemsById: Map<string, ItemRt>;
}

function interpLinear(keys: Key[], u: number): number {
  if (keys.length === 0) return 0;
  if (u <= keys[0].u) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].u) {
      const a = keys[i - 1];
      const b = keys[i];
      return lerp(a.v, b.v, (u - a.u) / (b.u - a.u));
    }
  }
  return keys[keys.length - 1].v;
}

function interpSmooth(keys: Key[], u: number): number {
  if (keys.length === 0) return 0;
  if (u <= keys[0].u) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].u) {
      const a = keys[i - 1];
      const b = keys[i];
      return lerp(a.v, b.v, smoothstep((u - a.u) / (b.u - a.u)));
    }
  }
  return keys[keys.length - 1].v;
}

interface SpineRt {
  n: number;
  x: Float64Array;
  z: Float64Array;
  heading: Float64Array;
}

function buildSpine(def: CourseDef): SpineRt {
  const total = def.spine.segs.reduce((a, s) => a + s.len, 0);
  const n = Math.round(total / SPINE_STEP) + 1;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const heading = new Float64Array(n);
  let cx = def.spine.start[0];
  let cz = def.spine.start[1];
  let th = (def.spine.heading * Math.PI) / 180;
  let i = 0;
  x[0] = cx;
  z[0] = cz;
  heading[0] = th;
  for (const seg of def.spine.segs) {
    const steps = Math.round(seg.len / SPINE_STEP);
    const dth = (((seg.turn ?? 0) * Math.PI) / 180) / steps;
    for (let k = 0; k < steps; k++) {
      const mid = th + dth / 2;
      cx += Math.cos(mid) * SPINE_STEP;
      cz += Math.sin(mid) * SPINE_STEP;
      th += dth;
      i++;
      x[i] = cx;
      z[i] = cz;
      heading[i] = th;
    }
  }
  return { n, x, z, heading };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function buildPath(def: CourseDef, spine: SpineRt, p: PathDef): PathRt {
  const i0 = Math.round(p.u0 / SPINE_STEP);
  const i1 = Math.round(p.u1 / SPINE_STEP);
  if (i1 >= spine.n) throw new Error(`path ${p.id} exceeds the spine (${p.u1} m)`);
  const n = i1 - i0 + 1;
  const u = new Float64Array(n);
  const s = new Float64Array(n);
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const h = new Float64Array(n);
  const heading = new Float64Array(n);
  const kappa = new Float64Array(n);
  const offKeys = p.offset ?? [];
  const heightKeys = p.height ?? def.height;
  const hwKeys: Key[] = typeof p.halfWidth === 'number' ? [{ u: p.u0, v: p.halfWidth }] : p.halfWidth;
  const hw = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    u[k] = i * SPINE_STEP;
    const off = interpSmooth(offKeys, u[k]);
    const th = spine.heading[i];
    px[k] = spine.x[i] - Math.sin(th) * off;
    pz[k] = spine.z[i] + Math.cos(th) * off;
    h[k] = interpLinear(heightKeys, u[k]);
    hw[k] = interpLinear(hwKeys, u[k]);
    if (k > 0) s[k] = s[k - 1] + Math.hypot(px[k] - px[k - 1], pz[k] - pz[k - 1]);
  }
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    heading[k] = Math.atan2(pz[b] - pz[a], px[b] - px[a]);
  }
  for (let k = 0; k < n - 1; k++) {
    const ds = s[k + 1] - s[k];
    kappa[k] = ds > 0 ? wrapAngle(heading[k + 1] - heading[k]) / ds : 0;
  }
  kappa[n - 1] = kappa[Math.max(0, n - 2)];
  return {
    id: p.id,
    def: p,
    length: s[n - 1],
    halfWidth: Math.max(...hwKeys.map((k) => k.v)),
    edges: p.edges ?? ['wall', 'wall'],
    n,
    hw,
    u,
    s,
    px,
    pz,
    h,
    heading,
    kappa,
    offStart: interpSmooth(offKeys, p.u0),
    offEnd: interpSmooth(offKeys, p.u1),
    solids: [],
    rails: [],
    items: [],
    checkpoints: [],
    sections: [],
    stairs: [],
    arrows: [],
    next: p.next,
  };
}

/** s を含む区間の番号 k（s[k] ≤ s < s[k+1]）。 */
export function indexAt(p: PathRt, s: number): number {
  if (s <= 0) return 0;
  if (s >= p.length) return p.n - 2;
  let lo = 0;
  let hi = p.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function sAtU(p: PathRt, uq: number): number {
  if (uq <= p.u[0]) return 0;
  if (uq >= p.u[p.n - 1]) return p.length;
  const k = Math.floor((uq - p.u[0]) / SPINE_STEP);
  const t = (uq - p.u[k]) / SPINE_STEP;
  return lerp(p.s[k], p.s[k + 1], t);
}

export function uAtS(p: PathRt, s: number): number {
  const k = indexAt(p, s);
  const t = clamp((s - p.s[k]) / (p.s[k + 1] - p.s[k] || 1), 0, 1);
  return lerp(p.u[k], p.u[k + 1], t);
}

export interface PathSample {
  x: number;
  z: number;
  heading: number;
  kappa: number;
}

export function sampleAt(p: PathRt, s: number): PathSample {
  const k = indexAt(p, s);
  const t = clamp((s - p.s[k]) / (p.s[k + 1] - p.s[k] || 1), 0, 1);
  const ha = p.heading[k];
  const hb = ha + wrapAngle(p.heading[k + 1] - ha);
  return {
    x: lerp(p.px[k], p.px[k + 1], t),
    z: lerp(p.pz[k], p.pz[k + 1], t),
    heading: lerp(ha, hb, t),
    kappa: p.kappa[k],
  };
}

/** 道の位置 (s, x) の世界座標（水平面）。 */
export function worldXZ(p: PathRt, s: number, x: number): [number, number] {
  const sm = sampleAt(p, s);
  return [sm.x - Math.sin(sm.heading) * x, sm.z + Math.cos(sm.heading) * x];
}

/** 階段を除いた、路面の直線補間の高さ。 */
export function linearHeight(p: PathRt, s: number): number {
  const k = indexAt(p, s);
  const t = clamp((s - p.s[k]) / (p.s[k + 1] - p.s[k] || 1), 0, 1);
  return lerp(p.h[k], p.h[k + 1], t);
}

/** 路面の高さ。階段の範囲では段の高さにする。 */
export function baseHeight(p: PathRt, s: number): number {
  for (const st of p.stairs) {
    if (s >= st.s0 && s < st.s1) {
      const d = (st.s1 - st.s0) / st.steps;
      const k = Math.min(st.steps, Math.floor((s - st.s0) / d) + 1);
      return st.hTop - ((st.hTop - st.hBottom) * k) / st.steps;
    }
  }
  return linearHeight(p, s);
}

/** 路面の上り下りの傾き（高さ÷距離）。階段の踏み面は 0。 */
export function baseGrade(p: PathRt, s: number): number {
  for (const st of p.stairs) if (s >= st.s0 && s < st.s1) return 0;
  const k = indexAt(p, s);
  const ds = p.s[k + 1] - p.s[k];
  return ds > 0 ? (p.h[k + 1] - p.h[k]) / ds : 0;
}

export function railTopAt(r: RailRt, s: number): number {
  return lerp(r.H0, r.H1, clamp((s - r.s0) / (r.s1 - r.s0), 0, 1));
}

export function railGrade(r: RailRt): number {
  return (r.H1 - r.H0) / (r.s1 - r.s0);
}

/** 物の上面の高さ（絶対値）。時刻はゲートの上下に使う。 */
export function solidTop(p: PathRt, so: Solid, s: number, tUs: number): number {
  const sc = clamp(s, so.s0, so.s1);
  switch (so.kind) {
    case 'rail':
      return railTopAt(so.rail!, sc);
    case 'kicker':
      return baseHeight(p, so.s0) + so.height * clamp((sc - so.s0) / (so.s1 - so.s0), 0, 1);
    case 'gate':
      return baseHeight(p, so.s0) + so.height * gatePhase(so.gate!, tUs).raise;
    default:
      return baseHeight(p, sc) + so.height;
  }
}

/** 足元を支える面の高さ。足より STEP_UP 以上高い物の上面は支えにしない（中に入り込んでいる状態）。 */
export function supportHeight(p: PathRt, s: number, x: number, footY: number, tUs: number): number {
  let best = baseHeight(p, s);
  for (const so of p.solids) {
    if (!so.standable) continue;
    if (s < so.s0 || s > so.s1 || x < so.x0 || x > so.x1) continue;
    const top = solidTop(p, so, s, tUs);
    if (top <= footY + STEP_UP + 1e-9 && top > best) best = top;
  }
  return best;
}

/** 支えの面の傾き（踏切台の上では台の傾き）。 */
export function supportGrade(p: PathRt, s: number, x: number, footY: number, tUs: number): number {
  for (const so of p.solids) {
    if (so.kind !== 'kicker') continue;
    if (s < so.s0 || s > so.s1 || x < so.x0 || x > so.x1) continue;
    const top = solidTop(p, so, s, tUs);
    if (Math.abs(top - footY) < 0.05) return so.height / (so.s1 - so.s0) + baseGrade(p, s);
  }
  return baseGrade(p, s);
}

function placeObject(course: CourseRt, o: ObjectDef): void {
  const p = course.paths.get(o.path);
  if (!p) throw new Error(`object ${o.id} refers to missing path ${o.path}`);
  switch (o.kind) {
    case 'fence': {
      const s = sAtU(p, o.u);
      const d = o.depth ?? 0.2;
      const so: Solid = { id: o.id, kind: 'fence', pathId: p.id, s0: s - d / 2, s1: s + d / 2, x0: o.x0, x1: o.x1, standable: true, height: o.height };
      p.solids.push(so);
      course.solidsById.set(o.id, so);
      break;
    }
    case 'wall': {
      const so: Solid = { id: o.id, kind: 'wall', pathId: p.id, s0: sAtU(p, o.u0), s1: sAtU(p, o.u1), x0: o.x0, x1: o.x1, standable: true, height: o.height, look: o.look };
      p.solids.push(so);
      course.solidsById.set(o.id, so);
      break;
    }
    case 'kicker': {
      const so: Solid = { id: o.id, kind: 'kicker', pathId: p.id, s0: sAtU(p, o.u0), s1: sAtU(p, o.u1), x0: o.x0, x1: o.x1, standable: true, height: o.height };
      p.solids.push(so);
      course.solidsById.set(o.id, so);
      break;
    }
    case 'gate': {
      const s = sAtU(p, o.u);
      const so: Solid = {
        id: o.id, kind: 'gate', pathId: p.id, s0: s - 0.15, s1: s + 0.15, x0: o.x0, x1: o.x1, standable: true, height: o.height,
        gate: { periodUs: o.periodUs, offsetUs: o.offsetUs, height: o.height },
      };
      p.solids.push(so);
      course.solidsById.set(o.id, so);
      break;
    }
    case 'rail': {
      const s0 = sAtU(p, o.u0);
      const s1 = sAtU(p, o.u1);
      const rail: RailRt = { id: o.id, pathId: p.id, s0, s1, x: o.x, H0: linearHeight(p, s0) + o.h0, H1: linearHeight(p, s1) + o.h1 };
      const so: Solid = { id: o.id, kind: 'rail', pathId: p.id, s0, s1, x0: o.x - RAIL_HALF_WIDTH, x1: o.x + RAIL_HALF_WIDTH, standable: false, height: Math.max(o.h0, o.h1), rail };
      p.rails.push(rail);
      p.solids.push(so);
      course.solidsById.set(o.id, so);
      course.railsById.set(o.id, rail);
      break;
    }
    case 'stairs': {
      const s0 = sAtU(p, o.u0);
      const s1 = sAtU(p, o.u1);
      p.stairs.push({ id: o.id, s0, s1, steps: o.steps, hTop: linearHeight(p, s0), hBottom: linearHeight(p, s1) });
      break;
    }
    case 'food':
    case 'guide': {
      const s = sAtU(p, o.u);
      const it: ItemRt = { id: o.id, kind: o.kind, pathId: p.id, s, x: o.x, y: baseHeight(p, s) + o.h };
      p.items.push(it);
      course.itemsById.set(o.id, it);
      break;
    }
    case 'poop': {
      const s = sAtU(p, o.u);
      const it: ItemRt = { id: o.id, kind: 'poop', pathId: p.id, s, x: o.x, y: baseHeight(p, s) };
      p.items.push(it);
      course.itemsById.set(o.id, it);
      break;
    }
    case 'checkpoint':
      p.checkpoints.push({ id: o.id, pathId: p.id, s: sAtU(p, o.u), x: o.x });
      break;
    case 'arrow':
      p.arrows.push({ id: o.id, s: sAtU(p, o.u), side: o.side, dir: o.dir });
      break;
  }
}

function placeSections(course: CourseRt, sections: SectionDef[]): void {
  const perPath = new Map<string, SectionDef[]>();
  for (const sd of sections) {
    const list = perPath.get(sd.path) ?? [];
    list.push(sd);
    perPath.set(sd.path, list);
  }
  for (const [pathId, list] of perPath) {
    const p = course.paths.get(pathId);
    if (!p) throw new Error(`section refers to missing path ${pathId}`);
    list.sort((a, b) => a.u0 - b.u0);
    list.forEach((sd, index) => {
      const s0 = sd.u0 <= p.def.u0 ? 0 : sAtU(p, sd.u0);
      const s1 = sd.u1 >= p.def.u1 ? p.length : sAtU(p, sd.u1);
      p.sections.push({ key: `${pathId}#${index}`, pathId, index, s0Mm: Math.round(s0 * 1000), s1Mm: Math.round(s1 * 1000), opp: sd.opp });
    });
  }
}

export function buildCourse(def: CourseDef): CourseRt {
  const spine = buildSpine(def);
  const paths = new Map<string, PathRt>();
  for (const p of def.paths) paths.set(p.id, buildPath(def, spine, p));
  const course: CourseRt = {
    def,
    paths,
    start: { pathId: def.start.path, s: 0 },
    goal: null,
    progressLength: 1,
    opportunities: [],
    solidsById: new Map(),
    railsById: new Map(),
    itemsById: new Map(),
  };
  const startPath = paths.get(def.start.path);
  if (!startPath) throw new Error('missing start path');
  course.start = { pathId: startPath.id, s: sAtU(startPath, def.start.u) };
  if (def.goal) {
    const gp = paths.get(def.goal.path);
    if (!gp) throw new Error('missing goal path');
    course.goal = { pathId: gp.id, s: sAtU(gp, def.goal.u) };
    course.progressLength = def.goal.u - def.start.u;
  } else {
    course.progressLength = spine.n * SPINE_STEP;
  }
  for (const o of def.objects) placeObject(course, o);
  for (const p of paths.values()) {
    p.solids.sort((a, b) => a.s0 - b.s0);
    p.items.sort((a, b) => a.s - b.s);
    p.checkpoints.sort((a, b) => a.s - b.s);
  }
  placeSections(course, def.sections);
  course.opportunities = [...new Set(def.sections.map((s) => s.opp))];
  return course;
}

/** 道の中で、位置 sMm を含む採点区間（開始線を含み、終了線を含まない）。 */
export function sectionAt(p: PathRt, sMm: number): SectionRt | null {
  for (const sec of p.sections) if (sMm >= sec.s0Mm && sMm < sec.s1Mm) return sec;
  return null;
}

/** 位置 s の道幅の半分。 */
export function hwAt(p: PathRt, s: number): number {
  const k = indexAt(p, s);
  const t = clamp((s - p.s[k]) / (p.s[k + 1] - p.s[k] || 1), 0, 1);
  return lerp(p.hw[k], p.hw[k + 1], t);
}

/** 道の端で目標の横位置を収める範囲。落下側は端の外へも出せる。 */
export function lateralLimits(p: PathRt, s: number, wallMargin: number, dropOverreach: number): [number, number] {
  const hw = hwAt(p, s);
  const lo = p.edges[0] === 'wall' ? -hw + wallMargin : -hw - dropOverreach;
  const hi = p.edges[1] === 'wall' ? hw - wallMargin : hw + dropOverreach;
  return [lo, hi];
}
