import { expect, test } from 'vitest';
import { DEG, type Vec3 } from '../src/game/math';
import { createFreeMotion, advanceFreeMotion } from '../src/game/free-motion';
import { scoreFreeMotion } from '../src/game/free-score';

function motion(deg: number, axis: Vec3 = [0, 1, 0], target: 'common' | 'dog' = 'dog') {
  const duration = 2.4;
  const integral = 0.875 / (Math.log(2) / 0.8);
  const n = Math.hypot(...axis);
  const s = createFreeMotion();
  s.omega[target] = axis.map(x => deg * DEG / integral * x / n) as Vec3;
  advanceFreeMotion(s, duration * 1e6);
  return s;
}

for (const axis of [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0.01, 0]] as Vec3[]) {
  test(`任意軸${axis}の360度は実運動から犬100点`, () => {
    expect(scoreFreeMotion(motion(360, axis).history, 'normal').points).toBe(100);
  });
}
test('最終姿勢が同じでも720度は200点で、履歴を捨てない', () => {
  expect(scoreFreeMotion(motion(720).history, 'normal').points).toBe(200);
});
test('最高速で共通と個別の回転を重ねても、着地までの周回を数える', () => {
  const s = createFreeMotion();
  advanceFreeMotion(s, 250_000, [
    { seq: 1, atUs: 0, target: 'common', rotation: [0, Math.PI, 0] },
    { seq: 2, atUs: 0, target: 'dog', rotation: [0, Math.PI, 0] },
  ]);
  // 0.25秒の実回転は犬が約1,295度、人が約647度。
  expect(scoreFreeMotion(s.history, 'clean')).toMatchObject({ dogDegrees: 1_260, riderDegrees: 630, points: 734 });
});
test('未知の225度同士にも名前に依存せず156点を付ける', () => {
  const scored = scoreFreeMotion(motion(225, [0, 1, 0], 'common').history, 'normal');
  expect(scored.points).toBe(156);
  expect(scored.label).toBe('フリースタイル');
});
test('小さな動きの着地成功は0点で、失敗は予定値を加算しない', () => {
  expect(scoreFreeMotion(motion(17).history, 'normal').points).toBe(0);
  const crashed = scoreFreeMotion(motion(720).history, 'crash');
  expect(crashed.base).toBe(200);
  expect(crashed.points).toBe(0);
  expect(crashed.eligible).toBe(false);
});
test('きれいな着地の倍率は最後に切り捨てる', () => {
  expect(scoreFreeMotion(motion(225, [0, 1, 0], 'common').history, 'clean').points).toBe(187);
});
