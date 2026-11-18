// 開始線から1件ずつ狙う。操縦と期待値は配置データではなく実装計画§4–5の表に従う。
import { describe, expect, test } from 'vitest';
import { park } from '../src/content/courses/park';
import { DOG_ORDER } from '../src/content/dogs';
import type { DogId, RouteStep } from '../src/content/types';
import { Autopilot } from '../src/game/autopilot';
import { advanceRun } from '../src/game/run';
import { buildCourse, uAtS } from '../src/game/track';
import type { SimState } from '../src/game/types';
import { newRun, testCourse } from './helpers';

const course = buildCourse(park);

// [操作するu, 狙うx]。糞の3列目は地上で避けるときの目標x。
type Aim = [at: number, steer: number, dodgeX?: number];
function targets(kind: 'food' | 'guide' | 'poop', version: 'original' | 'v3', aims: Aim[]) {
  return aims.map(([at, steer, dodgeX], i) => ({
    kind, at, steer, dodgeX,
    id: version === 'v3' ? `${kind}-v3-${String(i + 1).padStart(2, '0')}` : `${kind}-${i + 1}`,
  }));
}

const allTargets = [
  ...targets('food', 'original', [[18, 1.5], [438, 0], [593, 0], [972, 2.4], [1309, -3.05]]),
  ...targets('food', 'v3', [
    [62, 2.35], [334, -1], [423, -1.3], [450, 1.25], [466, 1.35], [516, 2.5], [842, -1], [1178, 0.95], [1456, 1.2],
    [85, -2.4], [348, 2.4], [612, 2.4], [876, -2], [1212, -2], [1428, 2],
  ]),
  ...targets('guide', 'original', [[148, 0], [386, 0]]),
  ...targets('guide', 'v3', [[108, -0.9], [139, 2.45], [167, -1.25], [320, -1.1], [353, -0.8], [374, 1.35]]),
  ...targets('poop', 'original', [[313, 0, 1], [716, -2, 1], [1059, 2.1, -1], [1433, -2.1, 0]]),
  ...targets('poop', 'v3', [
    [29, -2.5, 1], [168, -2.6, -3.3], [339, 2.75, -1], [559, 2.95, -3.3], [684, -2.8, 1], [739, 1, -1],
    [805, 3.05, -1], [955, -2.75, 0], [995, 3.05, -1], [1188, -2.6, 1], [1282, -1.35, 1], [1466, -2.75, 1],
  ]),
];
const airFood = new Set(['food-3', 'food-4', 'food-v3-10', 'food-v3-11', 'food-v3-12', 'food-v3-13', 'food-v3-14', 'food-v3-15']);

function position(run: SimState) {
  return uAtS(run.course.paths.get(run.pathId)!, run.s);
}

function driveUntil(run: SimState, pilot: Autopilot, reached: () => boolean, goal: string) {
  while (!reached()) {
    if (run.finished || run.simUs >= 240_000_000) {
      throw new Error(`${run.dog.id} / ${goal}: ${run.pathId} u=${position(run)} t=${run.simUs}`);
    }
    advanceRun(run, run.simUs + 5_000, pilot.poll(run));
  }
}

function aimAt(target: typeof allTargets[number], dog: DogId, mode: 'take' | 'dodge' | 'jump') {
  const item = course.itemsById.get(target.id)!;
  const u = uAtS(course.paths.get(item.pathId)!, item.s);
  const run = newRun(course, dog, { courseVersion: park.version });
  const safe = new Autopilot(park.autoRoutes.safe);
  driveUntil(run, safe, () => position(run) >= target.at, target.id);

  const steps: RouteStep[] = [{ at: target.at, steer: mode === 'dodge' ? target.dodgeX! : target.steer }];
  if (mode === 'jump') steps.push({ at: u - 2, jump: true });
  const pilot = new Autopilot(steps, 5_000_000);
  driveUntil(run, pilot, () => position(run) >= u, target.id);
  expect(run.pathId).toBe(item.pathId);
  const crossing = { mode: run.mode, dx: Math.abs(run.x - item.x), guide: { ...run.guide } };
  driveUntil(run, pilot, () => position(run) >= u + 0.5, target.id);
  const contacts = run.events.filter(e => e.objId === target.id && e.kind === target.kind);
  return { run, item, crossing, pilot, contacts };
}

describe.each(DOG_ORDER)('%s 開始線からのアイテム走行', dog => {
  test.each(allTargets)('$id の位置と高さに届き、対象を1回だけ消費', target => {
    const { run, item, crossing, pilot, contacts } = aimAt(target, dog, 'take');
    expect(contacts).toHaveLength(1);
    const contact = contacts[0];
    expect(contact.pathId).toBe(item.pathId);
    expect(Math.abs(contact.sMm - item.s * 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(contact.x - item.x)).toBeLessThanOrEqual(item.kind === 'poop' ? 0.45 : 0.6);
    expect(item.y).toBeGreaterThanOrEqual(contact.y - 0.1);
    expect(item.y).toBeLessThanOrEqual(contact.y + 0.9);
    expect(run.consumed[item.id]).toBe(true);
    if (airFood.has(item.id)) {
      expect(crossing.mode).toBe('air');
      const jump = run.events.filter(e => e.kind === 'jump' && e.seq < contact.seq).at(-1)!;
      expect(jump.data?.kind).toBe('kicker');
      driveUntil(run, pilot, () => run.mode === 'ground', item.id);
      const landing = run.events.find(e => e.kind === 'land' && e.data?.jumpId === jump.data?.jumpId)!;
      expect(landing.seq).toBeGreaterThan(contact.seq);
    }
    if (item.kind === 'guide') {
      const forkId = item.pathId === 'start' ? 'F1' : 'F2';
      expect(crossing.guide).toEqual({ active: true, forkId });
      driveUntil(run, pilot, () => run.forkStack.includes(forkId), item.id);
      expect(run.guide).toEqual({ active: true, forkId });
      driveUntil(run, pilot, () => !run.forkStack.includes(forkId), item.id);
      expect(run.pathId).toBe(forkId === 'F1' ? 'mid' : 'late');
      expect(run.events.filter(e => e.kind === 'guideClose' && e.seq > contact.seq)).toHaveLength(1);
      expect(run.guide).toEqual({ active: false, forkId: null });
    }
  });

  describe.each(['dodge', 'jump'] as const)('%s', mode => {
    test.each(allTargets.filter(t => t.kind === 'poop'))('$id を地上の横移動／通常ジャンプで回避', target => {
      const { run, item, crossing, contacts } = aimAt(target, dog, mode);
      expect(contacts).toHaveLength(0);
      expect(run.consumed[item.id]).toBeUndefined();
      if (mode === 'dodge') {
        expect(crossing.mode).toBe('ground');
        expect(crossing.dx).toBeGreaterThan(0.45);
      } else {
        expect(crossing.mode).toBe('air');
        expect(crossing.dx).toBeLessThanOrEqual(0.45);
        const jump = run.events.filter(e => e.kind === 'jump').at(-1)!;
        expect(jump.data?.viaSwipe).toBe(true);
      }
    });
  });
});

test('1走の中でF1の案内が閉じた後にF2の案内を取り直せる', () => {
  const target = allTargets.find(t => t.id === 'guide-1')!;
  const { run, pilot, crossing } = aimAt(target, 'shiba', 'take');
  expect(crossing.guide).toEqual({ active: true, forkId: 'F1' });
  driveUntil(run, pilot, () => run.pathId === 'mid', 'F1合流');
  expect(run.guide).toEqual({ active: false, forkId: null });
  // 安全な道のうち、F1合流から操作を再開する。
  const safe = new Autopilot(park.autoRoutes.safe.filter(st => st.at >= 286), 6_000_000);
  driveUntil(run, safe, () => position(run) >= 386, 'guide-2');
  const second = new Autopilot([{ at: 386, steer: 0 }], 7_000_000);
  driveUntil(run, second, () => position(run) >= 398.5, 'guide-2');
  expect(run.consumed['guide-2']).toBe(true);
  expect(run.guide).toEqual({ active: true, forkId: 'F2' });
  driveUntil(run, second, () => run.pathId === 'late', 'F2合流');
  expect(run.events.filter(e => e.kind === 'guideClose')).toHaveLength(2);
  expect(run.guide).toEqual({ active: false, forkId: null });
});

test('落下からの復帰後は同じアイテムを再取得せず、新しい走行では元の場所で取得できる', () => {
  const track = testCourse({
    edges: ['wall', 'drop'],
    objects: [
      { kind: 'checkpoint', id: 'before', path: 'main', u: 10, x: 0 },
      { kind: 'food', id: 'bag', path: 'main', u: 20, x: 0, h: 0.35 },
      { kind: 'guide', id: 'bone', path: 'main', u: 25, x: 0, h: 0.4 },
      { kind: 'poop', id: 'poop', path: 'main', u: 30, x: 0 },
    ],
  });
  const run = newRun(track);
  const pilot = new Autopilot([{ at: 35, steer: 6 }]);
  driveUntil(run, pilot, () => run.events.some(e => e.kind === 'respawn'), '復帰');
  expect(run.lastCheckpoint.id).toBe('before');
  expect(run.consumed).toEqual({ bag: true, bone: true, poop: true });
  driveUntil(run, pilot, () => position(run) >= 31, '復帰後に再通過');
  const pickups = (r: SimState) => r.events.filter(e => ['food', 'guide', 'poop'].includes(e.kind)).map(e => [e.objId, e.sMm]);
  expect(pickups(run)).toEqual([['bag', 20000], ['bone', 25000], ['poop', 30000]]);
  const fresh = newRun(track);
  expect(fresh.consumed).toEqual({});
  driveUntil(fresh, new Autopilot([]), () => position(fresh) >= 31, '再スタート');
  expect(pickups(fresh)).toEqual(pickups(run));
});
