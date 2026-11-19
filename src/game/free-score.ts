import { DEG, type Quat } from './math';
import { qDistance } from './free-math';
import { sampleFreeSpan, type FreeSpan } from './free-motion';

export type FreeLanding = 'normal' | 'clean' | 'crash';
export interface FreeScore { dogDegrees: number; riderDegrees: number; base: number; points: number; eligible: boolean; label: string }
/** 最終姿勢や入力量ではなく、接触までの実際の姿勢履歴を45度ずつ数える。 */
export function scoreFreeMotion(history: readonly FreeSpan[], landing: FreeLanding): FreeScore {
  const totals = { dog: 0, rider: 0 };
  for (const body of ['dog', 'rider'] as const) {
    let anchor: Quat | undefined;
    for (const span of history) {
      anchor ??= span.from.pose[body].q;
      let start = span.startUs;
      // 共通・個別が同じ向きに重なっても、1区間は最大28.8度。45度の境界を補間して余りを保つ。
      while (qDistance(anchor, span.to.pose[body].q) >= 45 * DEG - 1e-9) {
        let lo = start, hi = span.endUs;
        for (let n = 0; n < 35; n++) {
          const mid = (lo + hi) / 2;
          if (qDistance(anchor, sampleFreeSpan(span, mid).pose[body].q) < 45 * DEG) lo = mid;
          else hi = mid;
        }
        anchor = sampleFreeSpan(span, hi).pose[body].q;
        totals[body] += 45; start = hi;
        if (span.endUs - start < 1e-5) break;
      }
    }
  }
  const base = Math.floor((totals.dog * 100 + totals.rider * 150) / 360);
  const points = landing === 'crash' ? 0 : Math.floor(base * (landing === 'clean' ? 1.2 : 1));
  return { dogDegrees: totals.dog, riderDegrees: totals.rider, base, points, eligible: points > 0, label: base > 0 ? 'フリースタイル' : '着地' };
}
