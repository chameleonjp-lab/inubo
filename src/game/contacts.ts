import { FALL_DEPTH, FOOT_FRONT, FOOT_HALF_WIDTH, RAIL_SNAP, STEP_DOWN, STEP_UP } from './rules';
import { touches } from './items';
import { landingSupport, offRoad, pointAt, type MotionPoint, type SegmentMotion } from './motion';
import {
  baseHeight,
  hwAt,
  railTopAt,
  sectionAt,
  solidTop,
  supportHeight,
  type CheckpointRt,
  type ItemRt,
  type RailRt,
  type SectionRt,
  type Solid,
} from './track';
import type { SimState } from './types';

/**
 * 前回位置から今回位置までに起きる接触を、刻みの途中の時刻（整数 µs）で求める。
 * 最初の接触でその刻みを分割し、接触を処理したあとに残りの動きを求め直す。
 */

export type Contact =
  | { type: 'sectionEnd'; section: SectionRt }
  | { type: 'land' }
  | { type: 'railMount'; rail: RailRt }
  | { type: 'item'; item: ItemRt }
  | { type: 'checkpoint'; cp: CheckpointRt }
  | { type: 'lip'; solid: Solid }
  | { type: 'solid'; solid: Solid; face: 'front' | 'side'; side: number }
  | { type: 'railEnd'; rail: RailRt }
  | { type: 'ledge' }
  | { type: 'dropOff' }
  | { type: 'fallDepth' }
  | { type: 'pathEnd' }
  | { type: 'goal' };

/**
 * 同じ時刻に起きた接触の処理順。区間の終了線 → 着地（手すり点・連続点を含む）→ 取得 → … → ゴール。
 * 同時刻に安全な着地とゴールがあれば、着地を確定してから結果を閉じる。
 */
export const CONTACT_PRIORITY: Record<Contact['type'], number> = {
  sectionEnd: 0,
  land: 1,
  railMount: 1,
  item: 2,
  checkpoint: 3,
  lip: 4,
  solid: 5,
  railEnd: 6,
  ledge: 7,
  dropOff: 7,
  fallDepth: 8,
  pathEnd: 9,
  goal: 10,
};

/** 位置を整数ミリメートルにする（判定用）。 */
export function sMmOf(s: number): number {
  return Math.floor(s * 1000 + 1e-6);
}

/** start から rate で動いて target を越える最初の整数 µs。越えなければ null。 */
export function crossLinear(start: number, rate: number, target: number, spanUs: number, allowZero = false): number | null {
  if (rate <= 0) return null;
  if (target < start - 1e-12) return null;
  if (target <= start + 1e-12) return allowZero ? 0 : null;
  const tau = Math.ceil(((target - start) / rate) * 1e6 - 1e-6);
  return tau <= spanUs ? Math.max(0, tau) : null;
}

/** 条件が最初に成り立つ整数 µs を二分探索で求める（0 では不成立、hi では成立）。 */
export function firstTrue(hi: number, pred: (tau: number) => boolean): number {
  let lo = 0;
  if (pred(0)) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function lateralOverlap(so: Solid, x: number): boolean {
  return x > so.x0 - FOOT_HALF_WIDTH && x < so.x1 + FOOT_HALF_WIDTH;
}

/** その物が足元の高さで前進を塞ぐか。 */
export function blocksAt(run: SimState, so: Solid, s: number, y: number, tUs: number): boolean {
  if (run.ghostGates.includes(so.id)) return false;
  const p = run.course.paths.get(so.pathId)!;
  return solidTop(p, so, s + FOOT_FRONT, tUs) - y > STEP_UP + 1e-9;
}

/** 足元中心が物の接触範囲（前は鼻先の長さ、横は足元の幅の分だけ広げた範囲）に入っているか。 */
export function insideExpanded(so: Solid, s: number, x: number): boolean {
  return s > so.s0 - FOOT_FRONT - 1e-9 && s < so.s1 && lateralOverlap(so, x);
}

export interface FoundContacts {
  tau: number;
  contacts: Contact[];
}

export function findContacts(run: SimState, m: SegmentMotion, spanUs: number): FoundContacts | null {
  const p = m.path;
  const found: { tau: number; c: Contact }[] = [];
  const add = (tau: number | null, c: Contact) => {
    if (tau !== null && tau <= spanUs) found.push({ tau, c });
  };
  const at = (tau: number): MotionPoint => pointAt(m, tau, run);
  const sEnd = m.s0 + (m.dsdt * spanUs) / 1e6;
  const lateralSpan = Math.min(spanUs, m.reachUs);

  if (run.mode === 'falling') return null;

  // 区間の終了線
  const sec = sectionAt(p, sMmOf(m.s0));
  if (sec) add(crossLinear(m.s0, m.dsdt, sec.s1Mm / 1000, spanUs), { type: 'sectionEnd', section: sec });

  // ゴール・道の終わり
  const goal = run.course.goal;
  if (goal && goal.pathId === p.id) add(crossLinear(m.s0, m.dsdt, goal.s, spanUs), { type: 'goal' });
  add(crossLinear(m.s0, m.dsdt, p.length, spanUs), { type: 'pathEnd' });

  // 復帰地点
  for (const cp of p.checkpoints) {
    if (cp.s > m.s0 && cp.s <= sEnd + 1e-9) add(crossLinear(m.s0, m.dsdt, cp.s, spanUs), { type: 'checkpoint', cp });
  }

  // アイテム（足元中心が物の位置を越えた時刻に、横と高さの重なりを調べる）
  for (const it of p.items) {
    if (run.consumed[it.id]) continue;
    if (it.s < m.s0 - 1e-9 || it.s > sEnd + 1e-9) continue;
    const tau = crossLinear(m.s0, Math.max(m.dsdt, 1e-12), it.s, spanUs, true);
    if (tau === null) continue;
    const pt = at(tau);
    if (touches(it, pt.x, pt.y, run.mode === 'ground')) add(tau, { type: 'item', item: it });
  }

  // 物への接触（正面・側面）と踏切台の先端
  for (const so of p.solids) {
    if (so.s0 - FOOT_FRONT > sEnd + 0.5) break;
    if (so.s1 < m.s0 - 0.5 && so.kind !== 'kicker') continue;
    if (run.ghostGates.includes(so.id)) continue;
    // 正面: 鼻先の位置が前面を越える瞬間
    const plane = so.s0 - FOOT_FRONT;
    if (m.dsdt > 0 && m.s0 <= plane + 1e-9) {
      const tau = m.s0 >= plane - 1e-9 ? 0 : crossLinear(m.s0, m.dsdt, plane, spanUs);
      if (tau !== null) {
        const pt = at(tau);
        if (lateralOverlap(so, pt.x) && blocksAt(run, so, plane, pt.y, m.t0 + tau)) add(tau, { type: 'solid', solid: so, face: 'front', side: 0 });
      }
    }
    // 側面: 横に動いて接触範囲の横の縁を越える瞬間
    if (m.latV !== 0) {
      const face = m.latV > 0 ? so.x0 - FOOT_HALF_WIDTH : so.x1 + FOOT_HALF_WIDTH;
      const ahead = m.latV > 0 ? m.x0 <= face + 1e-9 : m.x0 >= face - 1e-9;
      if (ahead) {
        const d = (face - m.x0) / m.latV;
        const tau = d <= 1e-12 ? 0 : Math.ceil(d * 1e6 - 1e-6);
        if (tau <= lateralSpan) {
          const pt = at(tau);
          if (pt.s > so.s0 - FOOT_FRONT && pt.s < so.s1 && blocksAt(run, so, pt.s, pt.y, m.t0 + tau)) {
            add(tau, { type: 'solid', solid: so, face: 'side', side: Math.sign(m.latV) });
          }
        }
      }
    }
    // 踏切台の先端（地上で台の上を走っているとき）
    if (so.kind === 'kicker' && run.mode === 'ground' && m.s0 >= so.s0 - 1e-9 && m.s0 < so.s1 && m.x0 >= so.x0 && m.x0 <= so.x1) {
      const top = solidTop(p, so, m.s0, m.t0);
      if (Math.abs(top - m.y0) < 0.1) add(crossLinear(m.s0, m.dsdt, so.s1, spanUs), { type: 'lip', solid: so });
    }
  }

  if (m.rail && run.rail) {
    const r = run.course.railsById.get(run.rail.railId)!;
    add(crossLinear(m.s0, m.dsdt, r.s1, spanUs, true), { type: 'railEnd', rail: r });
  }

  if (m.air) {
    // 手すりへ上から乗る
    for (const r of p.rails) {
      if (r.s1 < m.s0 || r.s0 - FOOT_FRONT > sEnd) continue;
      const f = (tau: number) => {
        const pt = at(tau);
        return pt.y - railTopAt(r, pt.s);
      };
      if (f(0) <= 0 || f(spanUs) > 0) continue;
      const tau = firstTrue(spanUs, (t) => f(t) <= 0);
      const pt = at(tau);
      // 足元（前足は鼻先の長さまで）が手すりに重なっていれば乗れる。
      if (pt.vy < 0 && pt.s >= r.s0 - FOOT_FRONT && pt.s <= r.s1 && Math.abs(pt.x - r.x) <= RAIL_SNAP) add(tau, { type: 'railMount', rail: r });
    }
    // 着地
    const landPred = (tau: number) => {
      const pt = at(tau);
      return pt.vy <= 0 && pt.y <= landingSupport(p, pt.s, pt.x, pt.y, m.t0 + tau) + 1e-9;
    };
    if (landPred(spanUs)) add(firstTrue(spanUs, landPred), { type: 'land' });
    // 道の外へ落ちた
    const endPt = at(spanUs);
    if (offRoad(p, Math.min(p.length, Math.max(0, endPt.s)), endPt.x) && endPt.y < baseHeight(p, Math.min(p.length, Math.max(0, endPt.s))) - FALL_DEPTH) add(spanUs, { type: 'fallDepth' });
  } else if (run.mode === 'ground') {
    // 落下側の端を越える
    if (m.latV !== 0) {
      const hw = hwAt(p, m.s0);
      const face = m.latV > 0 ? hw : -hw;
      const edge = m.latV > 0 ? p.edges[1] : p.edges[0];
      if (edge === 'drop') {
        const ahead = m.latV > 0 ? m.x0 <= face : m.x0 >= face;
        if (ahead) {
          const d = (face - m.x0) / m.latV;
          const tau = Math.max(0, Math.ceil(d * 1e6 - 1e-6));
          if (tau <= lateralSpan) add(tau, { type: 'dropOff' });
        }
      }
    }
    // 段差の縁から浮く
    const ledgePred = (tau: number) => {
      const pt = at(tau);
      return supportHeight(p, pt.s, pt.x, m.y0, m.t0 + tau) < m.y0 - STEP_DOWN;
    };
    if (ledgePred(spanUs)) add(firstTrue(spanUs, ledgePred), { type: 'ledge' });
  }

  if (found.length === 0) return null;
  let tau = Infinity;
  for (const f of found) tau = Math.min(tau, f.tau);
  const contacts = found.filter((f) => f.tau === tau).map((f) => f.c);
  contacts.sort((a, b) => CONTACT_PRIORITY[a.type] - CONTACT_PRIORITY[b.type]);
  return { tau, contacts };
}

/** 外から渡された接触を、実際に触れた時刻（整数 µs）→ 同時刻の処理順で並べる。到着順にはよらない。 */
export function orderContacts<T extends { atUs: number; type: Contact['type']; seq?: number }>(list: T[]): T[] {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.atUs - b.c.atUs || CONTACT_PRIORITY[a.c.type] - CONTACT_PRIORITY[b.c.type] || (a.c.seq ?? a.i) - (b.c.seq ?? b.i))
    .map((e) => e.c);
}
