import { describe, expect, test, vi } from 'vitest';
import { RankingClient, type BoardState, type FinishPayload } from '../src/ranking/client';
import { MockRankingServer, buildBoard } from '../src/ranking/mockServer';
import { MemoryStorage } from '../src/storage/records';
import { park } from '../src/content/courses/park';
import { RULES_VERSION } from '../src/game/rules';
import { timeScore } from '../src/game/scoring';
import { identity } from './helpers';
import type { RunIdentity, RunResult } from '../src/game/types';

const { fullCs, zeroCs } = park.timeScore;

function makeResult(id: RunIdentity, recordCs: number, trick: number): RunResult {
  const ts = timeScore(recordCs, fullCs, zeroCs);
  return {
    runId: id.runId,
    courseId: id.courseId,
    courseVersion: id.courseVersion,
    rulesVersion: id.rulesVersion,
    dogId: id.dogId,
    mode: id.mode,
    finishUs: recordCs * 10_000,
    recordCs,
    timeScore: ts,
    trickRaw: trick,
    trickScore: trick,
    total: ts + trick,
    jumpPoints: trick,
    railPoints: 0,
    streakBonus: 0,
    sections: [],
    rails: [],
    jumps: [],
    nearMiss: null,
    route: [],
    challengeDone: false,
    itemsTaken: [],
  };
}

const parkId = (over: Partial<RunIdentity>): RunIdentity => identity({ courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, ...over });

/** スタート時に名前と同意を固定して、走行の識別情報を作る（ui と同じ手順）。 */
function start(client: RankingClient, name: string, mode: RunIdentity['mode'], participantId: string, consent = true): RunIdentity {
  const opt = client.canParticipate(name, mode, consent);
  const id = parkId({ playerName: opt ? name.trim() : '', rankingOptIn: opt, participantId: opt ? participantId : null, mode });
  client.beginRun(id);
  return id;
}

describe('V17 任意の名前・再送', () => {
  test('受付時刻前の完走は失敗にせず、同じ内容を再送して受理する', async () => {
    const server = new MockRankingServer();
    const actualFinish = server.postFinish.bind(server);
    const finish = vi.spyOn(server, 'postFinish').mockResolvedValueOnce('tooEarly').mockImplementation(actualFinish);
    const store = new MemoryStorage();
    const client = new RankingClient(server, store, true);
    const id = start(client, 'はなこ', 'competition', 'p-hana');
    client.finishRun(makeResult(id, 9600, 1200));
    await client.flush();
    expect(client.submissionStatus(id.runId)).toBe('pending');
    expect(server.rows.size).toBe(0);
    await Promise.all([client.flush(), client.flush()]);
    expect(client.submissionStatus(id.runId)).toBe('accepted');
    expect(server.rows.size).toBe(1);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finish.mock.calls[0][0]).toEqual(finish.mock.calls[1][0]);
  });

  test('空欄で開始 → 結果で名前を追記しても、個人記録の送信も送信待ちも 0 件。練習も 0 件', async () => {
    const server = new MockRankingServer();
    const store = new MemoryStorage();
    const client = new RankingClient(server, store, true);
    const blank = start(client, '', 'competition', 'p1');
    client.finishRun(makeResult(blank, 9600, 1200));
    // 結果の画面で名前を入れても、過去の走行は公開しない。
    expect(client.canParticipate('たろう', 'competition', true)).toBe(true);
    const practice = start(client, 'たろう', 'practice', 'p1');
    client.finishRun(makeResult(practice, 9000, 1000));
    await client.flush();
    expect(server.calls).toBe(0);
    expect(client.outboxSize()).toBe(0);
    expect(store.keys().filter((k) => k.includes('Outbox'))).toEqual([]);
    // 順位表の閲覧は別に使える。
    const states: BoardState['kind'][] = [];
    await client.loadBoard({ courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'total' }, (s) => states.push(s.kind));
    expect(states).toEqual(['loading', 'empty']);
  });

  test('参加走行は開始時の名前を使う。開始・完走の応答が消えても、再読込して2回再送しても1件だけ', async () => {
    const server = new MockRankingServer();
    const store = new MemoryStorage();
    const client = new RankingClient(server, store, true);
    const id = start(client, 'はなこ', 'competition', 'p-hana');
    // 走行中に名前を変えても、開始時に固定した名前を使う。
    // 開始の応答が消える → 次の送信で同じ開始を再送し、受領済みになる。
    server.opts.dropResponses = 1;
    await client.flush();
    expect(server.starts.size).toBe(1);
    expect(client.pendingCount()).toBe(1);
    await client.flush();
    expect(server.starts.size).toBe(1);
    // 完走の応答が消える。
    client.finishRun(makeResult(id, 9600, 1200));
    server.opts.dropResponses = 1;
    await client.flush();
    expect(server.rows.size).toBe(1);
    expect(client.pendingCount()).toBe(1);
    // 再読込（新しいクライアントで同じ保存領域を読む）→ 2回再送
    const reloaded = new RankingClient(server, store, true);
    await reloaded.flush();
    await reloaded.flush();
    expect(server.rows.size).toBe(1);
    expect(reloaded.pendingCount()).toBe(0);
    const total = buildBoard([...server.rows.values()], { courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'total', limit: 30 });
    const time = buildBoard([...server.rows.values()], { courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'time', limit: 30 });
    expect(total.map((r) => [r.displayName, r.value])).toEqual([['はなこ', timeScore(9600, fullCs, zeroCs) + 1200]]);
    expect(time.map((r) => [r.displayName, r.value])).toEqual([['はなこ', 9600]]);
  });

  test('同じ走行 ID で違う値を送ると拒み、元の記録を残す', async () => {
    const server = new MockRankingServer();
    const client = new RankingClient(server, new MemoryStorage(), true);
    const id = start(client, 'じろう', 'competition', 'p-jiro');
    client.finishRun(makeResult(id, 9600, 1200));
    await client.flush();
    const forged: FinishPayload = { ...server.rows.get(id.runId)!, recordCs: 6000, timeScore: 5000, total: 6200 };
    delete (forged as Partial<typeof forged> & { displayName?: string; seq?: number }).displayName;
    delete (forged as Partial<typeof forged> & { seq?: number }).seq;
    expect(await server.postFinish(forged)).toBe('conflict');
    expect(server.rows.get(id.runId)!.recordCs).toBe(9600);
    // 計算の合わない値も拒む。
    const bad = parkId({ playerName: 'x', rankingOptIn: true, participantId: 'p-x' });
    await server.postStart({ runId: bad.runId, participantId: 'p-x', displayName: 'x', courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, dogId: 'shiba', consent: true });
    expect(await server.postFinish({ runId: bad.runId, participantId: 'p-x', courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, dogId: 'shiba', recordCs: 9600, timeScore: 4000, trickScore: 100, total: 4100 })).toBe('rejected');
  });

  test('先に完走だけが届いても、登録も別の走行への紐付けもしない（開始を先に再送する）', async () => {
    const server = new MockRankingServer();
    const f: FinishPayload = { runId: 'lonely', participantId: 'p', courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, dogId: 'shiba', recordCs: 9600, timeScore: 3400, trickScore: 0, total: 3400 };
    expect(await server.postFinish(f)).toBe('unknownStart');
    expect(server.rows.size).toBe(0);
    // クライアントは開始が未受領なら同じ開始を先に再送する。
    const client = new RankingClient(server, new MemoryStorage(), true);
    const id = start(client, 'さぶ', 'competition', 'p-sabu');
    client.finishRun(makeResult(id, 9600, 0));
    server.opts.failNext = 1;
    const first = await client.flush();
    expect(first.failed).toBe(1);
    expect(server.rows.size).toBe(0);
    await client.flush();
    expect(server.rows.size).toBe(1);
    expect([...server.starts.keys()]).toEqual([id.runId]);
  });

  test('同じ名前の別人を混ぜない（参加者識別子で分ける）', async () => {
    const server = new MockRankingServer();
    const a = new RankingClient(server, new MemoryStorage(), true);
    const b = new RankingClient(server, new MemoryStorage(), true);
    const ia = start(a, 'ぽち', 'competition', 'p-a');
    const ib = start(b, 'ぽち', 'competition', 'p-b');
    a.finishRun(makeResult(ia, 9600, 1000));
    b.finishRun(makeResult(ib, 9700, 900));
    await a.flush();
    await b.flush();
    const board = buildBoard([...server.rows.values()], { courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'total', limit: 30 });
    expect(board.length).toBe(2);
    expect(new Set(board.map((r) => r.participantId))).toEqual(new Set(['p-a', 'p-b']));
  });

  test('外部への接続を止めている間は、名前があっても何も送らず、端末内で完結する', async () => {
    const server = new MockRankingServer();
    const client = new RankingClient(server, new MemoryStorage(), false);
    const id = start(client, 'たろう', 'competition', 'p1');
    expect(id.rankingOptIn).toBe(false);
    client.finishRun(makeResult(id, 9600, 1200));
    await client.flush();
    expect(server.calls).toBe(0);
  });
});

describe('V18 順位と通信', () => {
  async function seed(server: MockRankingServer, entries: [string, number, number][]) {
    for (const [pid, recordCs, trick] of entries) {
      const client = new RankingClient(server, new MemoryStorage(), true);
      const id = parkId({ playerName: pid, rankingOptIn: true, participantId: pid });
      client.beginRun(id);
      client.finishRun(makeResult(id, recordCs, trick));
      await client.flush();
    }
  }

  test('総合とタイムを別々に集計し、同じ記録は同じ順位（1・1・3）。同じ人の複数走行は最高・最速の1件', async () => {
    const server = new MockRankingServer();
    await seed(server, [
      ['A', 9600, 1200],
      ['B', 9600, 1200],
      ['C', 10000, 1800],
      ['A', 9000, 0],
    ]);
    server.rows.set('old-run', {
      runId: 'old-run', participantId: 'A', displayName: 'A', seq: 0, courseId: 'park', courseVersion: 'park-1',
      rulesVersion: 'rules-1', dogId: 'shiba', recordCs: 7600, timeScore: 3400, trickScore: 4800, total: 8200,
    });
    const q = { courseId: 'park' as const, courseVersion: park.version, rulesVersion: RULES_VERSION, limit: 30 };
    const total = buildBoard([...server.rows.values()], { ...q, metric: 'total' });
    const time = buildBoard([...server.rows.values()], { ...q, metric: 'time' });
    expect(total.map((r) => [r.participantId, r.value, r.rank])).toEqual([
      ['C', timeScore(10000, fullCs, zeroCs) + 1800, 1],
      ['A', timeScore(9600, fullCs, zeroCs) + 1200, 2],
      ['B', timeScore(9600, fullCs, zeroCs) + 1200, 2],
    ]);
    expect(time.map((r) => [r.participantId, r.value, r.rank])).toEqual([
      ['A', 9000, 1],
      ['B', 9600, 2],
      ['C', 10000, 3],
    ]);
    const oldTotal = buildBoard([...server.rows.values()], { ...q, courseVersion: 'park-1', metric: 'total' });
    expect(oldTotal.map((r) => [r.participantId, r.value])).toEqual([['A', 8200]]);
  });

  test('同点 2 人なら 1・1・3。同じ順位の中は達成の順 → 参加者識別子の順で表示順を固定する', () => {
    const base = { courseId: 'park' as const, courseVersion: park.version, rulesVersion: RULES_VERSION, dogId: 'shiba' as const, timeScore: 3400, trickScore: 0 };
    const rows = [
      { ...base, runId: '1', participantId: 'zz', recordCs: 9600, total: 3400, displayName: 'zz', seq: 1 },
      { ...base, runId: '2', participantId: 'aa', recordCs: 9600, total: 3400, displayName: 'aa', seq: 1 },
      { ...base, runId: '3', participantId: 'mm', recordCs: 9700, total: 3300, displayName: 'mm', seq: 0 },
    ];
    const b = buildBoard(rows, { courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'time', limit: 30 });
    expect(b.map((r) => [r.participantId, r.rank])).toEqual([
      ['aa', 1],
      ['zz', 1],
      ['mm', 3],
    ]);
  });

  test('30 人目と 31 人目が同点でも、表示は最大 30 人（結果と詳細ページで同じ）', async () => {
    const server = new MockRankingServer();
    const entries: [string, number, number][] = [];
    for (let i = 0; i < 29; i++) entries.push([`p${String(i).padStart(2, '0')}`, 9000 + i * 10, 0]);
    entries.push(['p29', 9400, 0]);
    entries.push(['p30', 9400, 0]);
    await seed(server, entries);
    const client = new RankingClient(server, new MemoryStorage(), true);
    const s = await client.loadBoard({ courseId: 'park', courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'time' }, () => {});
    expect(s.kind).toBe('ready');
    if (s.kind === 'ready') {
      expect(s.rows.length).toBe(30);
      expect(s.rows[29].rank).toBe(30);
    }
  });

  test('読み込み中・空・失敗を区別し、失敗から再試行で戻る', async () => {
    const server = new MockRankingServer({ failNext: 1 });
    const client = new RankingClient(server, new MemoryStorage(), true);
    const q = { courseId: 'park' as const, courseVersion: park.version, rulesVersion: RULES_VERSION, metric: 'total' as const };
    const states: string[] = [];
    await client.loadBoard(q, (s) => states.push(s.kind));
    await client.loadBoard(q, (s) => states.push(s.kind));
    await seed(server, [['A', 9600, 0]]);
    await client.loadBoard(q, (s) => states.push(s.kind));
    expect(states).toEqual(['loading', 'error', 'loading', 'empty', 'loading', 'ready']);
  });
});
