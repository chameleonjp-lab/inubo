import { expect, test } from 'vitest';
import { DEG, quatAxisAngle } from '../src/game/math';
import { advanceFreeMotion, createFreeMotion, type FreeMotionInput } from '../src/game/free-motion';

const impulse = (seq: number, atUs: number, y: number, target: 'common' | 'dog' | 'rider' = 'common'): FreeMotionInput =>
  ({ seq, atUs, target, rotation: [0, y * DEG, 0] });

test('指離し後も慣性が残り、0.8秒で速度半減・約207.75度進む', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 0, [impulse(1, 0, 90)]);
  expect(s.pose.dog.q).toEqual([0, 0, 0, 1]); // 入力時刻に姿勢を瞬間移動しない。
  advanceFreeMotion(s, 800_000);
  expect(s.omega.common[1] / DEG).toBeCloseTo(180, 7);
  const expected = quatAxisAngle([0, 1, 0], 207.748085888 * DEG);
  s.pose.dog.q.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 7));
});

test('逆スワイプは減速、停止、逆転を起こし、姿勢は入力だけで飛ばない', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 0, [impulse(1, 0, 90), impulse(2, 0, -45)]);
  expect(s.omega.common[1] / DEG).toBeCloseTo(180);
  advanceFreeMotion(s, 0, [impulse(3, 0, -45)]);
  expect(s.omega.common[1]).toBeCloseTo(0);
  advanceFreeMotion(s, 0, [impulse(4, 0, -15)]);
  expect(s.omega.common[1] / DEG).toBeCloseTo(-60);
  expect(s.pose.dog.q).toEqual([0, 0, 0, 1]);
});

test('同じ入力を細分しても勢いを重複増幅せず、再送も二重適用しない', () => {
  const a = createFreeMotion(); const b = createFreeMotion();
  const inputs = Array.from({ length: 6 }, (_, i) => impulse(i + 1, 0, 15));
  advanceFreeMotion(a, 0, [impulse(1, 0, 90)]);
  advanceFreeMotion(b, 0, inputs); advanceFreeMotion(b, 0, inputs);
  expect(b.omega.common[1]).toBeCloseTo(a.omega.common[1], 12);
});

test('犬だけの勢いは人へ混ぜず、一緒の勢いも対象切替で消さない', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 0, [impulse(1, 0, 30), impulse(2, 0, 60, 'dog')]);
  advanceFreeMotion(s, 100_000);
  expect(s.pose.rider.q).not.toEqual(s.pose.dog.q);
  expect(s.omega.common[1]).toBeGreaterThan(0);
  expect(s.omega.dog[1]).toBeGreaterThan(s.omega.common[1]);
  expect(s.omega.rider).toEqual([0, 0, 0]);
});

test('各成分は720度毎秒を上限とし、非数や過去の入力を受け付けない', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 0, [impulse(1, 0, 1_000)]);
  expect(s.omega.common[1] / DEG).toBeCloseTo(720);
  expect(() => advanceFreeMotion(s, 5_000, [{ seq: 2, atUs: 0, target: 'dog', rotation: [NaN, 0, 0] }])).toThrow();
  advanceFreeMotion(s, 10_000);
  expect(() => advanceFreeMotion(s, 15_000, [impulse(3, 1, 1)])).toThrow();
});

test('一緒の回転は支点の周囲で位置も回し、犬だけでは人の位置を動かさない', () => {
  const s = createFreeMotion();
  const rider = [...s.pose.rider.p];
  advanceFreeMotion(s, 0, [{ seq: 1, atUs: 0, target: 'dog', rotation: [90 * DEG, 0, 0] }]);
  advanceFreeMotion(s, 100_000);
  expect(s.pose.rider.p).toEqual(rider);
  advanceFreeMotion(s, 100_000, [{ seq: 2, atUs: 100_000, target: 'common', rotation: [90 * DEG, 0, 0] }]);
  advanceFreeMotion(s, 200_000);
  expect(s.pose.rider.p).not.toEqual(rider);
});

test('描画8/16/33msでも同じ入力・実運動・得点元になる', () => {
  const inputs = [impulse(1, 0, 60), impulse(2, 123_456, -20, 'dog'), impulse(3, 245_678, 15, 'rider')];
  const run = (step: number) => {
    const s = createFreeMotion();
    advanceFreeMotion(s, 0, inputs);
    for (let t = step; t < 800_000; t += step) advanceFreeMotion(s, t);
    advanceFreeMotion(s, 800_000);
    return s;
  };
  const expected = run(8_000);
  for (const step of [16_000, 33_000]) {
    const s = run(step);
    expect(s.pose).toEqual(expected.pose);
    expect(s.history).toEqual(expected.history);
    expect(s.omega).toEqual(expected.omega);
  }
});

test('回転途中の接地で履歴を閉じ、同時刻や後の入力で救済しない', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 50_000, [impulse(1, 0, 90), impulse(2, 12_345, -90)],
    span => span.endUs >= 12_345 ? 12_345 : null);
  expect(s.timeUs).toBe(12_345);
  expect(s.halted).toBe(true);
  expect(s.history.at(-1)?.endUs).toBe(12_345);
  expect(s.omega.common[1]).toBeGreaterThan(0); // 接地と同時の逆入力は未適用。
  const before = JSON.stringify(s.pose);
  advanceFreeMotion(s, 1_000_000);
  expect(JSON.stringify(s.pose)).toBe(before);
});
