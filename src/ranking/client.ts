import type { CourseId, DogId } from '../content/types';
import type { RunIdentity, RunResult } from '../game/types';
import type { StorageLike } from '../storage/records';

/**
 * 公開順位の送受信。開始・完走・順位の取得・失敗時の再試行を分ける。
 * - 参加できるのは、競技の走行で、スタート時に名前があり、公開に同意した場合だけ（開始時に固定）。
 * - 空欄で始めた走行・練習は、個人ランキング用の送信も送信待ちの保存も 0 件。順位の閲覧は別に使える。
 * - 完走は1走1件。同じ行から「総合」と「タイム」の2つの順位を作る。応答が消えても同じ内容だけを再送する。
 * 正式な接続先・登録先は公開段階で確認してから設定する。それまでは試験用の接続先（模擬サーバー）で動かす。
 */

export interface StartSnapshot {
  runId: string;
  participantId: string;
  displayName: string;
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  dogId: DogId;
  consent: true;
}

export interface FinishPayload {
  runId: string;
  participantId: string;
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  dogId: DogId;
  recordCs: number;
  timeScore: number;
  trickScore: number;
  total: number;
}

export type SendStatus = 'accepted' | 'duplicate' | 'conflict' | 'unknownStart' | 'rejected';

export interface BoardQuery {
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  metric: 'total' | 'time';
  limit: number;
}

export interface BoardRow {
  rank: number;
  participantId: string;
  displayName: string;
  value: number;
  dogId: DogId;
  achievedSeq: number;
}

export interface Transport {
  postStart(s: StartSnapshot): Promise<SendStatus>;
  postFinish(f: FinishPayload): Promise<SendStatus>;
  getBoard(q: BoardQuery): Promise<BoardRow[]>;
}

interface OutboxEntry {
  start: StartSnapshot;
  finish: FinishPayload | null;
  startAcked: boolean;
  finishAcked: boolean;
  conflict: boolean;
}

const OUTBOX_KEY = 'inubo:v1:rankingOutbox';
export const BOARD_LIMIT = 30;

export type BoardState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; rows: BoardRow[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export class RankingClient {
  constructor(
    private transport: Transport,
    private store: StorageLike,
    readonly enabled: boolean,
  ) {}

  /** 開始時に参加できるか（ここで固定した値を最後まで使う）。 */
  canParticipate(name: string, mode: RunIdentity['mode'], consent: boolean): boolean {
    return this.enabled && mode === 'competition' && consent && name.trim().length > 0;
  }

  private readOutbox(): Record<string, OutboxEntry> {
    try {
      const raw = this.store.getItem(OUTBOX_KEY);
      return raw ? (JSON.parse(raw) as Record<string, OutboxEntry>) : {};
    } catch {
      return {};
    }
  }

  private writeOutbox(o: Record<string, OutboxEntry>): void {
    try {
      this.store.setItem(OUTBOX_KEY, JSON.stringify(o));
    } catch {
      /* 保存できなくても、この画面の間は送信を続ける */
    }
  }

  /** 送信待ち（まだ受領されていない）件数。 */
  pendingCount(): number {
    return Object.values(this.readOutbox()).filter((e) => !e.conflict && (!e.startAcked || (e.finish && !e.finishAcked))).length;
  }

  outboxSize(): number {
    return Object.keys(this.readOutbox()).length;
  }

  /** 走行の開始。参加しない走行は何も保存せず、何も送らない。 */
  beginRun(id: RunIdentity): void {
    if (!id.rankingOptIn || !id.participantId || id.mode !== 'competition' || !this.enabled) return;
    const o = this.readOutbox();
    if (o[id.runId]) return;
    o[id.runId] = {
      start: {
        runId: id.runId,
        participantId: id.participantId,
        displayName: id.playerName,
        courseId: id.courseId,
        courseVersion: id.courseVersion,
        rulesVersion: id.rulesVersion,
        dogId: id.dogId,
        consent: true,
      },
      finish: null,
      startAcked: false,
      finishAcked: false,
      conflict: false,
    };
    this.writeOutbox(o);
  }

  /** 完走を一度だけ固定する。2回目以降は最初に固定した内容を使う。 */
  finishRun(result: RunResult): void {
    const o = this.readOutbox();
    const e = o[result.runId];
    if (!e || e.finish) return;
    e.finish = {
      runId: result.runId,
      participantId: e.start.participantId,
      courseId: result.courseId,
      courseVersion: result.courseVersion,
      rulesVersion: result.rulesVersion,
      dogId: result.dogId,
      recordCs: result.recordCs,
      timeScore: result.timeScore,
      trickScore: result.trickScore,
      total: result.total,
    };
    this.writeOutbox(o);
  }

  /** 送信待ちを送る。開始が未受領なら、同じ開始を先に送る。通信に失敗したものは次の機会に同じ内容を再送する。 */
  async flush(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const runId of Object.keys(this.readOutbox())) {
      const e = this.readOutbox()[runId];
      if (!e || e.conflict) continue;
      try {
        if (!e.startAcked) {
          const st = await this.transport.postStart(e.start);
          sent++;
          if (st === 'conflict' || st === 'rejected') {
            this.update(runId, (x) => (x.conflict = true));
            continue;
          }
          this.update(runId, (x) => (x.startAcked = true));
        }
        const cur = this.readOutbox()[runId];
        if (cur?.finish && !cur.finishAcked) {
          let st = await this.transport.postFinish(cur.finish);
          sent++;
          if (st === 'unknownStart') {
            await this.transport.postStart(cur.start);
            st = await this.transport.postFinish(cur.finish);
            sent += 2;
          }
          if (st === 'accepted' || st === 'duplicate') this.update(runId, (x) => (x.finishAcked = true));
          else if (st === 'conflict' || st === 'rejected') this.update(runId, (x) => (x.conflict = true));
        }
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }

  private update(runId: string, f: (e: OutboxEntry) => void): void {
    const o = this.readOutbox();
    if (!o[runId]) return;
    f(o[runId]);
    this.writeOutbox(o);
  }

  /** 順位表を読み込む。状態は 読み込み中 → 表示 / 空 / 失敗。失敗したら retry で同じ問い合わせをやり直す。 */
  async loadBoard(q: Omit<BoardQuery, 'limit'>, onState: (s: BoardState) => void): Promise<BoardState> {
    onState({ kind: 'loading' });
    try {
      const rows = (await this.transport.getBoard({ ...q, limit: BOARD_LIMIT })).slice(0, BOARD_LIMIT);
      const s: BoardState = rows.length ? { kind: 'ready', rows } : { kind: 'empty' };
      onState(s);
      return s;
    } catch (e) {
      const s: BoardState = { kind: 'error', message: e instanceof Error ? e.message : '読み込みに失敗しました' };
      onState(s);
      return s;
    }
  }
}
