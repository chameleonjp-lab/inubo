import { expect, test } from 'vitest';
import { getCourse } from '../src/content/courses';
import { park } from '../src/content/courses/park';
import { parkFreestyle } from '../src/content/courses/park-freestyle';
import { DOGS, DOG_ORDER } from '../src/content/dogs';
import { runWithAutopilot } from '../src/game/autopilot';
import { FREE_RULES_VERSION } from '../src/game/free-motion';
import { jumpMultiplier } from '../src/game/items';
import { advanceRun, createRun, RunSession } from '../src/game/run';
import { rivalPose, type RivalState } from '../src/game/rivals';
import { hwAt, sampleAt, sAtU } from '../src/game/track';
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

function routeKeys(rivals: RivalState): string[] {
  return rivals.plans.map(plan => plan.legs.filter(leg => leg.path.def.route).map(leg => leg.path.id).join('/'));
}

test('先行する2組とも全6ルートを走り、同じルートの組み合わせでも糞の位置が変わる', () => {
  const routes = [new Set<string>(), new Set<string>()];
  const layoutsByRoutes = new Map<string, string>();
  let repeatedPair = false;
  for (let i = 0; i < 192; i++) {
    const session = new RunSession({ ...raceIdentity, runId: `npc-pattern-${i}` }, course, DOGS.shiba);
    session.begin();
    const rivals = session.sim.rivals!;
    const keys = routeKeys(rivals);
    keys.forEach((key, index) => routes[index].add(key));
    const opening = rivals.items.get('start')!;
    expect(opening).toHaveLength(6);
    expect(opening.every(item => Math.abs(item.x) > 0.5)).toBe(true);
    const pair = keys.join('|');
    const layout = JSON.stringify(opening.map(({ s, x }) => [s, x]));
    const previous = layoutsByRoutes.get(pair);
    if (previous) {
      repeatedPair = true;
      expect(layout).not.toBe(previous);
    }
    layoutsByRoutes.set(pair, layout);
    for (const { items } of rivals.drops) {
      const path = course.paths.get(items[0].pathId)!;
      expect(items.every(item => item.s > 0 && item.s < path.length && Math.abs(item.x) < hwAt(path, item.s))).toBe(true);
    }
  }
  expect(routes.map(routesByRival => routesByRival.size)).toEqual([6, 6]);
  expect(layoutsByRoutes.size).toBe(36);
  expect(repeatedPair).toBe(true);
});

test('同じ走行ではカウントダウンの進み方によらずNPCの分岐と落とす位置を再現する', () => {
  const stepped = new RunSession(raceIdentity, course, DOGS.shiba);
  advanceWall(stepped, 0, 3_000_000);
  const immediate = new RunSession(raceIdentity, course, DOGS.shiba);
  immediate.begin();
  expect(routeKeys(immediate.sim.rivals!)).toEqual(routeKeys(stepped.sim.rivals!));
  expect(immediate.sim.rivals!.items).toEqual(stepped.sim.rivals!.items);
  expect(immediate.sim.rivals!.drops).toEqual(stepped.sim.rivals!.drops);
});

test('骨が分岐5ルートと共通の道に10個増え、どれも拾うと5秒間ジャンプ力が上がる', () => {
  const bones = [...course.itemsById.values()].filter(item => item.kind === 'bone');
  const previousBones = park.objects.filter(object => object.kind === 'guide');
  expect(bones).toHaveLength(previousBones.length + 10);
  expect(previousBones.every(object => course.itemsById.get(object.id)?.kind === 'bone')).toBe(true);
  const extra = bones.filter(item => item.id.startsWith('bone-'));
  expect(extra.map(item => item.pathId)).toEqual([
    'start', 'f1-slope', 'f1-stairs', 'f1-rail', 'f2-short', 'f2-rail', 'late', 'extension', 'extension', 'extension',
  ]);
  for (const item of extra) {
    const path = course.paths.get(item.pathId)!;
    expect(Math.abs(item.x)).toBeLessThan(hwAt(path, item.s) - 0.5);
    expect(path.solids.some(solid => solid.s0 <= item.s && solid.s1 >= item.s && solid.x0 <= item.x && solid.x1 >= item.x)).toBe(false);
    const run = createRun(raceIdentity, course, DOGS.shiba);
    Object.assign(run, { pathId: path.id, s: item.s - 0.04, x: item.x, targetX: item.x, y: item.y - 0.4, baseSpeed: 14 });
    const pickup = advanceRun(run, 5_000).events.find(event => event.kind === 'jumpBoost');
    expect(pickup?.objId).toBe(item.id);
    expect(run.effects.jumpUntilUs).toBe(pickup!.atUs + 5_000_000);
    expect(jumpMultiplier(run.effects, pickup!.atUs)).toBe(1.3);
  }
});

test('公園の分岐とカーブに、それぞれ通る意味の違いがある', () => {
  expect(course.opportunities).toEqual([]);
  expect(course.paths.get('f1-slope')!.solids).toEqual([]);
  expect(course.paths.get('f1-stairs')!.solids.filter(s => s.kind === 'kicker')).toHaveLength(2);
  expect(course.paths.get('f1-rail')!.rails.map(rail => rail.id).sort()).toEqual([
    'r-stair', 'rail-stair-bridge', 'rail-v3-02',
  ]);
  expect(course.solidsById.has('rail-v3-01')).toBe(false);
  const bridge = course.railsById.get('rail-stair-bridge')!;
  expect(bridge.s1 - bridge.s0).toBeGreaterThan(25);
  expect(course.paths.get('f2-short')!.items.filter(item => item.kind === 'food' && Math.abs(item.x) < 0.5)).toHaveLength(4);
  expect(course.paths.get('f2-rail')!.solids.some(s => s.kind === 'kicker' && s.height >= 0.9)).toBe(true);
  const start = course.paths.get('start')!;
  expect(start.items).toContainEqual(expect.objectContaining({ kind: 'food', s: sAtU(start, 132), x: -2.5 }));
  const curveFood = [...course.itemsById.values()].filter(item => item.id.startsWith('curve-out'));
  expect(curveFood).toHaveLength(6);
  expect(curveFood.every(item => item.x * sampleAt(course.paths.get(item.pathId)!, item.s).kappa < 0)).toBe(true);
  expect(getCourse('park').opportunities.length).toBeGreaterThan(0);
});

const { safe, short, trick } = course.def.autoRoutes;
for (const dogId of DOG_ORDER) {
  for (const [first, label1] of [[safe, '脇の坂'], [short, '中央の階段'], [trick, '手すり']] as const) {
    for (const [second, label2] of [[safe, '短い平道'], [trick, '手すり道']] as const) {
      test(`現行の公園で ${dogId} が ${label1} と ${label2} を選んで完走できる`, () => {
        const run = createRun({ ...raceIdentity, dogId }, course, DOGS[dogId]);
        runWithAutopilot(run, [
          ...first.filter(step => step.at < 286),
          ...safe.filter(step => step.at >= 286 && step.at < 410),
          ...second.filter(step => step.at >= 410 && step.at < 500),
          ...safe.filter(step => step.at >= 500),
        ]);
        expect(run.route).toEqual([label1, label2]);
        expect(run.finished).toBe(true);
        expect(run.result?.sections).toEqual([]);
      });
    }
  }
}
