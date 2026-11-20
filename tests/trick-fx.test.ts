import { expect, test } from 'vitest';
import { TRICK_FX_100, chooseTrickFx, trickFxTier } from '../src/view/trick-fx';
import { trickLandingText } from '../src/view/trick-landing';

test('5段階 × 空中の形5種 × 着地の形4種 = 100通り、番号は重複しない', () => {
  expect(TRICK_FX_100).toHaveLength(100);
  expect(new Set(TRICK_FX_100.map(fx => fx.id)).size).toBe(100);
  expect(new Set(TRICK_FX_100.map(fx => `${fx.tier}:${fx.motion}:${fx.burst}`)).size).toBe(100);
  expect(TRICK_FX_100.every(fx => fx.particleBudget <= 72)).toBe(true);
});
test('点数で演出の5段階が上がり、同じ技と点数なら同じ表現を選ぶ', () => {
  expect([0,1,199,200,399,400,649,650,849,850,2050].map(trickFxTier))
    .toEqual([1,1,1,2,2,3,3,4,4,5,5]);
  const variant=chooseTrickFx(970,'犬の左スピン');
  expect(chooseTrickFx(970,'犬の左スピン')).toEqual(variant);
  expect(variant.tier).toBe(5);
});
test('切替ボーナスを基礎点と分けて表示し、基礎点満点だけに回転満点を使う', () => {
  const combo=trickLandingText('連続技',1200,1200,false,{basePoints:650,switchBonus:550,switchCount:2});
  expect(combo).toMatchObject({name:'連続技',score:'＋1,200',full:false,switchBonus:550,switchCount:2});
  expect(combo.fx.tier).toBe(5);
  const full=trickLandingText('連続技',1500,1500,false,{basePoints:1000,switchBonus:500,switchCount:1});
  expect(full.full).toBe(true);
});
