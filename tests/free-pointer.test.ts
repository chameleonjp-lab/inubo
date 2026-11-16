import { expect, test } from 'vitest';
import { FreePointerController } from '../src/input/free-pointer';

test('未完成のスワイプでも離す前に回転入力を送り、押す・離すだけでは入力を足さない', () => {
  const p = new FreePointerController(); p.setSurface(200, 200);
  expect(p.down(1, 100, 100, 'common')).toBe(true);
  const first = p.move(1, 120, 100, 12_345);
  expect(first.length).toBeGreaterThan(0);
  expect(first.every(i => i.atUs === 12_345 && i.rotation[1] > 0)).toBe(true);
  p.up(1);
  expect(p.move(1, 160, 100, 20_000)).toEqual([]);
});

test('同じ軌跡の細分は入力回数の倍率にならない', () => {
  const sum = (parts: number) => {
    const p = new FreePointerController(); p.setSurface(200, 200); p.down(1, 100, 100, 'dog');
    let y = 0;
    for (let n = 1; n <= parts; n++) for (const i of p.move(1, 100 + n * 40 / parts, 100, 0)) y += i.rotation[1];
    return y;
  };
  expect(sum(1)).toBeCloseTo(sum(16), 10);
});

test('反対側へ横切る入力は途中を通り、軸が非数にならない', () => {
  const p = new FreePointerController(); p.setSurface(200, 200); p.down(1, 10, 100, 'dog');
  const inputs = p.move(1, 190, 100, 0);
  expect(inputs.length).toBeGreaterThan(10);
  expect(inputs.flatMap(i => i.rotation).every(Number.isFinite)).toBe(true);
  expect(inputs.reduce((sum, i) => sum + i.rotation[1], 0)).toBeCloseTo(Math.PI, 8);
});

test('操作対象は指ごとに固定し、同じ身体を二重に操作させない', () => {
  const p = new FreePointerController(); p.setSurface(200, 200);
  expect(p.down(1, 100, 100, 'dog')).toBe(true);
  expect(p.down(2, 100, 100, 'common')).toBe(false);
  expect(p.down(2, 100, 100, 'rider')).toBe(true);
  expect(p.move(1, 130, 100, 0).every(i => i.target === 'dog')).toBe(true);
  p.cancel(1); p.cancel(1); // pointercancelとlostpointercaptureが重なっても閉じる。
  expect(p.down(3, 100, 100, 'dog')).toBe(true);
  p.clear();
  expect(p.activeCount).toBe(0);
  expect(p.move(2, 160, 100, 1)).toEqual([]);
});
