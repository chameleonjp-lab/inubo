import { describe, expect, test } from 'vitest';
import { createEffects, speedMultiplier, stepPoop, takeFood } from '../src/game/items';
import { RunSession, advanceRun } from '../src/game/run';
import { forwardSpeedAt } from '../src/game/motion';
import { DOGS } from '../src/content/dogs';
import { identity, jumpFacts, newRun, runTo, testCourse } from './helpers';

describe('V13 アイテム', () => {
  test('0 秒でフード、4 秒で別の袋、6 秒で糞: 6〜8 秒未満は 0.75 倍、8〜9 秒未満は 1.25 倍、9 秒で通常', () => {
    const e = createEffects();
    takeFood(e, 0);
    expect(speedMultiplier(e, 3_999_999)).toBe(1.25);
    takeFood(e, 4_000_000);
    expect(speedMultiplier(e, 5_999_999)).toBe(1.25);
    stepPoop(e, 6_000_000);
    expect(speedMultiplier(e, 6_000_000)).toBe(0.75);
    expect(speedMultiplier(e, 7_999_999)).toBe(0.75);
    expect(speedMultiplier(e, 8_000_000)).toBe(1.25);
    expect(speedMultiplier(e, 8_999_999)).toBe(1.25);
    expect(speedMultiplier(e, 9_000_000)).toBe(1);
  });

  test('7 秒で中断し、再開後の走行 8 秒・9 秒で同じ倍率になる（中断中は残り時間が止まる）', () => {
    const course = testCourse({ objects: [{ kind: 'food', id: 'f0', path: 'main', u: 2, x: 0, h: 0.35 }] });
    const session = new RunSession(identity(), course, DOGS.shiba);
    let wall = 0;
    session.update(wall);
    while (session.phase === 'countdown') session.update((wall += 10_000));
    const sim = session.sim;
    const step = () => session.update((wall += 10_000));
    while (sim.simUs < 4_000_000) step();
    // 4 秒で別の袋を取ったことにする。
    takeFood(sim.effects, 4_000_000);
    while (sim.simUs < 6_000_000) step();
    stepPoop(sim.effects, 6_000_000);
    while (sim.simUs < 7_000_000) step();
    session.pause('manual');
    wall += 30_000_000;
    session.update(wall);
    session.requestResume(wall);
    const at = (tUs: number) => {
      while (sim.simUs < tUs) step();
      return forwardSpeedAt(sim, sim.simUs) / sim.baseSpeed;
    };
    expect(at(7_500_000)).toBeCloseTo(0.75, 12);
    expect(at(8_000_000)).toBeCloseTo(1.25, 12);
    expect(at(9_000_000)).toBe(1);
  });

  test('加速中でも、前方が塞がると最終の前進は 0。止まっている間も残り時間は減る（R50）', () => {
    const course = testCourse({
      objects: [
        { kind: 'food', id: 'f', path: 'main', u: 36, x: 0, h: 0.35 },
        { kind: 'wall', id: 'w', path: 'main', u0: 72, u1: 72.4, x0: -4, x1: 4, height: 1.8 },
      ],
    });
    const run = newRun(course);
    let t = 0;
    while (!run.blocked) advanceRun(run, (t += 5_000));
    const until = run.effects.foodUntilUs!;
    expect(until - run.simUs).toBeLessThan(5_000_000);
    expect(forwardSpeedAt(run, run.simUs)).toBe(0);
    runTo(run, until + 200_000);
    expect(run.effects.foodUntilUs).toBeNull();
  });

  test('空中で越えた糞は未消費、地面で踏むと消費して 2 秒間 60%', () => {
    const course = testCourse({
      objects: [
        { kind: 'poop', id: 'p1', path: 'main', u: 40, x: 0 },
        { kind: 'poop', id: 'p2', path: 'main', u: 120, x: 0 },
      ],
    });
    const run = newRun(course);
    let t = 0;
    while (run.s < 35) advanceRun(run, (t += 5_000));
    runTo(run, t + 1_000_000, jumpFacts(t));
    expect(run.consumed.p1).toBeUndefined();
    while (run.s < 121) advanceRun(run, (t = Math.max(t, run.simUs) + 5_000));
    expect(run.consumed.p2).toBe(true);
    const poop = run.events.find((e) => e.kind === 'poop')!;
    expect(run.effects.poopUntilUs! - poop.atUs).toBe(2_000_000);
    expect(forwardSpeedAt(run, run.simUs) / run.baseSpeed).toBeCloseTo(0.6, 12);
  });

  test('空中の袋は同じ高さで取れる。同じ走行で落下・復帰しても取った物は戻らない', () => {
    const course = testCourse({
      edges: ['wall', 'drop'],
      objects: [
        { kind: 'checkpoint', id: 'cp', path: 'main', u: 20, x: 0 },
        { kind: 'food', id: 'air', path: 'main', u: 43, x: 0, h: 1.0 },
      ],
    });
    const run = newRun(course);
    let t = 0;
    while (run.s < 38) advanceRun(run, (t += 5_000));
    runTo(run, t + 1_000_000, jumpFacts(t));
    expect(run.consumed.air).toBe(true);
    const firstUntil = run.effects.foodUntilUs;
    expect(firstUntil).not.toBeNull();
    // 落下して復帰しても、袋は戻らない（もう一度通っても取らない）。
    run.targetX = 6;
    while (run.events.filter((e) => e.kind === 'respawn').length === 0) advanceRun(run, (t = Math.max(t, run.simUs) + 5_000));
    run.targetX = 0;
    while (run.s < 38) advanceRun(run, (t = Math.max(t, run.simUs) + 5_000));
    runTo(run, run.simUs + 1_000_000, jumpFacts(run.simUs));
    expect(run.events.filter((e) => e.kind === 'food').length).toBe(1);
  });
});
