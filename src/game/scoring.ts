import {
  STREAK_BONUS,
  STREAK_LENGTH,
  TIME_SCORE_MAX,
  TRICK_SCORE_MAX,
  COMPOSITE_BONUS,
  toCentiseconds,
} from './rules';
import { resolveTricks, scoreJump, type JumpScore } from './tricks';
import { sectionAt, type PathRt, type SectionRt } from './track';
import { settleRail, loseRail } from './rails';
import type { FailureRec, NearMiss, RunResult, ScoreState, SimEvent, SimState } from './types';

/**
 * 採点。総合点 = タイム点（0〜5,000）＋技点（0〜5,000）、上限 10,000。
 * 技は採点区間（採点機会）ごとに最初に成功したジャンプ1回分を採点し、同じ通知の再処理では増やさない。
 */

export function createScore(): ScoreState {
  return {
    scoredOpps: {},
    scoredRails: {},
    streak: 0,
    streakBonus: 0,
    jumpPoints: 0,
    railPoints: 0,
    settledJumps: {},
    jumps: [],
    failures: [],
    railLog: [],
    missedOpps: [],
  };
}

/** 技点（上限 5,000 を適用した後）。 */
export function trickScore(sc: ScoreState): number {
  return Math.min(TRICK_SCORE_MAX, trickRaw(sc));
}

export function trickRaw(sc: ScoreState): number {
  return sc.jumpPoints + sc.railPoints + sc.streakBonus;
}

/**
 * タイム点。満点・0点・記録をすべて 0.01 秒単位の整数で受け取り、
 * 5,000 ×（0点タイム－記録）÷（0点タイム－満点タイム）を 0〜5,000 に収めて整数に四捨五入する。
 */
export function timeScore(recordCs: number, fullCs: number, zeroCs: number): number {
  if (!(zeroCs > fullCs)) throw new Error('0点タイムは満点タイムより長くする');
  if (recordCs <= fullCs) return TIME_SCORE_MAX;
  if (recordCs >= zeroCs) return 0;
  const num = TIME_SCORE_MAX * (zeroCs - recordCs);
  const den = zeroCs - fullCs;
  return Math.floor((2 * num + den) / (2 * den));
}

export function totalScore(time: number, trick: number): number {
  return Math.min(TIME_SCORE_MAX + TRICK_SCORE_MAX, time + Math.min(TRICK_SCORE_MAX, trick));
}

type Emit = (kind: SimEvent['kind'], atUs: number, data?: SimEvent['data'], objId?: string) => void;

/** 連続成功数を戻す（失敗・衝突・区間の通過漏れ・落下）。 */
export function breakStreak(sc: ScoreState): void {
  sc.streak = 0;
}

/** 採点区間を抜けたとき。まだ採点していない機会なら通過漏れとして連続数を戻す。 */
export function exitSection(sc: ScoreState, sec: SectionRt, atUs: number, emit: Emit): void {
  if (sc.scoredOpps[sec.opp]) return;
  if (!sc.missedOpps.includes(sec.opp)) sc.missedOpps.push(sec.opp);
  const had = sc.streak;
  breakStreak(sc);
  emit('sectionMiss', atUs, { opp: sec.opp, section: sec.key, streakBefore: had });
}

export interface LandingContact {
  atUs: number;
  /** 着地点（足元中心）の道と距離（整数 mm）。 */
  pathId: string;
  sMm: number;
  surfacePitch: number;
  onRail: string | null;
}

/**
 * 着地を確定する。手すりに乗ったときも呼ぶ。
 * 順番: 着地の判定 → 保留中の手すり点 → 空中技（区間の採点と連続点）。同じジャンプの再通知は 0 点。
 */
export function settleLanding(run: SimState, contact: LandingContact, emit: Emit): JumpScore | null {
  const sc = run.score;
  const jump = run.jump;
  if (!jump || sc.settledJumps[jump.jumpId]) return null;
  sc.settledJumps[jump.jumpId] = true;
  const strokes = jump.strokes.map((id) => run.strokes[id]).filter(Boolean);
  const res = resolveTricks(strokes, contact.atUs, contact.atUs);
  jump.resolution = res;
  const js = scoreJump(res, contact.atUs, run.basePitch, contact.surfacePitch);
  const hasTrick = res.rotations.length > 0;
  const safe = !hasTrick || js.tenths > 0;

  if (run.pendingRail) {
    if (safe) settleRail(run, run.pendingRail, contact.atUs, emit);
    else loseRail(run, run.pendingRail, contact.atUs, emit);
    run.pendingRail = null;
  }

  const p = run.course.paths.get(contact.pathId) as PathRt;
  const sec = sectionAt(p, contact.sMm);
  if (!hasTrick) {
    emit('land', contact.atUs, { jumpId: jump.jumpId, points: 0, tenths: js.tenths, plain: true, onRail: contact.onRail });
    return js;
  }
  const wouldBase = js.base + (js.composite ? COMPOSITE_BONUS : 0);
  if (js.tenths === 0) {
    const fail: FailureRec = {
      jumpId: jump.jumpId,
      atUs: contact.atUs,
      opp: sec?.opp ?? null,
      sectionKey: sec?.key ?? null,
      wouldBase,
      reason: js.residualDeg >= js.tiltDeg ? 'underRotated' : 'tilted',
      names: js.names,
      composite: js.composite,
    };
    sc.failures.push(fail);
    breakStreak(sc);
    sc.jumps.push({ jumpId: jump.jumpId, atUs: contact.atUs, opp: fail.opp, sectionKey: fail.sectionKey, names: js.names, base: js.base, composite: js.composite, tenths: 0, points: 0, awarded: 0, onRail: !!contact.onRail });
    emit('landFail', contact.atUs, { jumpId: jump.jumpId, reason: fail.reason, residual: Math.round(js.residualDeg), names: js.names, section: sec?.key ?? null });
    return js;
  }
  let awarded = 0;
  if (sec && !sc.scoredOpps[sec.opp]) {
    awarded = js.points;
    sc.scoredOpps[sec.opp] = { points: awarded, jumpId: jump.jumpId, sectionKey: sec.key };
    sc.jumpPoints += awarded;
    sc.streak += 1;
    emit('sectionScore', contact.atUs, { opp: sec.opp, section: sec.key, points: awarded, streak: sc.streak });
    if (sc.streak >= STREAK_LENGTH) {
      sc.streakBonus += STREAK_BONUS;
      sc.streak = 0;
      emit('streak', contact.atUs, { bonus: STREAK_BONUS });
    }
  }
  sc.jumps.push({ jumpId: jump.jumpId, atUs: contact.atUs, opp: sec?.opp ?? null, sectionKey: sec?.key ?? null, names: js.names, base: js.base, composite: js.composite, tenths: js.tenths, points: js.points, awarded, onRail: !!contact.onRail });
  emit('land', contact.atUs, {
    jumpId: jump.jumpId,
    points: awarded,
    tenths: js.tenths,
    composite: js.composite,
    names: js.names,
    sectionUsed: !!sec && awarded === 0,
    onRail: contact.onRail,
  });
  return js;
}

const HINTS: Record<FailureRec['reason'], (f: FailureRec) => string> = {
  underRotated: (f) =>
    f.composite
      ? '回転が足りませんでした。踏切台から跳ぶと滞空が長くなり、複合技も回り切れます。'
      : '回転が足りませんでした。離陸したらすぐに描き始めるか、踏切台から跳んでみましょう。',
  tilted: () => '足が傾いたまま着きました。回転を描き終えたら、次の指は着地のあとに出しましょう。',
};

/** 「惜しい」: 失敗した採点区間から得られたはずの基礎点が最大の1件。同じなら最初の区間。 */
export function nearMiss(run: SimState): NearMiss | null {
  const order = run.course.opportunities;
  let best: FailureRec | null = null;
  for (const f of run.score.failures) {
    if (!f.opp || !f.sectionKey) continue;
    if (!best || f.wouldBase > best.wouldBase || (f.wouldBase === best.wouldBase && order.indexOf(f.opp) < order.indexOf(best.opp!))) best = f;
  }
  if (!best || !best.opp || !best.sectionKey) return null;
  return {
    opp: best.opp,
    sectionKey: best.sectionKey,
    sectionNumber: order.indexOf(best.opp) + 1,
    wouldBase: best.wouldBase,
    names: best.names,
    hint: HINTS[best.reason](best),
  };
}

/** ゴールで結果を固定する。完走の記録値だけを 0.01 秒単位に丸める。 */
export function finishRun(run: SimState, atUs: number): RunResult {
  const sc = run.score;
  const recordCs = toCentiseconds(atUs);
  const ts = run.course.def.timeScore;
  const time = timeScore(recordCs, ts.fullCs, ts.zeroCs);
  const raw = trickRaw(sc);
  const trick = Math.min(TRICK_SCORE_MAX, raw);
  const ch = run.course.def.challenge;
  const challengeDone = !!ch && (ch.kind === 'railFull' ? run.railsCompleted.includes(ch.target) : run.route.includes(ch.target));
  return {
    runId: run.id.runId,
    courseId: run.id.courseId,
    courseVersion: run.id.courseVersion,
    rulesVersion: run.id.rulesVersion,
    dogId: run.id.dogId,
    mode: run.id.mode,
    finishUs: atUs,
    recordCs,
    timeScore: time,
    trickRaw: raw,
    trickScore: trick,
    total: totalScore(time, trick),
    jumpPoints: sc.jumpPoints,
    railPoints: sc.railPoints,
    streakBonus: sc.streakBonus,
    sections: run.course.opportunities.map((opp) => ({
      opp,
      points: sc.scoredOpps[opp]?.points ?? 0,
      state: sc.scoredOpps[opp] ? 'scored' : sc.missedOpps.includes(opp) ? 'missed' : 'open',
    })),
    rails: Object.entries(sc.scoredRails).map(([railId, points]) => ({ railId, points })),
    jumps: sc.jumps.slice(),
    nearMiss: nearMiss(run),
    route: run.route.slice(),
    challengeDone,
    itemsTaken: Object.keys(run.consumed),
  };
}
