import { DEG, length, type Vec3 } from './math';
import { add3 } from './free-math';
import { DIRECTION_NAMES, freeTrickName, matchFreeTrick } from './free-trick-catalog';
import { FREE_MAX_DEG_PER_SEC, rotationTime, type FreeSpan } from './free-motion';

const HALF_TURN = 180;
const TIER_MINIMUMS = [1, 200, 400, 650, 850] as const;

export interface FreeScore {
  dogDegrees: number;
  riderDegrees: number;
  points: number;
  tier: number;
  label: string;
}

function directionOf(omega: Vec3, heading: number): number {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  // 踏切時の道を基準に、左右軸・上下軸・進行軸のうち最も強い軸へ割り当てる。
  const local = [-sin * omega[0] + cos * omega[2], omega[1], -cos * omega[0] - sin * omega[2]];
  const axis = local.reduce((largest, v, i) => Math.abs(v) > Math.abs(local[largest]) ? i : largest, 0);
  return axis * 2 + Number(local[axis] < 0);
}

function displayTrickName(name: string, turns: number, tier: number): string {
  const count = turns === 0.5 ? '半回転' : `${turns}回転`;
  const core = `${name}・${count}`;
  switch (tier) {
    case 1: return core;
    case 2: return `連続技・${core}`;
    case 3: return `疾風の連続技・${core}`;
    case 4: return `天翔ける疾風の連続技・${core}`;
    default: return `限界突破・天翔ける疾風の連続技・${core}の大連舞`;
  }
}

/** 着地までに犬・人が実際に回った向きと量を積算する。姿勢の最終角度には依存しない。 */
export function scoreFreeMotion(history: readonly FreeSpan[], airtimeUs: number, heading: number): FreeScore {
  const dog = Array<number>(DIRECTION_NAMES.length).fill(0);
  const rider = Array<number>(DIRECTION_NAMES.length).fill(0);
  for (const { startUs, endUs, from } of history) {
    const integral = rotationTime(endUs - startUs) / DEG;
    const dogOmega = add3(from.omega.common, from.omega.dog);
    const riderOmega = add3(from.omega.common, from.omega.rider);
    dog[directionOf(dogOmega, heading)] += length(dogOmega) * integral;
    rider[directionOf(riderOmega, heading)] += length(riderOmega) * integral;
  }
  const dogDegrees = dog.reduce((sum, amount) => sum + amount, 0);
  const riderDegrees = rider.reduce((sum, amount) => sum + amount, 0);
  // 半回転未満の方向の揺れは技に数えない。両方が同じ量だけ動いても二重加点しない。
  const qualifies = (amount: number) => amount >= HALF_TURN - 1e-7;
  const directions = dog.flatMap((amount, i) => qualifies(Math.max(amount, rider[i])) ? [i] : []);
  const qualifiedTotal = (amounts: number[]) => amounts.filter(qualifies).reduce((sum, amount) => sum + amount, 0);
  const dogQualified = qualifiedTotal(dog), riderQualified = qualifiedTotal(rider);
  const measured = Math.max(dogQualified, riderQualified);
  if (!directions.length || airtimeUs <= 0) return { dogDegrees, riderDegrees, points: 0, tier: 0, label: '着地' };

  const ceiling = 2 * FREE_MAX_DEG_PER_SEC * airtimeUs / 1e6;
  const halfTurns = Math.floor((measured + 1e-7) / HALF_TURN);
  const scoredDegrees = halfTurns * HALF_TURN;
  const nearLimit = ceiling - measured <= HALF_TURN + 1e-7;
  const variety = 1 + 0.08 * Math.min(directions.length - 1, 2);
  const points = nearLimit ? 1_000 : Math.min(999, Math.max(1, Math.floor(980 * scoredDegrees * variety / ceiling)));
  const tier = TIER_MINIMUMS.filter(minimum => points >= minimum).length;
  const target = dogQualified > 0 && riderQualified > 0 ? 'common' : dogQualified > 0 ? 'dog' : 'rider';
  const pattern = matchFreeTrick(directions, halfTurns);
  const name = freeTrickName(target, pattern, directions.length === 1);
  return { dogDegrees, riderDegrees, points, tier, label: displayTrickName(name, halfTurns / 2, tier) };
}
