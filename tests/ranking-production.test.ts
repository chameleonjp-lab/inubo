import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BoardQuery, FinishPayload, StartSnapshot } from '../src/ranking/client';
import { createProductionTransport } from '../src/ranking/production';

const endpoint = 'https://standalone-test.supabase.co';
const publicKey = 'sb_publishable_test_only';
const identity = {
  runId: '2e4a7ba0-d67c-4cf2-97b6-f494fe406c6a',
  participantId: 'b26eec50-1f2f-477b-9d4b-b3631d67dc17',
  courseId: 'park', courseVersion: 'park-1', rulesVersion: 'rules-1', dogId: 'shiba',
} as const;
const start: StartSnapshot = { ...identity, displayName: 'ぽち', consent: true };
const finish: FinishPayload = { ...identity, recordCs: 7600, timeScore: 3400, trickScore: 1200, total: 4600 };
const board: BoardQuery = { courseId: 'park', courseVersion: 'park-1', rulesVersion: 'rules-1', metric: 'total', limit: 30 };

function configure(url = endpoint, key = publicKey) {
  vi.stubEnv('VITE_INUBO_SUPABASE_URL', url);
  vi.stubEnv('VITE_INUBO_SUPABASE_PUBLISHABLE_KEY', key);
  return createProductionTransport();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('公開順位の通信', () => {
  test('接続先が未設定か安全でない場合は通信を有効にしない', () => {
    expect(configure('', '')).toBeNull();
    expect(configure(endpoint, '')).toBeNull();
    expect(configure('http://standalone-test.supabase.co')).toBeNull();
    expect(configure(`${endpoint}/unexpected`)).toBeNull();
    expect(configure(endpoint, 'sb_secret_never')).toBeNull();
  });

  test('開始と完走を犬スケ専用の異なる窓口に送り、再送を示す応答を返す', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json('accepted'))
      .mockResolvedValueOnce(Response.json('duplicate'));
    vi.stubGlobal('fetch', fetch);
    const transport = configure()!;
    await expect(transport.postStart(start)).resolves.toBe('accepted');
    await expect(transport.postFinish(finish)).resolves.toBe('duplicate');

    const [startCall, finishCall] = fetch.mock.calls;
    expect(startCall[0]).toBe(`${endpoint}/rest/v1/rpc/inubo_ranking_start`);
    expect(finishCall[0]).toBe(`${endpoint}/rest/v1/rpc/inubo_ranking_finish`);
    for (const call of [startCall, finishCall]) {
      expect(call[1]).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('apikey')).toBe(publicKey);
      expect(headers.has('authorization')).toBe(false);
    }
    expect(JSON.parse(String(startCall[1]?.body))).toEqual({
      p_run_id: identity.runId, p_participant_id: identity.participantId, p_course_id: 'park',
      p_course_version: 'park-1', p_rules_version: 'rules-1', p_dog_id: 'shiba', p_display_name: 'ぽち', p_consent: true,
    });
    expect(JSON.parse(String(finishCall[1]?.body))).toEqual({
      p_run_id: identity.runId, p_participant_id: identity.participantId, p_course_id: 'park',
      p_course_version: 'park-1', p_rules_version: 'rules-1', p_dog_id: 'shiba',
      p_record_cs: 7600, p_time_score: 3400, p_trick_score: 1200, p_total: 4600,
    });
  });

  test('順位の問い合わせに参加者の情報を付けず、公開する4項目だけを受け取る', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([
      { rank: 1, display_name: 'ぽち', value: 4600, dog_id: 'shiba', participant_id: 'internal-id', achieved_seq: 123 },
    ]));
    vi.stubGlobal('fetch', fetch);
    const transport = configure()!;
    await expect(transport.getBoard(board)).resolves.toEqual([
      { rank: 1, displayName: 'ぽち', value: 4600, dogId: 'shiba' },
    ]);
    expect(fetch.mock.calls[0][0]).toBe(`${endpoint}/rest/v1/rpc/inubo_ranking_board`);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      p_course_id: 'park', p_course_version: 'park-1', p_rules_version: 'rules-1', p_metric: 'total', p_limit: 30,
    });
  });

  test('サーバー上で走行時間が足りない応答は再送待ちとして渡す', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json('tooEarly')));
    await expect(configure()!.postFinish(finish)).resolves.toBe('tooEarly');
  });

  test('表示できない名前の行は飛ばし、ほかの行はサーバーの順位で表示する', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([
      { rank: 1, display_name: 'ぽち', value: 4600, dog_id: 'shiba' },
      { rank: 2, display_name: '\uFEFF\u00A0', value: 4400, dog_id: 'corgi' },
      { rank: 3, display_name: 'はな', value: 4100, dog_id: 'whippet' },
    ])));
    await expect(configure()!.getBoard(board)).resolves.toEqual([
      { rank: 1, displayName: 'ぽち', value: 4600, dogId: 'shiba' },
      { rank: 3, displayName: 'はな', value: 4100, dogId: 'whippet' },
    ]);
  });

  test('HTTP失敗や不正な応答は成功や空の順位表として扱わない', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('temporary error', { status: 503 }))
      .mockResolvedValueOnce(Response.json('unexpected'))
      .mockResolvedValueOnce(Response.json([{ rank: 1, display_name: 'ぽち', value: -1, dog_id: 'shiba' }])));
    const transport = configure()!;
    await expect(transport.postStart(start)).rejects.toThrow();
    await expect(transport.postFinish(finish)).rejects.toThrow();
    await expect(transport.getBoard(board)).rejects.toThrow();
  });
});
