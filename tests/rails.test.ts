import { describe, expect, test } from 'vitest';
import { railPoints } from '../src/game/rails';
import { advanceRun, forceFall } from '../src/game/run';
import { eventsOf, jumpFacts, newRun, runTo, testCourse } from './helpers';
import type { GestureFact, SimState } from '../src/game/types';

/** 手すりに乗るまで進め、乗った時刻を返す。 */
function untilMounted(run: SimState, railId: string, maxUs = 20_000_000): number {
  let t = run.simUs;
  while (t < maxUs) {
    advanceRun(run, (t += 5_000));
    const on = run.events.filter((e) => e.kind === 'railOn' && e.objId === railId);
    if (on.length > 0 && run.rail?.railId === railId) return on[on.length - 1].atUs;
  }
  throw new Error('rail not mounted');
}

function railJumpOff(atUs: number): GestureFact[] {
  return jumpFacts(atUs);
}

describe('V09 手すり', () => {
  test('滑った距離の整数メートル × 10 点、1 本 100 点まで（7.99／8.00／12m → 70／80／100）', () => {
    expect(railPoints(7_990)).toBe(70);
    expect(railPoints(8_000)).toBe(80);
    expect(railPoints(12_000)).toBe(100);
    expect(railPoints(0)).toBe(0);
  });

  for (const [meters, expected] of [
    [7.99, 70],
    [8.0, 80],
    [12, 100],
  ] as const) {
    test(`走行の中で ${meters}m 滑って通常に着地すると ${expected} 点（着地の倍率は掛けない）`, () => {
      const course = testCourse({ objects: [{ kind: 'rail', id: 'A', path: 'main', u0: 40, u1: 70, x: 0, h0: 0.6, h1: 0.6 }] });
      const run = newRun(course);
      let t = 0;
      while (run.s < 33) advanceRun(run, (t += 5_000));
      advanceRun(run, (t += 5_000), jumpFacts(t - 5_000));
      const mountUs = untilMounted(run, 'A');
      const offUs = mountUs + Math.round(meters * 100_000);
      runTo(run, offUs + 2_000_000, railJumpOff(offUs), 5_000);
      const score = eventsOf(run, 'railScore')[0];
      expect(score.data).toMatchObject({ railId: 'A', points: expected });
      expect(run.score.railPoints).toBe(expected);
    });
  }

  test('A を 8m → 体の横技 → B の上に通常着地 → B を 4m で落下 → A を再訪: A の 80＋体技 150 だけが残り、B は 0、A の再確定は 0', () => {
    const course = testCourse({
      objects: [
        { kind: 'checkpoint', id: 'cp', path: 'main', u: 25, x: 0 },
        { kind: 'rail', id: 'A', path: 'main', u0: 40, u1: 50, x: 0, h0: 0.6, h1: 0.6 },
        { kind: 'rail', id: 'B', path: 'main', u0: 54, u1: 80, x: 0, h0: 0.6, h1: 0.6 },
      ],
    });
    const run = newRun(course);
    let t = 0;
    while (run.s < 33) advanceRun(run, (t += 5_000));
    advanceRun(run, (t += 5_000), jumpFacts(t - 5_000));
    const mountA = untilMounted(run, 'A');
    const off = mountA + 800_000;
    // 手すり A から前へ跳び、右ひねりを「通常着地」になる時刻に入れる（着地時の残り約 20 度）。
    runTo(
      run,
      off + 5_000,
      [
        ...railJumpOff(off),
        { kind: 'down', atUs: off + 200_000, strokeId: 4242 },
        { kind: 'line', atUs: off + 261_000, strokeId: 4242, dir8: 2, afterCircle: false },
        { kind: 'up', atUs: off + 261_000, strokeId: 4242, cancelled: false },
      ],
      5_000,
    );
    const mountB = untilMounted(run, 'B');
    expect(run.score.railPoints).toBe(80);
    expect(run.score.jumpPoints).toBe(150);
    expect(run.score.jumps[0]).toMatchObject({ names: ['右ひねり'], tenths: 10, points: 150 });
    // A の点と空中技が、B の保留より先に確定している。
    const kinds = run.events.filter((e) => e.atUs >= mountB - 1 && ['railScore', 'land', 'railOn'].includes(e.kind)).map((e) => e.kind);
    expect(kinds.slice(0, 3)).toEqual(['railScore', 'land', 'railOn']);
    runTo(run, mountB + 400_000, [], 5_000);
    forceFall(run, run.simUs);
    expect(eventsOf(run, 'railLost').map((e) => e.data?.railId)).toEqual(['B']);
    // 復帰して A を再訪する。
    let tt = run.simUs;
    // 復帰直後は発進し直すので遅い。少し近づいてから跳ぶ。
    while (run.mode !== 'ground' || run.s < 35.5) advanceRun(run, (tt += 5_000));
    advanceRun(run, (tt += 5_000), jumpFacts(tt - 5_000));
    untilMounted(run, 'A');
    runTo(run, run.simUs + 2_500_000, [], 5_000);
    const again = eventsOf(run, 'railScore').filter((e) => e.data?.railId === 'A');
    expect(again.length).toBe(2);
    expect(again[1].data).toMatchObject({ points: 0, already: true });
    expect(run.score.railPoints).toBe(80);
    expect(run.score.jumpPoints).toBe(150);
    expect(run.score.scoredRails.B).toBeUndefined();
  });

  test('手すりの側面にぶつかると前進は止まり、上から乗ると滑る（最初に触れた時刻で上面と側面を区別）', () => {
    const course = testCourse({ objects: [{ kind: 'rail', id: 'A', path: 'main', u0: 40, u1: 70, x: 1.5, h0: 0.6, h1: 0.6 }] });
    const side = newRun(course);
    let t = 0;
    while (side.s < 45) advanceRun(side, (t += 5_000));
    // 手すりの横を走りながら、手すりの方へ寄る。
    advanceRun(side, (t += 5_000), [
      { kind: 'down', atUs: t - 5_000, strokeId: 1 },
      { kind: 'steer', atUs: t - 5_000, strokeId: 1, dx: 0.3 },
      { kind: 'up', atUs: t - 4_999, strokeId: 1, cancelled: false },
    ]);
    runTo(side, t + 2_000_000, [], 5_000);
    expect(side.blocked).toMatchObject({ solidId: 'A', face: 'side' });
    expect(side.forwardSpeed).toBe(0);
    expect(eventsOf(side, 'collide').length).toBe(1);
  });
});
