import './park-item-runs';
import './park-route-runs';
import { expect, test } from 'vitest';
import { park } from '../src/content/courses/park';
import { FOOT_HALF_WIDTH } from '../src/game/rules';
import { baseGrade, baseHeight, buildCourse, hwAt, sAtU, uAtS } from '../src/game/track';
import type { PathRt } from '../src/game/track';

const course = buildCourse(park);
const paths = [...course.paths.values()];

// 計画 §1 の坂・アイテム・ギミック。共通道は一度だけ数える。
const pathCounts = {
  start: [3, 9, 12],
  'f1-slope': [2, 0, 0],
  'f1-stairs': [0, 0, 3],
  'f1-rail': [0, 0, 6],
  mid: [1, 8, 8],
  'f2-short': [0, 4, 3],
  'f2-rail': [0, 0, 3],
  late: [2, 7, 18],
  extension: [6, 16, 76],
};

function slopes(path: PathRt) {
  const start = Math.max(3, path.def.u0);
  const end = Math.min(1517, path.def.u1);
  const boundaries = new Set([
    start, end, ...(path.def.height ?? park.height).map(({ u }) => u),
    ...path.stairs.flatMap(({ s0, s1 }) => [uAtS(path, s0), uAtS(path, s1)]),
  ]);
  const points = [...boundaries].filter((u) => u >= start && u <= end).sort((a, b) => a - b);
  const result: { direction: number; start: number; end: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const grade = baseGrade(path, sAtU(path, (a + b) / 2));
    if (Math.abs(grade) <= 1e-8) continue;
    const last = result.at(-1);
    const direction = Math.sign(grade);
    if (last && last.direction === direction && last.end === a) last.end = b;
    else result.push({ direction, start: a, end: b });
  }
  return result;
}

function counts(path: PathRt) {
  return [slopes(path).length, path.items.length, path.solids.length + path.stairs.length];
}

function totals(ids: string[]) {
  const values = ids.map((id) => counts(course.paths.get(id)!));
  return [0, 1, 2].map((i) => values.reduce((sum, row) => sum + row[i], 0));
}

test('公園の全配置と各道の設置数が仕様表に一致する', () => {
  expect(park.id).toBe('park');
  expect(park.version).toBe('park-3');
  expect(park.start).toEqual({ path: 'start', u: 3 });
  expect(park.goal).toEqual({ path: 'extension', u: 1517 });
  expect(course.opportunities).toEqual(Array.from({ length: 18 }, (_, i) => 'S' + (i + 1)));
  expect(totals(paths.map((p) => p.id))).toEqual([14, 44, 129]);
  expect(Object.fromEntries(paths.map((p) => [p.id, counts(p)]))).toEqual(pathCounts);
});

// 要件 §2。各経路の期待値は各道の表と独立に固定する。
test.each([
  ['f1-slope', 'f2-short', [14, 44, 117]],
  ['f1-slope', 'f2-rail', [14, 40, 117]],
  ['f1-stairs', 'f2-short', [12, 44, 120]],
  ['f1-stairs', 'f2-rail', [12, 40, 120]],
  ['f1-rail', 'f2-short', [12, 44, 123]],
  ['f1-rail', 'f2-rail', [12, 40, 123]],
] as const)('%s → %s の設置数', (first, second, expected) => {
  expect(totals(['start', first, 'mid', second, 'late', 'extension'])).toEqual(expected);
});

function histogram(names: string[]) {
  const result: Record<string, number> = {};
  for (const name of names) result[name] = (result[name] ?? 0) + 1;
  return result;
}

const expectedKinds = { groundFood: 12, airFood: 8, guide: 8, poop: 16, kicker: 105, fence: 3, stairs: 6, rail: 6, wall: 6, gate: 3 };

test('開始線からゴールまでの定義と組み立てた走路が同じ内訳になる', () => {
  const ids = park.objects.map((o) => o.id);
  expect(new Set(ids).size).toBe(ids.length);
  const raw = park.objects.filter((o) => o.kind !== 'checkpoint' && o.kind !== 'arrow');
  for (const o of raw) {
    const path = course.paths.get(o.path)!;
    expect('u' in o ? o.u : o.u0, o.id).toBeGreaterThanOrEqual(Math.max(3, path.def.u0));
    expect('u' in o ? o.u : o.u1, o.id).toBeLessThanOrEqual(Math.min(1517, path.def.u1));
  }
  expect(histogram(raw.map((o) => o.kind === 'food' ? (o.h <= 0.9 ? 'groundFood' : 'airFood') : o.kind))).toEqual(expectedKinds);
  const built = paths.flatMap((p) => [
    ...p.items.map((i) => i.kind === 'food' ? (i.y - baseHeight(p, i.s) <= 0.9 ? 'groundFood' : 'airFood') : i.kind),
    ...p.solids.map((s) => s.kind), ...p.stairs.map(() => 'stairs'),
  ]);
  expect(histogram(built)).toEqual(expectedKinds);
});

test('自然斜面の向きと両端を検査し、踊り場と階段を坂から除く', () => {
  const all = paths.flatMap(slopes);
  const intervals = (direction: number) => all.filter((s) => s.direction === direction).map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
  expect(intervals(1)).toEqual([[92, 114], [300, 340], [620, 644], [875, 965], [1172, 1196], [1270, 1395]]);
  expect(intervals(-1)).toEqual([[124, 144], [150, 200], [228, 244], [253, 272], [654, 678], [1050, 1160], [1210, 1236], [1395, 1480]]);
});

test('追加の坂の高さ・階段の踏み面・分岐と合流の高さ', () => {
  const profiles: [string, number[][]][] = [
    ['start', [[92, 4.5], [114, 5.5], [124, 5.5], [144, 4.5]]],
    ['f1-slope', [[214, 2], [228, 2], [244, 1], [253, 1], [272, 0], [286, 0]]],
    ['late', [[620, 2], [644, 3], [654, 3], [678, 2]]],
    ['extension', [[1172, 1], [1196, 2], [1210, 2], [1236, 1]]],
  ];
  for (const [id, points] of profiles) {
    const path = course.paths.get(id)!;
    for (const [u, h] of points) expect(baseHeight(path, sAtU(path, u))).toBeCloseTo(h, 6);
  }
  for (const p of paths) {
    for (const stair of p.stairs) {
      expect(stair.hTop, stair.id).toBeGreaterThan(stair.hBottom);
      let previous = stair.hTop;
      for (let i = 0; i < stair.steps; i++) {
        const s = stair.s0 + (stair.s1 - stair.s0) * (i + 0.5) / stair.steps;
        const current = baseHeight(p, s);
        expect(current, stair.id).toBeLessThan(previous);
        previous = current;
      }
      expect(previous).toBeCloseTo(stair.hBottom, 6);
    }
    const next = p.next.kind === 'fork' ? p.next.options.map((option) => option.to) : p.next.kind === 'path' ? [p.next.to] : [];
    for (const id of next) {
      expect(Math.abs(baseHeight(p, p.length) - baseHeight(course.paths.get(id)!, 0)), p.id + ' → ' + id).toBeLessThanOrEqual(0.001);
    }
  }
});

test('アイテムと固体が道に収まり、通り道や地上の拾い物が塞がれない', () => {
  for (const p of paths) {
    for (const [i, solid] of p.solids.entries()) {
      for (const s of [solid.s0, (solid.s0 + solid.s1) / 2, solid.s1]) {
        expect(solid.x0, solid.id).toBeGreaterThanOrEqual(-hwAt(p, s));
        expect(solid.x1, solid.id).toBeLessThanOrEqual(hwAt(p, s));
      }
      if (solid.id.includes('-v3-')) {
        expect(solid.x1 < -FOOT_HALF_WIDTH || solid.x0 > FOOT_HALF_WIDTH, solid.id).toBe(true);
      }
      for (const other of p.solids.slice(i + 1)) {
        const length = Math.min(solid.s1, other.s1) - Math.max(solid.s0, other.s0);
        const width = Math.min(solid.x1, other.x1) - Math.max(solid.x0, other.x0);
        expect(length > 0 && width > 0, solid.id + ' × ' + other.id).toBe(false);
      }
    }
    for (const item of p.items) {
      expect(Math.abs(item.x), item.id).toBeLessThanOrEqual(hwAt(p, item.s));
      if (item.y - baseHeight(p, item.s) > 0.9) continue;
      for (const solid of p.solids) {
        const within = item.s >= solid.s0 && item.s <= solid.s1 &&
          item.x >= solid.x0 - FOOT_HALF_WIDTH && item.x <= solid.x1 + FOOT_HALF_WIDTH;
        expect(within, item.id + ' × ' + solid.id).toBe(false);
      }
    }
  }
});

test('糞16個は中心線の直線区間にある', () => {
  const hazards = park.objects.filter((o) => o.kind === 'poop');
  expect(hazards).toHaveLength(16);
  for (const hazard of hazards) {
    let end = 0;
    const segment = park.spine.segs.find((seg) => {
      end += seg.len;
      return hazard.u < end;
    });
    expect(segment, hazard.id).toBeDefined();
    expect(segment!.turn ?? 0, hazard.id).toBe(0);
  }
});

const byId = new Map(park.objects.map((o) => [o.id, o]));
const v3Id = (kind: string, index: number) => kind + '-v3-' + String(index).padStart(2, '0');

test('ジャンプ台70基の番号・前後位置・左右の幅は計画 §3 の順に一致する', () => {
  // 左は負、右は正。絶対値が踏切台の手前端 u0。
  const placements: [string, number[]][] = [
    ['start', [-12, 34, -68, 80, -101, 121, -146, 184]],
    ['mid', [-306, -324, -342, 358, 378, 403]],
    ['f2-short', [440, -483]],
    ['late', [-520, 536, 548, -578, -596, 622, -639, 660, -682, 718, -746, 762]],
    ['extension', Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : -1) * (802 + 24 * i))],
    ['extension', [790, -862, -910, 982, 1030, -1102, -1150, 1222, 1270, -1342, -1390, 1462]],
  ];
  let index = 0;
  for (const [path, positions] of placements) {
    for (const position of positions) {
      const [inner, outer] = path === 'f2-short' ? [0.8, 1.65] : [1.7, 3.3];
      const [x0, x1] = position < 0 ? [-outer, -inner] : [inner, outer];
      const id = v3Id('kicker', ++index);
      const u0 = Math.abs(position);
      expect(byId.get(id), id).toMatchObject({ kind: 'kicker', path, u0, u1: u0 + 4, x0, x1, height: 0.6 });
    }
  }
});

test('階段・手すり・柵・壁・片側ゲートの座標と動作値', () => {
  const left = { x0: -3.3, x1: -1.7 };
  const right = { x0: 1.7, x1: 3.3 };
  const groups = {
    stairs: [
      { path: 'f1-stairs', u0: 252, u1: 258, steps: 4 }, { path: 'f1-stairs', u0: 265, u1: 271, steps: 4 },
      { path: 'f1-rail', u0: 252, u1: 258, steps: 4 }, { path: 'f1-rail', u0: 265, u1: 271, steps: 4 },
    ],
    rail: [
      { path: 'f1-rail', u0: 251, u1: 260, x: -1.6, h0: 0.6, h1: 0.6 }, { path: 'f1-rail', u0: 264, u1: 274, x: 1.6, h0: 0.6, h1: 0.6 },
      { path: 'f2-rail', u0: 435, u1: 441, x: -1.35, h0: 0.6, h1: 0.6 }, { path: 'f2-rail', u0: 476, u1: 483, x: 1.35, h0: 0.6, h1: 0.6 },
    ],
    fence: [{ path: 'late', u: 655, ...left, height: 0.5 }, { path: 'extension', u: 870, ...left, height: 0.5 }],
    wall: [
      { path: 'start', u0: 112, u1: 115, ...right, height: 0.6, look: 'wall' },
      { path: 'mid', u0: 312, u1: 316, ...left, height: 0.6, look: 'planter' },
      { path: 'late', u0: 744, u1: 748, ...right, height: 0.6, look: 'wall' },
      { path: 'extension', u0: 1365, u1: 1369, ...right, height: 0.6, look: 'planter' },
    ],
    gate: [
      { path: 'extension', u: 948, ...left, height: 0.9, periodUs: 4_400_000, offsetUs: 1_100_000 },
      { path: 'extension', u: 1353, ...right, height: 0.9, periodUs: 4_400_000, offsetUs: 2_200_000 },
    ],
  };
  for (const [kind, rows] of Object.entries(groups)) {
    rows.forEach((row, i) => {
      const id = v3Id(kind, i + 1);
      expect(byId.get(id), id).toMatchObject({ kind, ...row });
    });
  }
  for (const id of ['fence-v3-01', 'fence-v3-02']) {
    const fence = course.solidsById.get(id)!;
    expect(fence.s1 - fence.s0, id).toBeCloseTo(0.2, 8);
  }
  for (const id of ['f1-stairs', 'f1-rail']) {
    const stairs = course.paths.get(id)!.stairs;
    expect(stairs.map((s) => [s.steps, s.hTop, s.hBottom])).toEqual([[10, 2, 0.8], [4, 0.8, 0.4], [4, 0.4, 0]]);
  }
});

test('44個の識別子・道・座標・路面からの高さが計画 §4 と一致する', () => {
  type Row = [path: string, u: number, x: number, height?: number];
  function check(kind: 'food' | 'poop' | 'guide', added: boolean, rows: Row[]) {
    rows.forEach(([path, u, x, h], i) => {
      const id = added ? v3Id(kind, i + 1) : kind + '-' + (i + 1);
      expect(byId.get(id), id).toMatchObject(h === undefined ? { kind, path, u, x } : { kind, path, u, x, h });
      const p = course.paths.get(path)!;
      const item = course.itemsById.get(id)!;
      expect(item.pathId, id).toBe(path);
      expect(item.s, id).toBeCloseTo(sAtU(p, u), 8);
      expect(item.x, id).toBe(x);
      expect(item.y - baseHeight(p, item.s), id).toBeCloseTo(h ?? 0, 8);
    });
  }
  check('food', false, [['start', 30, 1.5, 0.35], ['f2-short', 450, 0, 0.35], ['late', 615, 0, 3.6], ['extension', 994, 2.4, 3.8], ['extension', 1327, -2.8, 0.35]]);
  check('guide', false, [['start', 160, 0, 0.4], ['mid', 398, 0, 0.4]]);
  check('poop', false, [['mid', 325, 0], ['late', 728, -2], ['extension', 1069, 2.1], ['extension', 1445, -2.1]]);
  check('food', true, [
    ['start', 74, 2.35, 0.35], ['mid', 346, -1, 0.35], ['f2-short', 435, -1.3, 0.35], ['f2-short', 462, 1.25, 0.35], ['f2-short', 488, 1.35, 0.35],
    ['late', 528, 2.5, 0.35], ['extension', 850, -1, 0.35], ['extension', 1190, 0.95, 0.35], ['extension', 1468, 1.2, 0.35],
    ['start', 113, -2.4, 3.3], ['mid', 370, 2.4, 3.8], ['late', 634, 2.4, 3.4], ['extension', 898, -2, 3.3], ['extension', 1234, -2, 4.2], ['extension', 1450, 2, 4.2],
  ]);
  check('guide', true, [
    ['start', 120, -0.9, 0.4], ['start', 151, 2.45, 0.4], ['start', 189, -1.25, 0.4], ['mid', 332, -1.1, 0.4], ['mid', 365, -0.8, 0.4], ['mid', 386, 1.35, 0.4],
  ]);
  check('poop', true, [
    ['start', 41, -2.5], ['start', 190, -2.6], ['mid', 351, 2.75], ['late', 581, 2.7], ['late', 694, -2.8], ['late', 751, 1],
    ['extension', 827, 2.8], ['extension', 967, -2.75], ['extension', 1013, 2.8], ['extension', 1200, -2.6], ['extension', 1294, -1.35], ['extension', 1478, -2.75],
  ]);
});
