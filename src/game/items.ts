import { FOOD_US, ITEM_REACH_X, POOP_REACH_X, BODY_HEIGHT, POOP_US } from './rules';
import type { Effects } from './types';
import type { ItemRt } from './track';

/**
 * ドッグフード（5秒・1.25倍）、犬の糞（2秒・0.60倍）、骨形の道しるべ。
 * 効果の開始時刻を含み、終了時刻ちょうどに元へ戻す。倍率は積み増さず、別の物を取ると残りを戻す。
 */

export function createEffects(): Effects {
  return { foodUntilUs: null, poopUntilUs: null };
}

export function foodActive(e: Effects, tUs: number): boolean {
  return e.foodUntilUs !== null && tUs < e.foodUntilUs;
}

export function poopActive(e: Effects, tUs: number): boolean {
  return e.poopUntilUs !== null && tUs < e.poopUntilUs;
}

/** 速度の倍率を 1/10000 の整数で返す（1.25×0.60 を誤差なく 0.75 にする）。 */
export function multiplierBp(e: Effects, tUs: number): number {
  return (foodActive(e, tUs) ? 125 : 100) * (poopActive(e, tUs) ? 60 : 100);
}

export function speedMultiplier(e: Effects, tUs: number): number {
  return multiplierBp(e, tUs) / 10_000;
}

/** (ta, tb) の中で最初に効果が切れる時刻。なければ null。 */
export function nextEffectEnd(e: Effects, ta: number, tb: number): number | null {
  let best: number | null = null;
  for (const end of [e.foodUntilUs, e.poopUntilUs]) {
    if (end !== null && end > ta && end < tb && (best === null || end < best)) best = end;
  }
  return best;
}

export function takeFood(e: Effects, tUs: number): void {
  e.foodUntilUs = tUs + FOOD_US;
}

export function stepPoop(e: Effects, tUs: number): void {
  e.poopUntilUs = tUs + POOP_US;
}

/** 袋や道しるべは、同じ高さで犬の体に触れたら取る。糞は地面に接した足元が重なったときだけ踏む。 */
export function touches(item: ItemRt, x: number, footY: number, grounded: boolean): boolean {
  if (item.kind === 'poop') return grounded && Math.abs(x - item.x) <= POOP_REACH_X;
  return Math.abs(x - item.x) <= ITEM_REACH_X && item.y >= footY - 0.1 && item.y <= footY + BODY_HEIGHT;
}
