import { expect, test } from 'vitest';
import { DEG, type Vec3 } from '../src/game/math';
import { createFreeMotion, advanceFreeMotion, rotationTime, type FreeTarget } from '../src/game/free-motion';
import { scoreFreeMotion } from '../src/game/free-score';
import { COMBO_TRICKS, PAIR_TRICKS, SINGLE_TRICKS, matchFreeTrick } from '../src/game/free-trick-catalog';

const airtime = 800_000;
function score(degrees: number, axis: Vec3, target: FreeTarget = 'dog', heading = 0) {
  const state = createFreeMotion();
  // 入力で各回転を維持した場合の実角度を、並走する2成分に分けて再現する。
  for (let at = 0; at < airtime; at += 5_000) {
    const speed = degrees * DEG * 5_000 / airtime / rotationTime(5_000);
    if (speed > 3_600 * DEG) {
      state.omega.common = axis.map(value => value * speed / 2) as Vec3;
      state.omega[target] = [...state.omega.common];
    } else {
      state.omega[target] = axis.map(value => value * speed) as Vec3;
    }
    advanceFreeMotion(state, at + 5_000);
  }
  return scoreFreeMotion(state.history, airtime, heading);
}

test.each([['common', '犬と人'], ['dog', '犬'], ['rider', '人']] as const)('%s の1回転は同じ61点', (target, label) => {
  expect(score(360, [0, 1, 0], target)).toMatchObject({ points: 61, tier: 1, label: expect.stringContaining(label + 'の左スピン') });
});

test.each<[Vec3, string]>([
  [[0, 0, 1], 'バックフリップ'], [[0, 0, -1], 'フロントフリップ'],
  [[0, 1, 0], '左スピン'], [[0, -1, 0], '右スピン'],
  [[-1, 0, 0], '左バレルロール'], [[1, 0, 0], '右バレルロール'],
])('回転方向 %j に対応する名前を付ける', (axis, direction) => {
  expect(score(360, axis).label).toContain(direction);
});

test('道の方角が変わっても進行方向に対する技名を維持する', () => {
  expect(score(360, [-1, 0, 0], 'dog', Math.PI / 2).label).toContain('バックフリップ');
});

test('半回転から採点し、理論上限16回転の半回転手前を満点とする', () => {
  expect(score(179.99, [0, 1, 0]).points).toBe(0);
  expect(score(180, [0, 1, 0])).toMatchObject({ points: 30, label: '犬の左スピン「左寄せ肉球」・半回転' });
  expect(score(5_579.99, [0, 1, 0]).points).toBeLessThan(1_000);
  expect(score(5_580, [0, 1, 0])).toMatchObject({ points: 1_000, tier: 5, label: expect.stringContaining('15.5回転') });
});

test('半回転以上の異なる方向を組み合わせると加点し、装飾と技名も段階を上げる', () => {
  const state = createFreeMotion();
  const speed = 360 * DEG / rotationTime(400_000);
  state.omega.dog = [0, speed, 0];
  advanceFreeMotion(state, 400_000);
  state.omega.dog = [0, 0, speed];
  advanceFreeMotion(state, airtime);
  expect(scoreFreeMotion(state.history, airtime, 0)).toMatchObject({
    points: 132, label: '犬のしっぽ左月返し・2回転',
  });
  const increasing = [360, 1440, 2520, 3960, 5040].map(degrees => score(degrees, [0, 1, 0]));
  expect(increasing.map(item => item.tier)).toEqual([1, 2, 3, 4, 5]);
  expect(increasing.every((item, i) => i === 0 || item.label.length > increasing[i - 1].label.length)).toBe(true);
});

test('共通と犬の逆回転が打ち消し合った分は犬の角度に含めない', () => {
  const state = createFreeMotion();
  state.omega.common = [0, 360 * DEG / rotationTime(airtime), 0];
  state.omega.dog = [0, -state.omega.common[1], 0];
  advanceFreeMotion(state, airtime);
  expect(scoreFreeMotion(state.history, airtime, 0)).toMatchObject({ dogDegrees: 0, points: 61, label: '人の左スピン「左のハンドリング」・1回転' });
});

test('各対象の50パターンを実際の回転履歴から採点でき、技名150件がすべて異なる', () => {
  const axes: Vec3[] = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0]];
  const combinations = [
    { directions: [0, 2, 4], pattern: COMBO_TRICKS.threeAxes },
    { directions: [0, 1, 2], pattern: COMBO_TRICKS.flipReverse },
    { directions: [0, 2, 3], pattern: COMBO_TRICKS.spinReverse },
    { directions: [0, 4, 5], pattern: COMBO_TRICKS.rollReverse },
    { directions: [0, 1, 2, 3], pattern: COMBO_TRICKS.multiReverse },
  ];
  const patterns = [
    ...SINGLE_TRICKS.flatMap((entries, direction) => entries.map(pattern => ({ directions: [direction], pattern }))),
    ...PAIR_TRICKS.map(pattern => ({ directions: pattern.directions, pattern })),
    ...combinations,
  ];
  const activeNames = new Set<string>();
  expect(patterns).toHaveLength(50);

  for (const { directions, pattern } of patterns) {
    const scores = (['common', 'dog', 'rider'] as const).map((target, index) => {
      const state = createFreeMotion();
      const interval = Math.floor(airtime / directions.length / 5_000) * 5_000;
      const angle = pattern.minimumHalfTurns * 180 / directions.length;
      directions.forEach((direction, i) => {
        const speed = (angle + 0.01) * DEG / rotationTime(interval);
        state.omega[target] = axes[direction].map(value => value * speed) as Vec3;
        advanceFreeMotion(state, (i + 1) * interval);
      });
      state.omega[target] = [0, 0, 0];
      advanceFreeMotion(state, airtime);
      const result = scoreFreeMotion(state.history, airtime, 0);
      expect(result.label).toContain(pattern.names[index]);
      activeNames.add(pattern.names[index]);
      return result.points;
    });
    const multiplier = 1 + 0.08 * Math.min(directions.length - 1, 2);
    const expected = Math.floor(980 * pattern.minimumHalfTurns / 32 * multiplier);
    expect(scores).toEqual([expected, expected, expected]);
  }
  expect(activeNames.size).toBe(150);
});

test('全63通りの方向の組に技があり、方向を回した順番は判定に影響しない', () => {
  for (let mask = 1; mask < 64; mask++) {
    const directions = Array.from({ length: 6 }, (_, i) => i).filter(i => mask & (1 << i));
    const pattern = matchFreeTrick(directions, directions.length);
    expect(pattern).toBeDefined();
    expect(matchFreeTrick([...directions].reverse(), directions.length)).toBe(pattern);
  }
});
