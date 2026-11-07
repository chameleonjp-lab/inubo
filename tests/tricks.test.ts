import { describe, expect, test } from 'vitest';
import { footTiltDeg, landingTenths, resolveTricks, scoreJump, type Candidate, type StrokeInfo } from '../src/game/tricks';
import { DOG_SPIN_US, BODY_ROT_US } from '../src/game/rules';
import { bodyFacts, dogSpinFacts, jumpFacts, newRun, runTo, testCourse } from './helpers';

const dog = (strokeId: number, t: number, vertical = false, clockwise = true): Candidate => ({ kind: 'dog', strokeId, establishedUs: t, vertical, clockwise });
const body = (strokeId: number, t: number, dir8: number, afterCircle = false): Candidate => ({ kind: 'body', strokeId, establishedUs: t, dir8, afterCircle });
const stroke = (strokeId: number, downUs: number, upUs: number | null, candidates: Candidate[], cancelled = false): StrokeInfo => ({ strokeId, downUs, upUs, cancelled, candidates });

describe('V06 2本指と片手の複合', () => {
  test('2本の指: 直線 80ms／閉円 180ms とその逆で、どちらも 180ms から両方が同時に回り、複合 100 点は1回', () => {
    const a = resolveTricks([stroke(1, 0, 200_000, [dog(1, 180_000)]), stroke(2, 0, 80_000, [body(2, 80_000, 2)])], 1_000_000);
    const b = resolveTricks([stroke(1, 0, 80_000, [dog(1, 80_000)]), stroke(2, 0, 180_000, [body(2, 180_000, 2)])], 1_000_000);
    for (const r of [a, b]) {
      expect(r.rotations.map((x) => x.startUs)).toEqual([180_000, 180_000]);
      expect(r.composite).toBe(true);
      const js = scoreJump(r, 2_000_000, 0, 0);
      expect(js.base).toBe(250);
      expect(js.points).toBe(Math.round((250 + 100) * 1.2));
    }
    // 認識の順を入れ替えても同じ結果。
    const c = resolveTricks([stroke(2, 0, 80_000, [body(2, 80_000, 2)]), stroke(1, 0, 200_000, [dog(1, 180_000)])], 1_000_000);
    expect(c.rotations.map((x) => [x.channel, x.startUs]).sort()).toEqual(a.rotations.map((x) => [x.channel, x.startUs]).sort());
    expect(c.composite).toBe(a.composite);
  });

  test('相方の成立待ちの間は、先に成立した側を回さない', () => {
    const mid = resolveTricks([stroke(1, 0, null, [dog(1, 80_000)]), stroke(2, 0, null, [])], 120_000);
    expect(mid.rotations.length).toBe(0);
    expect(mid.held.length).toBe(1);
  });

  test('片手: 円の閉点から犬が回り、線を回転完了の 1µs 前・同時・1µs 後に離すと、複合の加点は 100／0／0', () => {
    const t0 = 200_000;
    const results = [-1, 0, 1].map((d) => {
      const tLine = t0 + DOG_SPIN_US + d;
      const r = resolveTricks([stroke(1, 100_000, tLine, [dog(1, t0), body(1, tLine, 2, true)])], 2_000_000);
      expect(r.rotations[0].startUs).toBe(t0);
      expect(r.rotations[1].startUs).toBe(tLine);
      const js = scoreJump(r, 3_000_000, 0, 0);
      return js.composite ? 100 : 0;
    });
    expect(results).toEqual([100, 0, 0]);
  });

  test('片方を取り消すと、その成分は 0。残った有効な単独技を、取り消した時に一度だけ始める', () => {
    const r = resolveTricks([stroke(1, 0, 300_000, [dog(1, 80_000)]), stroke(2, 0, 120_000, [], true)], 1_000_000);
    expect(r.rotations.length).toBe(1);
    expect(r.rotations[0]).toMatchObject({ channel: 'dog', startUs: 120_000 });
    expect(r.composite).toBe(false);
  });

  test('着地までに始められなかった候補は捨てる', () => {
    const r = resolveTricks([stroke(1, 0, null, [dog(1, 80_000)]), stroke(2, 0, null, [])], 500_000, 400_000);
    expect(r.rotations.length).toBe(0);
    const js = scoreJump(r, 400_000, 0, 0);
    expect(js.base).toBe(0);
  });

  test('走行の中でも、片手と2本指で同じ技名・配点・回転枠になる', () => {
    const course = testCourse({ objects: [{ kind: 'kicker', id: 'k', path: 'main', u0: 60, u1: 64, x0: -1.2, x1: 1.2, height: 0.6 }] });
    const runOne = newRun(course);
    const runTwo = newRun(course);
    runTo(runOne, 4_000_000);
    runTo(runTwo, 4_000_000);
    const takeoff = (r: typeof runOne) => {
      let t = r.simUs;
      while (r.mode !== 'air') runTo(r, (t += 5_000));
      return r.jump!.takeoffUs;
    };
    const ta = takeoff(runOne);
    const tb = takeoff(runTwo);
    runTo(runOne, ta + 1_600_000, [
      { kind: 'down', atUs: ta + 60_000, strokeId: 9001 },
      { kind: 'circle', atUs: ta + 210_000, strokeId: 9001, vertical: false, clockwise: true, aspect: 1 },
      { kind: 'line', atUs: ta + 300_000, strokeId: 9001, dir8: 2, afterCircle: true },
      { kind: 'up', atUs: ta + 300_000, strokeId: 9001, cancelled: false },
    ]);
    runTo(runTwo, tb + 1_600_000, [
      { kind: 'down', atUs: tb + 60_000, strokeId: 9101 },
      { kind: 'down', atUs: tb + 60_000, strokeId: 9102 },
      { kind: 'line', atUs: tb + 120_000, strokeId: 9102, dir8: 2, afterCircle: false },
      { kind: 'up', atUs: tb + 120_000, strokeId: 9102, cancelled: false },
      { kind: 'circle', atUs: tb + 210_000, strokeId: 9101, vertical: false, clockwise: true, aspect: 1 },
      { kind: 'up', atUs: tb + 220_000, strokeId: 9101, cancelled: false },
    ]);
    const j1 = runOne.score.jumps[0];
    const j2 = runTwo.score.jumps[0];
    expect(j1.names).toEqual(j2.names);
    expect(j1.composite).toBe(true);
    expect(j2.composite).toBe(true);
    expect(j1.points).toBe(j2.points);
    expect(j1.points).toBe(420);
  });
});

describe('V07 回転枠', () => {
  test('犬 2 周は 200 基礎点、犬 1＋斜めの体 1 は複合込み 400、3 回目の入力は 0', () => {
    const two = resolveTricks([stroke(1, 0, 500_000, [dog(1, 100_000), dog(1, 300_000)])], 2_000_000);
    expect(scoreJump(two, 3_000_000, 0, 0).base).toBe(200);
    expect(two.composite).toBe(false);
    expect(two.rotations[1].startUs).toBe(100_000 + DOG_SPIN_US);

    const mixed = resolveTricks([stroke(1, 0, 400_000, [dog(1, 100_000)]), stroke(2, 0, 100_000, [body(2, 100_000, 1)])], 2_000_000);
    const js = scoreJump(mixed, 3_000_000, 0, 0);
    expect(js.base + (js.composite ? 100 : 0)).toBe(400);

    const third = resolveTricks(
      [stroke(1, 0, 400_000, [dog(1, 100_000)]), stroke(2, 0, 100_000, [body(2, 100_000, 1)]), stroke(3, 200_000, 250_000, [body(3, 250_000, 0)])],
      2_000_000,
    );
    expect(third.rotations.length).toBe(2);
    expect(third.rejected.length).toBe(1);
    const js3 = scoreJump(third, 3_000_000, 0, 0);
    expect(js3.base + (js3.composite ? 100 : 0)).toBe(400);
  });

  test('離陸直後の姿勢（0 度）を、回り切った姿勢と誤認しない', () => {
    const r = resolveTricks([stroke(1, 0, 100_000, [dog(1, 100_000)])], 1_000_000);
    const atStart = scoreJump(r, 100_000, 0, 0);
    const done = scoreJump(r, 100_000 + DOG_SPIN_US, 0, 0);
    expect(atStart.tiltDeg).toBeCloseTo(0, 6);
    expect(atStart.residualDeg).toBe(360);
    expect(atStart.tenths).toBe(0);
    expect(done.residualDeg).toBe(0);
    expect(done.tenths).toBe(12);
  });
});

describe('V08 着地', () => {
  test('回転の残りと足の傾きの大きい方が 10／10.1／30／30.1 度で、1.2／1／1／0 倍', () => {
    expect(landingTenths(10, 0)).toBe(12);
    expect(landingTenths(0, 10)).toBe(12);
    expect(landingTenths(10.1, 3)).toBe(10);
    expect(landingTenths(2, 30)).toBe(10);
    expect(landingTenths(30.1, 0)).toBe(0);
    expect(landingTenths(0, 30.1)).toBe(0);
  });

  for (const [name, pitch] of [
    ['斜面', Math.atan(-0.12)],
    ['手すりの上', Math.atan(-0.17)],
  ] as const) {
    test(`${name}: 予定の回転の残りが 10／10.1／30／30.1 度で 1.2／1／1／0 倍（足の傾きは着地面に対して測る）`, () => {
      const r = resolveTricks([stroke(1, 0, 0, [dog(1, 0, true, true)])], 1_000_000);
      const at = (residual: number) => Math.round(((360 - residual) / 360) * DOG_SPIN_US * 1000) / 1000;
      const tenths = [10, 10.1, 30, 30.1].map((res) => {
        const t = at(res);
        const tilt = footTiltDeg(r.rotations, t, pitch, pitch);
        expect(tilt).toBeCloseTo(res, 2);
        return scoreJump(r, t, pitch, pitch).tenths;
      });
      expect(tenths).toEqual([12, 10, 10, 0]);
    });
  }

  test('ひねりだけの残りは足を傾けないが、残りの角度として検査する（斜め技のひねり）', () => {
    const r = resolveTricks([stroke(1, 0, 0, [body(1, 0, 2)])], 1_000_000);
    const t = (330 / 360) * BODY_ROT_US;
    expect(footTiltDeg(r.rotations, t, 0, 0)).toBeCloseTo(0, 6);
    expect(scoreJump(r, t, 0, 0).tenths).toBe(10);
    expect(scoreJump(r, (329 / 360) * BODY_ROT_US, 0, 0).tenths).toBe(0);
  });

  test('犬＋左右の体技の「ぴたり」は 420 点', () => {
    const r = resolveTricks([stroke(1, 0, 0, [dog(1, 0)]), stroke(2, 0, 0, [body(2, 0, 6)])], 1_000_000);
    expect(scoreJump(r, 2_000_000, 0, 0).points).toBe(420);
  });

  test('走行の中で、坂への着地も「ぴたり」になる（基本姿勢を着地面へそろえる）', () => {
    const course = testCourse({
      height: [
        { u: 0, v: 8 },
        { u: 60, v: 8 },
        { u: 140, v: 0 },
      ],
    });
    const run = newRun(course);
    runTo(run, 7_000_000);
    expect(run.s).toBeGreaterThan(62);
    const t = run.simUs;
    runTo(run, t + 2_000_000, [...jumpFacts(t), ...dogSpinFacts(t + 20_000)]);
    expect(run.score.jumps[0].tenths).toBe(12);
    void bodyFacts;
  });
});
