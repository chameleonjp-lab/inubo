import { expect, test } from 'vitest';
import { DEG } from '../src/game/math';
import { FreeArena } from '../src/game/free-arena';

test('無操作の跳躍は床へ着地し、150ms・0.2mの確認後に0点を一度だけ確定する', () => {
  const a = new FreeArena(); a.jump(); a.advance(1_250_000);
  expect(a.phase).toBe('settling'); expect(a.result).toBeNull();
  const cutoff = a.cutoffUs!;
  a.advance(1_600_000);
  expect(a.phase).toBe('done'); expect(a.result?.points).toBe(0);
  expect(a.result?.landing).toBe('clean'); expect(a.result?.cutoffUs).toBe(cutoff);
  const result = a.result; a.advance(2_000_000); expect(a.result).toBe(result);
});
test('水平の未知の回転は成立し、最初の接触後の入力を空中得点に足さない', () => {
  const a = new FreeArena(); a.jump();
  a.advance(1_250_000, [{ seq: 1, atUs: 0, target: 'common', rotation: [0, 55 * DEG, 0] }]);
  expect(a.phase).toBe('settling');
  const history = a.airHistory;
  a.advance(1_600_000, [{ seq: 2, atUs: 1_300_000, target: 'common', rotation: [0, -20 * DEG, 0] }]);
  expect(a.result!.points).toBeGreaterThan(0);
  expect(a.result!.label).toBe('フリースタイル'); expect(a.airHistory).toBe(history);
  expect(a.airHistory.at(-1)!.endUs).toBe(a.cutoffUs);
});
test('途中の壁接触は床への着地より先に失敗として閉じる', () => {
  const a = new FreeArena('wall'); a.jump(true); a.advance(2_000_000);
  expect(a.result?.landing).toBe('crash'); expect(a.result?.surface).toBe('wall');
  expect(a.result!.cutoffUs).toBeLessThan(1_500_000);
});
test('床に触れた後でも、安定確認中に壁へ当たれば得点を確定しない', () => {
  const a = new FreeArena('wall'); a.jump(); a.advance(2_000_000);
  expect(a.result?.landing).toBe('crash'); expect(a.result?.reason).toContain('障害物');
});
test('接触より後に予約済みの入力は、空中履歴へ混ぜず地上へ引き継ぐ', () => {
  const a = new FreeArena(); a.jump();
  a.advance(0, [{ seq: 1, atUs: 1_200_000, target: 'common', rotation: [0, 0.2, 0] }]);
  a.advance(1_250_000);
  expect(a.phase).toBe('settling'); expect(a.motion.omega.common[1]).toBeGreaterThan(0);
  expect(a.airHistory.every(s => s.from.omega.common[1] === 0)).toBe(true);
});
test('頭から落ちる姿勢を正しい向きに自動整列しない', () => {
  const a = new FreeArena(); a.jump();
  a.advance(2_000_000, [{ seq: 1, atUs: 0, target: 'common', rotation: [0, 0, 58 * DEG] }]);
  expect(a.result?.landing).toBe('crash'); expect(a.result?.points).toBe(0);
});
test('8/16/33msの描画間隔で着地時刻・姿勢・点が一致する', () => {
  const run = (step: number) => {
    const a = new FreeArena(); a.jump();
    a.advance(0, [{ seq: 1, atUs: 21_234, target: 'common', rotation: [0, 1, 0] }]);
    for (let t = step; t < 2_000_000; t += step) a.advance(t);
    a.advance(2_000_000); return { result: a.result, pose: a.motion.pose };
  };
  expect(run(8_000)).toEqual(run(16_000)); expect(run(16_000)).toEqual(run(33_000));
});
test('確認中の再ジャンプは直前の未確定点を0点で閉じ、次の試行へ混ぜない', () => {
  const a = new FreeArena(); a.jump(); a.advance(1_250_000);
  expect(a.phase).toBe('settling'); a.jump();
  expect(a.previousResult?.landing).toBe('crash'); expect(a.previousResult?.points).toBe(0);
  expect(a.phase).toBe('air'); expect(a.cutoffUs).toBeNull(); expect(a.airHistory).toEqual([]);
});
