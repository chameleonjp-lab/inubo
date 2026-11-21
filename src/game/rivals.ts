import { baseHeight, hwAt, sampleAt, type CourseRt, type ItemRt, type PathRt } from './track';

const AIR_US = 820_000;
const ACCEL_US = 600_000;

interface RivalPattern {
  speed: number;
  lane: number;
  branches: readonly [number, number];
  first: number;
  spacing: number;
}

// 各組で、最初の3分岐と次の2分岐の組み合わせを一通り走れる。
const RIVALS: ReadonlyArray<{ delayUs: number; patterns: readonly RivalPattern[] }> = [
  { delayUs: 120_000, patterns: [
    { speed: 17.4, lane: -1.7, branches: [0, 0], first: 9, spacing: 31 },
    { speed: 18.4, lane: -2.1, branches: [0, 1], first: 8, spacing: 39 },
    { speed: 17.0, lane: -1.9, branches: [1, 0], first: 10, spacing: 35 },
    { speed: 18.8, lane: -2.4, branches: [1, 1], first: 12, spacing: 44 },
    { speed: 19.1, lane: -2.0, branches: [2, 0], first: 11, spacing: 33 },
    { speed: 17.7, lane: -2.3, branches: [2, 1], first: 13, spacing: 41 },
  ] },
  { delayUs: 460_000, patterns: [
    { speed: 18.1, lane: 1.8, branches: [2, 1], first: 15, spacing: 37 },
    { speed: 19.2, lane: 2.2, branches: [1, 0], first: 11, spacing: 46 },
    { speed: 17.1, lane: 2.35, branches: [0, 1], first: 12, spacing: 34 },
    { speed: 18.7, lane: 1.95, branches: [2, 0], first: 10, spacing: 42 },
    { speed: 17.6, lane: 2.5, branches: [1, 1], first: 13, spacing: 38 },
    { speed: 18.4, lane: 2.1, branches: [0, 0], first: 14, spacing: 48 },
  ] },
];

interface Leg { path: PathRt; from: number; to: number; distance: number; x: number; exitX: number }
interface Trick { start: number; end: number; angle: number }
interface Drop { atUs: number; items: ItemRt[] }
interface RivalPlan {
  speed: number;
  delayUs: number;
  legs: Leg[];
  tricks: Trick[];
  distance: number;
}

export interface RivalState {
  elapsedUs: number;
  plans: RivalPlan[];
  drops: Drop[];
  nextDrop: number;
  items: Map<string, ItemRt[]>;
}

export interface RivalPose {
  path: PathRt;
  s: number;
  x: number;
  height: number;
  heading: number;
  angle: number;
  speed: number;
}

function timeForDistance(distance: number, speed: number): number {
  const accelDistance = speed * ACCEL_US / 2e6;
  return distance < accelDistance
    ? Math.sqrt(distance / accelDistance) * ACCEL_US
    : distance / speed * 1e6 + ACCEL_US / 2;
}

function legsFor(course: CourseRt, pattern: RivalPattern): Leg[] {
  const legs: Leg[] = [];
  let path = course.paths.get(course.start.pathId);
  let distance = 0;
  let fork = 0;
  while (path) {
    const from = legs.length ? 0 : course.start.s;
    const goal = path.id === course.goal?.pathId ? course.goal.s : null;
    const to = goal ?? path.length;
    const x = path.def.route ? pattern.lane * 0.56 : pattern.lane;
    const next = path.next;
    const option = next.kind === 'fork' ? next.options[pattern.branches[fork++] ?? 0] : null;
    const pathId: string | undefined = option?.to ?? (next.kind === 'path' ? next.to : undefined);
    const nextPath: PathRt | undefined = pathId ? course.paths.get(pathId) : undefined;
    const exitX = option && nextPath
      ? Math.max(option.xMin + 0.2, Math.min(option.xMax - 0.2, nextPath.offStart - path.offEnd + pattern.lane * 0.56))
      : x;
    legs.push({ path, from, to, distance, x, exitX });
    distance += to - from;
    if (goal !== null) break;
    path = nextPath;
  }
  return legs;
}

function rivalLane(leg: Leg, previous: Leg | undefined, s: number): number {
  const enter = Math.min(1, (s - leg.from) / 14);
  const exit = Math.max(0, 1 - (leg.to - s) / 28);
  const fromX = previous ? previous.exitX + previous.path.offEnd - leg.path.offStart : leg.x;
  const limit = hwAt(leg.path, s) - 0.36;
  return Math.max(-limit, Math.min(limit, fromX * (1 - enter) + leg.x * (enter - exit) + leg.exitX * exit));
}

// 再試行では新しい走行IDを使い、同じ走行IDなら描画回数に関係なく配置を再現する。
function rivalRandom(runId: string, index: number): () => number {
  let hash = 2166136261;
  for (const char of `${runId}:${index}`) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  // 末尾の組番号だけが違う場合も、2組の選択が偏らないようビットを混ぜる。
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  let seed = (hash ^ (hash >>> 16)) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
}

export function createRivals(course: CourseRt, runId: string): RivalState {
  const drops: Drop[] = [];
  const plans = RIVALS.map(({ delayUs, patterns }, index): RivalPlan => {
    const random = rivalRandom(runId, index);
    const pattern = patterns[Math.floor(random() * patterns.length)];
    const { speed, first, spacing } = pattern;
    const legs = legsFor(course, pattern);
    const tricks: Trick[] = [];
    const span = speed * AIR_US / 1e6;
    for (const [legIndex, leg] of legs.entries()) {
      const { path, from, to, distance } = leg;
      const previous = legs[legIndex - 1];
      const candidates = new Map<number, boolean>();
      for (let s = from + (distance === 0 ? first : 8 + index * 5); s + span + 2 < to; s += spacing) {
        candidates.set(s, false);
      }
      // 先行役も正面の柵・壁・ゲートを飛び越える。通常の技より障害物を越えるジャンプを優先する。
      for (const solid of path.solids) {
        if (solid.kind === 'kicker' || solid.kind === 'rail' || solid.s1 - solid.s0 > span / 2) continue;
        const center = (solid.s0 + solid.s1) / 2;
        const x = rivalLane(leg, previous, center);
        if (x < solid.x0 - 0.2 || x > solid.x1 + 0.2) continue;
        const s = center - span / 2;
        if (s > from + 2 && s + span < to - 2) candidates.set(s, true);
      }
      for (const [s, required] of [...candidates].sort((a, b) => a[0] - b[0])) {
        if (!required && [...candidates].some(([near, priority]) => priority && Math.abs(near - s) < span + 1)) continue;
        const start = timeForDistance(distance + s - from, speed) + delayUs;
        if (start < (tricks.at(-1)?.end ?? 0) + 80_000) continue;
        const end = start + AIR_US;
        const landing = s + span;
        // 同じ走り方が選ばれた場合も、落とす位置は走行ごとに少しずらす。
        const scatterS = (random() - 0.5) * 3;
        const scatterX = (random() - 0.5) * 0.5;
        const items = [-0.8, 0, 0.7].map((offset, i): ItemRt => {
          const itemS = landing - 1.1 + i * 0.55 + scatterS;
          const limit = hwAt(path, itemS) - 0.52;
          const itemX = Math.max(-limit, Math.min(limit, rivalLane(leg, previous, itemS) + offset + scatterX));
          return { id: `rival-${index}-${tricks.length}-${i}`, kind: 'poop', pathId: path.id, s: itemS, x: itemX, y: baseHeight(path, itemS) };
        });
        drops.push({ atUs: end, items });
        tricks.push({ start, end, angle: (index ? -1 : 1) * (tricks.length % 3 === 2 ? Math.PI * 4 : Math.PI * 2) });
      }
    }
    const last = legs.at(-1)!;
    return { delayUs, speed, legs, tricks, distance: last.distance + last.to - last.from };
  });
  return { elapsedUs: 0, plans, drops: drops.sort((a, b) => a.atUs - b.atUs), nextDrop: 0, items: new Map() };
}

export function advanceRivals(state: RivalState | null, elapsedUs: number): void {
  if (!state || elapsedUs <= state.elapsedUs) return;
  state.elapsedUs = elapsedUs;
  while (state.nextDrop < state.drops.length && state.drops[state.nextDrop].atUs <= elapsedUs) {
    const { items } = state.drops[state.nextDrop++];
    const pathId = items[0].pathId;
    const list = state.items.get(pathId);
    if (list) {
      list.push(...items);
      list.sort((a, b) => a.s - b.s);
    }
    else state.items.set(pathId, [...items]);
  }
}

export function rivalPose(plan: RivalPlan, elapsedUs: number): RivalPose | null {
  const time = Math.max(0, elapsedUs - plan.delayUs);
  const accelFraction = Math.min(1, time / ACCEL_US);
  const distance = plan.speed / 1e6 * (Math.min(time, ACCEL_US) * accelFraction / 2 + Math.max(0, time - ACCEL_US));
  if (distance >= plan.distance) return null;
  const legIndex = plan.legs.findIndex(leg => distance < leg.distance + leg.to - leg.from);
  const leg = plan.legs[legIndex];
  const s = leg.from + distance - leg.distance;
  const x = rivalLane(leg, plan.legs[legIndex - 1], s);
  const trick = plan.tricks.find(jump => elapsedUs >= jump.start && elapsedUs < jump.end);
  const progress = trick ? (elapsedUs - trick.start) / AIR_US : 0;
  return {
    path: leg.path, s, x, heading: sampleAt(leg.path, s).heading,
    height: Math.sin(Math.PI * progress) * 2.65, angle: (trick?.angle ?? 0) * progress,
    speed: plan.speed * accelFraction,
  };
}
