import { BOARD_LIMIT, type BoardQuery, type BoardRow, type FinishPayload, type SendStatus, type StartSnapshot, type Transport } from './client';

type Endpoint = 'inubo_ranking_start' | 'inubo_ranking_finish' | 'inubo_ranking_board';

const networkError = () => new Error('ランキングに接続できませんでした。');

function courseFields(input: Pick<BoardQuery, 'courseId' | 'courseVersion' | 'rulesVersion'>) {
  return { p_course_id: input.courseId, p_course_version: input.courseVersion, p_rules_version: input.rulesVersion };
}

function runFields(input: StartSnapshot | FinishPayload) {
  return { ...courseFields(input), p_run_id: input.runId, p_participant_id: input.participantId, p_dog_id: input.dogId };
}

function sendStatus(value: unknown): SendStatus {
  if (value === 'accepted' || value === 'duplicate' || value === 'conflict' || value === 'unknownStart' || value === 'rejected' || value === 'tooEarly') return value;
  throw networkError();
}

function boardRow(value: unknown, metric: BoardQuery['metric']): BoardRow | null {
  if (!value || typeof value !== 'object') return null;
  const { rank, display_name, value: score, dog_id } = value as Record<string, unknown>;
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > BOARD_LIMIT
    || typeof display_name !== 'string' || !display_name.trim() || display_name.length > 32
    || typeof score !== 'number' || !Number.isInteger(score) || score < (metric === 'time' ? 1 : 0)
    || score > (metric === 'time' ? 2_147_483_647 : 10_000)
    || (dog_id !== 'shiba' && dog_id !== 'corgi' && dog_id !== 'whippet')) return null;
  return { rank, displayName: display_name, value: score, dogId: dog_id };
}

/** 本番の接続先と公開用のキーを設定したビルドだけで使う。管理用のキーは受け付けない。 */
export function createProductionTransport(): Transport | null {
  const rawUrl = import.meta.env.VITE_INUBO_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_INUBO_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  const api = `${url.origin}/rest/v1/rpc/`;

  async function request(endpoint: Endpoint, fields: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${api}${endpoint}`, {
        method: 'POST',
        headers: { apikey: key!, 'content-type': 'application/json' },
        body: JSON.stringify(fields),
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok) throw networkError();
      return await response.json() as unknown;
    } catch {
      // 送信を受領した扱いにせず、後で同じ記録を再送できるようにする。
      throw networkError();
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async postStart(s) {
      return sendStatus(await request('inubo_ranking_start', { ...runFields(s), p_display_name: s.displayName, p_consent: s.consent }));
    },
    async postFinish(f) {
      return sendStatus(await request('inubo_ranking_finish', {
        ...runFields(f), p_record_cs: f.recordCs, p_time_score: f.timeScore, p_trick_score: f.trickScore, p_total: f.total,
      }));
    },
    async getBoard(q) {
      const result = await request('inubo_ranking_board', { ...courseFields(q), p_metric: q.metric, p_limit: q.limit });
      if (!Array.isArray(result) || result.length > BOARD_LIMIT) throw networkError();
      const rows = result.map((row: unknown) => boardRow(row, q.metric)).filter((row) => row !== null);
      if (result.length > 0 && rows.length === 0) throw networkError();
      return rows;
    },
  };
}
