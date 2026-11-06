import { describe, expect, test } from 'vitest';
import { advanceRun } from '../src/game/run';
import { solidTop } from '../src/game/track';
import { FOOT_FRONT, FALL_US, STEP_UP } from '../src/game/rules';
import { count, dogSpinFacts, jumpFacts, newRun, runTo, steerFacts, testCourse } from './helpers';
import type { DogId } from '../src/content/types';
import type { SimState } from '../src/game/types';

const DOG_IDS: DogId[] = ['shiba', 'corgi', 'whippet'];

/** 毎刻み、足元が物の中に低いまま入り込んでいないかを調べながら進める。 */
function runChecked(run: SimState, untilUs: number, facts: { atUs: number }[] = []): void {
  const all = facts.slice() as Parameters<typeof advanceRun>[2];
  let t = run.simUs;
  while (t < untilUs && !run.finished) {
    t += 5_000;
    const batch = all!.filter((f) => f.atUs <= t);
    for (const f of batch) all!.splice(all!.indexOf(f), 1);
    advanceRun(run, t, batch);
    const p = run.course.paths.get(run.pathId)!;
    for (const so of p.solids) {
      if (so.kind === 'kicker') continue;
      const inside = run.s > so.s0 && run.s < so.s1 && run.x > so.x0 && run.x < so.x1;
      if (inside) expect(solidTop(p, so, run.s, run.simUs) - run.y).toBeLessThanOrEqual(STEP_UP + 1e-6);
    }
  }
}

describe('V03 速度と壁', () => {
  for (const dog of DOG_IDS) {
    for (const boosted of [false, true]) {
      test(`${dog}${boosted ? '（加速中）' : ''}: 薄い柵で前進 0・接触音 1 回、停止中も横とジャンプができ、越えたら自動で発進する`, () => {
        const course = testCourse({
          objects: [
            ...(boosted ? [{ kind: 'food' as const, id: 'f', path: 'main', u: 30, x: 0, h: 0.35 }] : []),
            { kind: 'fence', id: 'fence', path: 'main', u: 40, x0: -4, x1: 4, height: 0.5 },
          ],
        });
        const run = newRun(course, dog);
        runChecked(run, 6_000_000);
        expect(run.blocked?.solidId).toBe('fence');
        expect(run.forwardSpeed).toBe(0);
        expect(run.s).toBeCloseTo(course.paths.get('main')!.solids[0].s0 - FOOT_FRONT, 6);
        expect(count(run, 'collide')).toBe(1);
        if (boosted) expect(run.consumed.f).toBe(true);
        // 止まっている間も横へ動ける。
        const x0 = run.x;
        runChecked(run, 6_400_000, steerFacts(6_000_000, 0.1));
        expect(run.x).not.toBeCloseTo(x0, 3);
        expect(run.blocked?.solidId).toBe('fence');
        // その場から前ジャンプで越える。
        runChecked(run, 9_000_000, jumpFacts(6_500_000));
        expect(count(run, 'relaunch')).toBe(1);
        expect(run.blocked).toBeNull();
        expect(run.s).toBeGreaterThan(course.paths.get('main')!.solids[0].s1);
        expect(count(run, 'collide')).toBe(1);
      });
    }
    test(`${dog}: 高い壁は跳んでも越えられず、横の抜け道へ動くと発進する。踏切台からは越えられる`, () => {
      const course = testCourse({
        objects: [{ kind: 'wall', id: 'wall', path: 'main', u0: 40, u1: 40.4, x0: -2.6, x1: 4, height: 1.8 }],
      });
      const run = newRun(course, dog);
      runChecked(run, 6_000_000);
      expect(run.blocked?.solidId).toBe('wall');
      runChecked(run, 7_500_000, jumpFacts(6_000_000));
      expect(run.blocked?.solidId).toBe('wall');
      runChecked(run, 10_000_000, steerFacts(7_600_000, -3.3 / 9));
      expect(run.blocked).toBeNull();
      expect(run.s).toBeGreaterThan(41);

      const course2 = testCourse({
        objects: [
          { kind: 'kicker', id: 'k', path: 'main', u0: 32, u1: 36, x0: -1.2, x1: 1.2, height: 0.6 },
          { kind: 'wall', id: 'wall', path: 'main', u0: 40, u1: 40.4, x0: -4, x1: 4, height: 1.8 },
        ],
      });
      const run2 = newRun(course2, dog);
      runChecked(run2, 8_000_000);
      expect(count(run2, 'collide')).toBe(0);
      expect(run2.s).toBeGreaterThan(41);
    });
  }
});

describe('V04 距離と復帰', () => {
  test('急カーブの内側は外側より実際の距離が短く、同じ速さで通過時間も短い', () => {
    const course = testCourse({ segs: [{ len: 40 }, { len: 50, turn: -90 }, { len: 100 }], halfWidth: 4 });
    const times: Record<string, number> = {};
    const dists: Record<string, number> = {};
    for (const [name, x] of [['inside', -3], ['outside', 3]] as const) {
      const run = newRun(course);
      runTo(run, 1_000_000, steerFacts(0, x / 9));
      let t = run.simUs;
      let tIn = 0;
      let dist = 0;
      let prev: [number, number] | null = null;
      while (run.s < 95) {
        t += 5_000;
        advanceRun(run, t);
        const p = run.course.paths.get('main')!;
        const k = Math.min(p.n - 1, Math.max(0, Math.round(run.s / (p.length / (p.n - 1)))));
        const h = p.heading[k];
        const pos: [number, number] = [p.px[k] - Math.sin(h) * run.x, p.pz[k] + Math.cos(h) * run.x];
        if (run.s >= 40 && run.s <= 90) {
          if (tIn === 0) tIn = run.simUs;
          if (prev) dist += Math.hypot(pos[0] - prev[0], pos[1] - prev[1]);
          prev = pos;
        }
      }
      times[name] = run.simUs - tIn;
      dists[name] = dist;
    }
    expect(dists.inside).toBeLessThan(dists.outside);
    expect(times.inside).toBeLessThan(times.outside);
  });

  test('取得・加点のあとにコース外へ落ちると、直前の復帰地点へ戻り、時計は進み、取得物と確定点は残る', () => {
    const course = testCourse({
      edges: ['wall', 'drop'],
      objects: [
        { kind: 'food', id: 'f', path: 'main', u: 10, x: 0, h: 0.35 },
        { kind: 'checkpoint', id: 'cp', path: 'main', u: 40, x: 0 },
      ],
      sections: [
        { path: 'main', u0: 0, u1: 60, opp: 'A' },
        { path: 'main', u0: 60, u1: 400, opp: 'B' },
      ],
    });
    const run = newRun(course);
    runTo(run, 3_000_000, [...jumpFacts(2_000_000), ...dogSpinFacts(2_020_000)]);
    expect(run.consumed.f).toBe(true);
    const points = run.score.jumpPoints;
    expect(points).toBeGreaterThan(0);
    expect(run.score.streak).toBe(1);
    runTo(run, 8_000_000, steerFacts(4_800_000, 1));
    expect(count(run, 'fall')).toBe(1);
    const fall = run.events.find((e) => e.kind === 'fall')!;
    const respawn = run.events.find((e) => e.kind === 'respawn')!;
    expect(respawn.atUs - fall.atUs).toBe(FALL_US);
    expect(respawn.objId).toBe('cp');
    expect(run.consumed.f).toBe(true);
    expect(run.score.jumpPoints).toBe(points);
    expect(run.score.streak).toBe(0);
    expect(run.simUs).toBeGreaterThanOrEqual(8_000_000);
    expect(run.mode).toBe('ground');
  });

  test('坂: 同じ犬と入力で、上りは緩やかに減り、下りは緩やかに速くなる', () => {
    const course = testCourse({
      height: [
        { u: 0, v: 0 },
        { u: 60, v: 0 },
        { u: 120, v: 6 },
        { u: 180, v: 6 },
        { u: 260, v: 0 },
      ],
    });
    const run = newRun(course);
    const speeds: number[] = [];
    let t = 0;
    while (run.s < 255) {
      t += 100_000;
      advanceRun(run, t);
      speeds.push(run.baseSpeed);
    }
    const at = (s: number) => {
      const r = newRun(course);
      let tt = 0;
      while (r.s < s) advanceRun(r, (tt += 5_000));
      return r.baseSpeed;
    };
    const flat = at(55);
    const up = at(118);
    const down = at(255);
    expect(up).toBeLessThan(flat);
    expect(down).toBeGreaterThan(flat);
    // 緩やか: 0.1 秒ごとの変化は小さい。
    for (let i = 20; i < speeds.length; i++) expect(Math.abs(speeds[i] - speeds[i - 1])).toBeLessThan(0.3);
  });

  test('平地では同じ高さに跳び、踏切台からはより高く到達する', () => {
    const course = testCourse({ objects: [{ kind: 'kicker', id: 'k', path: 'main', u0: 80, u1: 84, x0: -1.2, x1: 1.2, height: 0.6 }] });
    const apex = (facts: ReturnType<typeof jumpFacts>, until: number) => {
      const run = newRun(course);
      let best = -Infinity;
      let t = 0;
      const pending = facts.slice();
      while (t < until) {
        t += 5_000;
        const batch = pending.filter((f) => f.atUs <= t);
        pending.splice(0, batch.length);
        advanceRun(run, t, batch);
        best = Math.max(best, run.y);
      }
      return best;
    };
    const a = apex(jumpFacts(3_000_000), 4_500_000);
    const b = apex(jumpFacts(3_500_000), 5_000_000);
    expect(a).toBeCloseTo(b, 6);
    const kicker = apex([], 12_000_000);
    expect(kicker).toBeGreaterThan(a + 1);
  });
});
