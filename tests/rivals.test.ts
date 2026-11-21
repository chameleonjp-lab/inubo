import { expect, test } from 'vitest';
import { getCourse } from '../src/content/courses';
import { parkFreestyle } from '../src/content/courses/park-freestyle';
import { DOGS } from '../src/content/dogs';
import { FREE_RULES_VERSION } from '../src/game/free-motion';
import { advanceRun, RunSession } from '../src/game/run';
import { rivalPose } from '../src/game/rivals';
import { sampleAt, sAtU } from '../src/game/track';
import { identity } from './helpers';

const course = getCourse('park', parkFreestyle.version);
const raceIdentity = { ...identity(), courseId: 'park', courseVersion: course.def.version, rulesVersion: FREE_RULES_VERSION } as const;

function advanceWall(session: RunSession, from: number, to: number) {
  for (let at = from; at <= to; at += 50_000) session.update(at);
}

test('3秒の間に2組が先行し、走行時計が0のまま糞を置く。停止と再試行は独立する', () => {
  const session = new RunSession(raceIdentity, course, DOGS.shiba);
  const rivals = session.sim.rivals!;
  const startingS = session.sim.s;
  advanceWall(session, 0, 1_200_000);
  expect(session.phase).toBe('countdown');
  expect(session.sim.s).toBe(startingS);
  expect(rivals.plans.map(plan => rivalPose(plan, rivals.elapsedUs)!.s)).toEqual([expect.any(Number), expect.any(Number)]);
  expect(rivals.plans.every(plan => rivalPose(plan, rivals.elapsedUs)!.s > startingS + 5)).toBe(true);
  expect(rivals.plans.some(plan => rivalPose(plan, rivals.elapsedUs)!.height > 1)).toBe(true);

  session.pause('manual');
  const stoppedAt = rivals.elapsedUs;
  advanceWall(session, 1_250_000, 1_950_000);
  expect(rivals.elapsedUs).toBe(stoppedAt);
  session.requestResume(1_950_000);
  advanceWall(session, 2_000_000, 3_500_000);
  expect(session.phase).toBe('countdown');
  expect(session.sim.simUs).toBe(0);
  const items = rivals.items.get('start')!;
  expect(items).toHaveLength(6);
  expect(items.every(item => item.kind === 'poop' && Math.abs(item.x) > 0.5)).toBe(true);
  expect(course.paths.get('start')!.items.some(item => item.id.startsWith('rival-'))).toBe(false);
  expect(new RunSession(raceIdentity, course, DOGS.shiba).sim.rivals!.items.size).toBe(0);
});

test('先行NPCの糞を着地前に飛び越せる。地上で踏むと2秒減速する', () => {
  const session = new RunSession(raceIdentity, course, DOGS.shiba);
  session.begin();
  const run = session.sim;
  const item = run.rivals!.items.get('start')![0];
  run.s = item.s - 0.04;
  run.x = run.targetX = item.x;
  run.baseSpeed = 14;
  const { events } = advanceRun(run, 5_000);
  const contact = events.find(event => event.kind === 'poop');
  expect(contact?.objId).toBe(item.id);
  expect(run.effects.poopUntilUs).toBe(contact!.atUs + 2_000_000);

  const other = new RunSession(raceIdentity, course, DOGS.shiba);
  other.begin();
  Object.assign(other.sim, { s: item.s - 0.04, x: item.x, targetX: item.x, y: item.y + 1.5, baseSpeed: 14, mode: 'air' });
  expect(advanceRun(other.sim, 5_000).events.some(event => event.kind === 'poop')).toBe(false);
});

test('公園の分岐とカーブに、それぞれ通る意味の違いがある', () => {
  expect(course.opportunities).toEqual([]);
  expect(course.paths.get('f1-slope')!.solids).toEqual([]);
  expect(course.paths.get('f1-stairs')!.solids.filter(s => s.kind === 'kicker')).toHaveLength(2);
  expect(course.paths.get('f1-rail')!.rails.some(rail => rail.s1 - rail.s0 > 25)).toBe(true);
  expect(course.paths.get('f2-short')!.items.filter(item => item.kind === 'food' && Math.abs(item.x) < 0.5)).toHaveLength(4);
  expect(course.paths.get('f2-rail')!.solids.some(s => s.kind === 'kicker' && s.height >= 0.9)).toBe(true);
  const start = course.paths.get('start')!;
  expect(start.items).toContainEqual(expect.objectContaining({ kind: 'food', s: sAtU(start, 132), x: -2.5 }));
  const curveFood = [...course.itemsById.values()].filter(item => item.id.startsWith('curve-out'));
  expect(curveFood).toHaveLength(6);
  expect(curveFood.every(item => item.x * sampleAt(course.paths.get(item.pathId)!, item.s).kappa < 0)).toBe(true);
  expect(getCourse('park').opportunities.length).toBeGreaterThan(0);
});
