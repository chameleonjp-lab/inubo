import type { RunResult } from '../game/types';

/**
 * Xでシェア。結果の文には、今回の犬種・コース・完走タイム・総合点・確認済みの正式URLを1回ずつ入れる。
 * ホームの共有（ゲーム紹介）とは文を分ける。投稿は遊んだ人が決める（投稿画面を開くだけ）。
 * X の投稿画面の URL は公式文書の Web Intent（https://x.com/intent/tweet?text=...）。
 */

export const X_INTENT = 'https://x.com/intent/tweet';

/** 公開段階で確認した正式な URL。未確認のうちは null（共有文に URL を入れない）。 */
export function officialUrl(): string | null {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_OFFICIAL_URL;
  return v && /^https?:\/\//.test(v) ? v : null;
}

/** 完走タイムの表示（仕様書の例と同じく、秒と 0.01 秒で表す。例: 76.00秒）。 */
export function formatTime(recordCs: number): string {
  return `${Math.floor(recordCs / 100)}.${String(recordCs % 100).padStart(2, '0')}秒`;
}

export function resultShareText(r: RunResult, courseName: string, dogName: string, url: string | null): string {
  const lines = [`イヌボー｜${courseName}を${dogName}で完走！`, `タイム ${formatTime(r.recordCs)}／総合 ${r.total.toLocaleString('ja-JP')}点`];
  if (url) lines.push(url);
  return lines.join('\n');
}

export function homeShareText(url: string | null): string {
  const lines = ['イヌボー｜犬がスケボーになって街を滑るゲーム。技を決めるか、最速を狙うか。'];
  if (url) lines.push(url);
  return lines.join('\n');
}

export function intentUrl(text: string): string {
  return `${X_INTENT}?text=${encodeURIComponent(text)}`;
}

export interface ShareEnv {
  open: (url: string) => unknown;
  copy: (text: string) => Promise<void>;
}

/**
 * 投稿画面を開く。開けなければ同じ文のコピーへ進む。
 * 戻り値: 'opened' | 'copied' | 'manual'（コピーもできないので、文を画面に出して手で写してもらう）。
 */
export async function shareOnX(text: string, env: ShareEnv): Promise<'opened' | 'copied' | 'manual'> {
  let win: unknown = null;
  try {
    win = env.open(intentUrl(text));
  } catch {
    win = null;
  }
  if (win) return 'opened';
  try {
    await env.copy(text);
    return 'copied';
  } catch {
    return 'manual';
  }
}

/** 未完走（途中終了）の走行は完走結果として共有しない。 */
export function shareableResult(r: RunResult | null): r is RunResult {
  return !!r && r.mode === 'competition' && r.recordCs > 0;
}
