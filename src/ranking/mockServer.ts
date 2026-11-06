import { COURSE_DEFS } from '../content/courses/index';
import { RULES_VERSION } from '../game/rules';
import { timeScore } from '../game/scoring';
import type { BoardQuery, BoardRow, FinishPayload, SendStatus, StartSnapshot, Transport } from './client';

/**
 * 試験用の接続先（端末内の模擬サーバー）。正式な接続先の契約を確認するまでの検証に使う。
 * 受け側の検査: 版・コース・値の範囲・計算の整合性。同じ走行 ID の同じ内容は受領済み、違う内容は競合として元の記録を残す。
 * 開始が届いていない完走は登録しない（未承諾の登録や別走行への紐付けを起こさない）。
 */

interface Row extends FinishPayload {
  displayName: string;
  seq: number;
}

export interface MockOptions {
  /** 次の n 回の呼び出しを通信失敗にする。 */
  failNext?: number;
  /** 処理はするが、応答を失わせる（呼び出し側には失敗として見える）。 */
  dropResponses?: number;
  latencyMs?: number;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class MockRankingServer implements Transport {
  starts = new Map<string, StartSnapshot>();
  rows = new Map<string, Row>();
  private seq = 0;
  calls = 0;
  constructor(public opts: MockOptions = {}) {}

  private async gate<T>(work: () => T): Promise<T> {
    this.calls++;
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    if (this.opts.failNext && this.opts.failNext > 0) {
      this.opts.failNext--;
      throw new Error('network');
    }
    const v = work();
    if (this.opts.dropResponses && this.opts.dropResponses > 0) {
      this.opts.dropResponses--;
      throw new Error('response lost');
    }
    return v;
  }

  private validVersion(courseId: string, courseVersion: string, rulesVersion: string): boolean {
    const def = COURSE_DEFS[courseId as keyof typeof COURSE_DEFS];
    return !!def && def.version === courseVersion && rulesVersion === RULES_VERSION && def.goal !== null;
  }

  postStart(s: StartSnapshot): Promise<SendStatus> {
    return this.gate(() => {
      if (!s.consent || !s.displayName.trim() || !s.participantId) return 'rejected';
      if (!this.validVersion(s.courseId, s.courseVersion, s.rulesVersion)) return 'rejected';
      const prev = this.starts.get(s.runId);
      if (prev) return sameJson(prev, s) ? 'duplicate' : 'conflict';
      this.starts.set(s.runId, { ...s, displayName: String(s.displayName).slice(0, 16) });
      return 'accepted';
    });
  }

  postFinish(f: FinishPayload): Promise<SendStatus> {
    return this.gate(() => {
      const st = this.starts.get(f.runId);
      if (!st) return 'unknownStart';
      if (st.participantId !== f.participantId || st.courseId !== f.courseId || st.courseVersion !== f.courseVersion || st.rulesVersion !== f.rulesVersion || st.dogId !== f.dogId) return 'rejected';
      if (!this.validVersion(f.courseId, f.courseVersion, f.rulesVersion)) return 'rejected';
      const def = COURSE_DEFS[f.courseId]!;
      const ints = [f.recordCs, f.timeScore, f.trickScore, f.total];
      if (!ints.every((v) => Number.isInteger(v) && v >= 0)) return 'rejected';
      if (f.trickScore > 5000 || f.timeScore > 5000 || f.total > 10000 || f.recordCs <= 0) return 'rejected';
      // サーバー側の検算: タイム点はコースの基準から計算し直し、総合はタイム点＋技点。
      if (timeScore(f.recordCs, def.timeScore.fullCs, def.timeScore.zeroCs) !== f.timeScore) return 'rejected';
      if (f.timeScore + f.trickScore !== f.total) return 'rejected';
      const prev = this.rows.get(f.runId);
      if (prev) {
        const { displayName: _n, seq: _s, ...rest } = prev;
        void _n;
        void _s;
        return sameJson(rest, f) ? 'duplicate' : 'conflict';
      }
      this.rows.set(f.runId, { ...f, displayName: st.displayName, seq: ++this.seq });
      return 'accepted';
    });
  }

  getBoard(q: BoardQuery): Promise<BoardRow[]> {
    return this.gate(() => buildBoard([...this.rows.values()], q));
  }
}

/**
 * 1参加者につき、総合は最高の1件、タイムは最速の1件。同じ記録は同じ順位（1・1・3）。
 * 同じ順位の中は、達成の順 → 参加者識別子の順で表示順だけを固定する。最大 limit 人。
 */
export function buildBoard(rows: (FinishPayload & { displayName: string; seq: number })[], q: BoardQuery): BoardRow[] {
  const mine = rows.filter((r) => r.courseId === q.courseId && r.courseVersion === q.courseVersion && r.rulesVersion === q.rulesVersion);
  const best = new Map<string, (typeof mine)[number]>();
  const better = (a: (typeof mine)[number], b: (typeof mine)[number]) => {
    if (q.metric === 'total') return a.total > b.total || (a.total === b.total && a.seq < b.seq);
    return a.recordCs < b.recordCs || (a.recordCs === b.recordCs && a.seq < b.seq);
  };
  for (const r of mine) {
    const cur = best.get(r.participantId);
    if (!cur || better(r, cur)) best.set(r.participantId, r);
  }
  const list = [...best.values()].sort((a, b) => {
    const va = q.metric === 'total' ? -a.total : a.recordCs;
    const vb = q.metric === 'total' ? -b.total : b.recordCs;
    return va - vb || a.seq - b.seq || (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0);
  });
  const out: BoardRow[] = [];
  let prevValue: number | null = null;
  let rank = 0;
  list.forEach((r, i) => {
    const value = q.metric === 'total' ? r.total : r.recordCs;
    if (value !== prevValue) rank = i + 1;
    prevValue = value;
    out.push({ rank, participantId: r.participantId, displayName: r.displayName, value, dogId: r.dogId, achievedSeq: r.seq });
  });
  return out.slice(0, q.limit);
}
