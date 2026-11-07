import { RAIL_POINTS_MAX, RAIL_POINTS_PER_M } from './rules';
import type { PendingRail, SimEvent, SimState } from './types';
import type { RailRt } from './track';

/**
 * 手すり。上から足元を重ねて乗ると滑り、前へ払うと跳び降り、末端から自然に降りてもよい。
 * 正面・側面の接触は停止（接触の判定は run.ts の物の接触と共通）。
 * 手すり点は、降りた先で無事に接地したときに確定する。着地の倍率は掛けない。
 */

type Emit = (kind: SimEvent['kind'], atUs: number, data?: SimEvent['data'], objId?: string) => void;

/** 滑った距離（整数 mm）の整数メートル × 10 点、1本 100 点まで。 */
export function railPoints(distMm: number): number {
  return Math.min(RAIL_POINTS_MAX, Math.floor(Math.max(0, distMm) / 1000) * RAIL_POINTS_PER_M);
}

export function mountRail(run: SimState, rail: RailRt, atUs: number, sMm: number, emit: Emit): void {
  run.rail = { railId: rail.id, entryMm: sMm, entryUs: atUs };
  run.mode = 'rail';
  run.x = rail.x;
  run.targetX = rail.x;
  run.vy = 0;
  emit('railOn', atUs, { railId: rail.id }, rail.id);
}

/** 手すりを離れる。距離は降りて無事に着くまで保留する。 */
export function leaveRail(run: SimState, atUs: number, sMm: number, reason: 'end' | 'jump', emit: Emit): PendingRail | null {
  const g = run.rail;
  if (!g) return null;
  const rail = run.course.railsById.get(g.railId)!;
  const distMm = Math.max(0, sMm - g.entryMm);
  const fullLength = reason === 'end' && g.entryMm <= Math.round(rail.s0 * 1000) + 1500;
  run.rail = null;
  const pending: PendingRail = { railId: g.railId, distMm, fullLength };
  run.pendingRail = pending;
  emit('railOff', atUs, { railId: g.railId, distMm, reason }, g.railId);
  return pending;
}

/** 無事に接地したので手すり点を確定する。得点済みの手すりは 0 点で、既得点を変えない。 */
export function settleRail(run: SimState, pending: PendingRail, atUs: number, emit: Emit): number {
  const sc = run.score;
  if (pending.fullLength && !run.railsCompleted.includes(pending.railId)) run.railsCompleted.push(pending.railId);
  if (sc.scoredRails[pending.railId] !== undefined) {
    sc.railLog.push({ railId: pending.railId, distMm: pending.distMm, points: 0, lost: false });
    emit('railScore', atUs, { railId: pending.railId, points: 0, distMm: pending.distMm, already: true }, pending.railId);
    return 0;
  }
  const pts = railPoints(pending.distMm);
  sc.scoredRails[pending.railId] = pts;
  sc.railPoints += pts;
  sc.railLog.push({ railId: pending.railId, distMm: pending.distMm, points: pts, lost: false });
  emit('railScore', atUs, { railId: pending.railId, points: pts, distMm: pending.distMm }, pending.railId);
  return pts;
}

/** 無事に降りる前の落下・着地失敗。手すり点は 0。 */
export function loseRail(run: SimState, pending: PendingRail, atUs: number, emit: Emit): void {
  run.score.railLog.push({ railId: pending.railId, distMm: pending.distMm, points: 0, lost: true });
  emit('railLost', atUs, { railId: pending.railId, distMm: pending.distMm }, pending.railId);
}
