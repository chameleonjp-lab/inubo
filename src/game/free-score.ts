import { DEG, length, type Vec3 } from './math';
import { add3 } from './free-math';
import { DIRECTION_NAMES, freeTrickName, matchFreeTrick } from './free-trick-catalog';
import { FREE_DECAY, FREE_MAX_DEG_PER_SEC, rotationTime, type FreeMotionInput, type FreeSpan, type FreeTarget } from './free-motion';

const HALF_TURN = 180;
const TIER_MINIMUMS = [1, 200, 400, 650, 850] as const;

export interface FreeScore {
  dogDegrees: number;
  riderDegrees: number;
  points: number;
  basePoints: number;
  switchBonus: number;
  switchCount: number;
  directionCount: number;
  tier: number;
  label: string;
  /** 技名と同じ判定で成立した実回転の対象（読み取り専用の表示情報。得点には使わない）。 */
  scoredTarget: 'common' | 'dog' | 'rider' | null;
}

export function directionOf(omega: Vec3, heading: number): number {
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

/** 切替前後の実回転と十分なスワイプ量がある場合だけ、切替を連携として数える。 */
export function scoreTargetSwitches(history: readonly FreeSpan[], inputs: readonly FreeMotionInput[]): { count: number; bonus: number } {
  const sorted = inputs.filter(input => length(input.rotation) > 1e-7).slice().sort((a, b) => a.atUs - b.atUs || a.seq - b.seq);
  const phases: { target: FreeTarget; startUs: number; drag: number }[] = [];
  for (const input of sorted) {
    const last = phases[phases.length - 1];
    if (!last || last.target !== input.target) phases.push({ target: input.target, startUs: input.atUs, drag: 0 });
    phases[phases.length - 1].drag += length(input.rotation);
  }
  const lastMotionUs = history[history.length - 1]?.endUs ?? 0;
  const eligible = phases.map((phase, i) => {
    const untilUs = Math.min(lastMotionUs, phases[i + 1]?.startUs ?? lastMotionUs);
    if (phase.drag < 0.15 || untilUs - phase.startUs < 35_000) return false;
    let degrees = 0;
    for (const span of history) {
      const a = Math.max(span.startUs, phase.startUs), b = Math.min(span.endUs, untilUs);
      if (b <= a) continue;
      const decayed = Math.exp(-FREE_DECAY * (a - span.startUs) / 1e6);
      degrees += length(span.from.omega[phase.target]) * decayed * rotationTime(b - a) / DEG;
    }
    return degrees >= 45;
  });
  let count = 0;
  const targets = new Set<FreeTarget>();
  for (let i = 1; i < phases.length; i++) {
    if (!eligible[i - 1] || !eligible[i]) continue;
    count++;
    targets.add(phases[i - 1].target);
    targets.add(phases[i].target);
  }
  const capped = Math.min(4, count);
  return { count: capped, bonus: [0, 180, 400, 650, 900][capped] + (targets.size === 3 ? 150 : 0) };
}

/** 同じ対象で回す向きを変え、入力の向きへ実際に45度以上回ったときに数える。 */
export function scoreDirectionSwitches(history: readonly FreeSpan[], inputs: readonly FreeMotionInput[], heading: number, atUs = Infinity): number {
  const phases: { target: FreeTarget; direction: number; start: number; drag: number }[] = [];
  const end = Math.min(atUs, history.at(-1)?.endUs ?? 0);
  for (const input of inputs.filter(i => i.atUs < end).sort((a, b) => a.atUs - b.atUs || a.seq - b.seq)) {
    const drag = length(input.rotation);
    if (drag <= 1e-7) continue;
    const direction = directionOf(input.rotation, heading);
    const last = phases.at(-1);
    if (last?.target === input.target && last.direction === direction) last.drag += drag;
    else phases.push({ target: input.target, direction, start: input.atUs, drag });
  }
  let spanIndex = 0;
  let last: typeof phases[number] | undefined;
  let count = 0;
  for (const [index, phase] of phases.entries()) {
    const until = phases[index + 1]?.start ?? end;
    if (phase.drag < 0.15 || until - phase.start < 35_000) continue;
    while (history[spanIndex] && history[spanIndex].endUs <= phase.start) spanIndex++;
    let degrees = 0;
    for (let i = spanIndex; i < history.length && history[i].startUs < until; i++) {
      const span = history[i];
      const from = Math.max(span.startUs, phase.start);
      const to = Math.min(span.endUs, until);
      const omega = span.from.omega[phase.target];
      if (to > from && directionOf(omega, heading) === phase.direction) {
        degrees += length(omega) * Math.exp(-FREE_DECAY * (from - span.startUs) / 1e6) * rotationTime(to - from) / DEG;
      }
    }
    if (degrees < 45) continue;
    if (last?.target === phase.target && last.direction !== phase.direction) count++;
    last = phase;
  }
  return Math.min(3, count);
}

export function directionBonus(count: number): number {
  return [0, 250, 550, 900][count] ?? 0;
}

/** 着地までに犬・人が実際に回った向きと量を積算する。姿勢の最終角度には依存しない。 */
export function scoreFreeMotion(history: readonly FreeSpan[], airtimeUs: number, heading: number, inputs: readonly FreeMotionInput[] = [], withDirectionCombos = true): FreeScore {
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
  if (!directions.length || airtimeUs <= 0) return { dogDegrees, riderDegrees, points: 0, basePoints: 0, switchBonus: 0, switchCount: 0, directionCount: 0, tier: 0, label: '着地', scoredTarget: null };

  const ceiling = 2 * FREE_MAX_DEG_PER_SEC * airtimeUs / 1e6;
  const halfTurns = Math.floor((measured + 1e-7) / HALF_TURN);
  const scoredDegrees = halfTurns * HALF_TURN;
  const nearLimit = ceiling - measured <= HALF_TURN + 1e-7;
  const variety = 1 + 0.08 * Math.min(directions.length - 1, 2);
  const basePoints = nearLimit ? 1_000 : Math.min(999, Math.max(1, Math.floor(980 * scoredDegrees * variety / ceiling)));
  const combo = scoreTargetSwitches(history, inputs);
  const directionCount = withDirectionCombos ? scoreDirectionSwitches(history, inputs, heading) : 0;
  const switchBonus = combo.bonus + directionBonus(directionCount);
  const points = basePoints + switchBonus;
  const tier = TIER_MINIMUMS.filter(minimum => points >= minimum).length;
  const target = dogQualified > 0 && riderQualified > 0 ? 'common' : dogQualified > 0 ? 'dog' : 'rider';
  const pattern = matchFreeTrick(directions, halfTurns);
  const name = freeTrickName(target, pattern, directions.length === 1);
  return { dogDegrees, riderDegrees, points, basePoints, switchBonus, switchCount: combo.count, directionCount, tier,
    label: displayTrickName(name, halfTurns / 2, tier), scoredTarget: target };
}
