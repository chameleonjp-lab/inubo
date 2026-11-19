import { expect, test } from 'vitest';
import { FreeArena } from '../src/game/free-arena';

const floorUs = 1_142_857;

test('無操作なら床への接地で一度だけ0点を確定する', () => {
  const arena = new FreeArena(); arena.jump(); arena.advance(floorUs - 1);
  expect(arena.phase).toBe('air'); expect(arena.result).toBeNull();
  arena.advance(floorUs);
  expect(arena.phase).toBe('done');
  expect(arena.result).toMatchObject({ landing: 'landed', points: 0, cutoffUs: floorUs });
  const result = arena.result;
  arena.advance(2_000_000);
  expect(arena.result).toBe(result);
});

test.each(['common', 'dog', 'rider'] as const)('%s の縦回転は傾いたままでも採点する', target => {
  const arena = new FreeArena(); arena.jump();
  arena.advance(2_000_000, [{ seq: 1, atUs: 0, target, rotation: [0, 0, 0.35] }]);
  expect(arena.result).toMatchObject({ landing: 'landed', cutoffUs: floorUs, label: expect.stringContaining('バックフリップ') });
  expect(arena.result?.points).toBeGreaterThan(0);
});

test('壁が先なら技を得点に加えない', () => {
  const arena = new FreeArena('wall'); arena.jump(true);
  arena.advance(2_000_000, [{ seq: 1, atUs: 0, target: 'common', rotation: [0, 1, 0] }]);
  expect(arena.result).toMatchObject({ landing: 'blocked', points: 0, surface: 'wall' });
  expect(arena.result!.cutoffUs).toBeLessThan(1_836_735);
});

test('接地と同時または後の入力を得点に含めない', () => {
  const arena = new FreeArena(); arena.jump(); arena.advance(2_000_000, [
    { seq: 1, atUs: floorUs, target: 'common', rotation: [0, 3, 0] },
    { seq: 2, atUs: floorUs + 20_000, target: 'dog', rotation: [0, 3, 0] },
  ]);
  expect(arena.result).toMatchObject({ landing: 'landed', points: 0 });
  expect(arena.motion.history.at(-1)?.endUs).toBe(floorUs);
});

test('8/16/33msの描画間隔で着地時刻・姿勢・点が一致する', () => {
  const run = (step: number) => {
    const arena = new FreeArena(); arena.jump();
    arena.advance(0, [{ seq: 1, atUs: 21_234, target: 'common', rotation: [0, 1, 0] }]);
    for (let t = step; t < 2_000_000; t += step) arena.advance(t);
    arena.advance(2_000_000); return { result: arena.result, pose: arena.motion.pose };
  };
  expect(run(8_000)).toEqual(run(16_000));
  expect(run(16_000)).toEqual(run(33_000));
});
