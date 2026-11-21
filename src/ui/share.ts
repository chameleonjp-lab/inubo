import { language, t } from './i18n';
import type { RunResult } from '../game/types';

/**
 * Xでシェア。結果の文には、今回の犬種・コース・完走タイム・総合点・確認済みの正式URLを1回ずつ入れる。
 * ホームの共有（ゲーム紹介）とは文を分ける。投稿は遊んだ人が決める（投稿画面を開くだけ）。
 * X の投稿画面には本文とリンクを別の項目で渡す。
 */

export const X_INTENT = 'https://x.com/intent/tweet';

/** 公開段階で確認した正式な URL。未確認のうちは null（共有文に URL を入れない）。 */
export function officialUrl(): string | null {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_OFFICIAL_URL;
  return v && /^https?:\/\//.test(v) ? v : null;
}

/** 完走タイムの表示（仕様書の例と同じく、秒と 0.01 秒で表す。例: 76.00秒）。 */
export function formatTime(recordCs: number, unit = true): string {
  const time = `${Math.floor(recordCs / 100)}.${String(recordCs % 100).padStart(2, '0')}`;
  if (!unit) return time;
  return language() === 'ja' ? time + '秒' : `${(recordCs / 100).toLocaleString(language(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('秒')}`;
}

export function resultShareText(r: RunResult, courseName: string, dogName: string, url: string | null): string {
  const lines = [`イヌボー｜${courseName}を${dogName}で完走！`, `タイム ${formatTime(r.recordCs)}／総合 ${r.total.toLocaleString('ja-JP')}点`];
  if (language() !== 'ja') lines.splice(0, 2, `${t('イヌボー')}｜${t(courseName)} · ${t(dogName)}`, `${t('タイム')} ${formatTime(r.recordCs)} · ${t('総合')} ${r.total.toLocaleString(language())} ${t('点')}`);
  if (url) lines.push(url);
  return lines.join('\n');
}

export function homeShareText(url: string | null): string {
  const lines = ['イヌボー｜犬がスケボーになって街を滑るゲーム。技を決めるか、最速を狙うか。'];
  if (language() !== 'ja') lines[0] = t('イヌボー') + '｜' + t('犬のスケボー');
  if (url) lines.push(url);
  return lines.join('\n');
}

/** 共有画像を追加する前に参照された URL と区別するため、X で共有するリンクを固定する。 */
export function xShareUrl(url: string | null): string | null {
  if (!url) return null;
  const link = new URL(url);
  link.searchParams.set('share', '1');
  return link.href;
}

export function intentUrl(text: string, url: string | null = null): string {
  const intent = new URL(X_INTENT);
  intent.searchParams.set('text', text);
  if (url) intent.searchParams.set('url', url);
  return intent.href;
}

export function shareTextWithLink(text: string, url: string | null): string {
  return url ? `${text}\n${url}` : text;
}

export interface ShareEnv {
  open: (url: string) => unknown;
  copy: (text: string) => Promise<void>;
}

/**
 * 投稿画面を開く。開けなければ同じ文のコピーへ進む。
 * 戻り値: 'opened' | 'copied' | 'manual'（コピーもできないので、文を画面に出して手で写してもらう）。
 */
export async function shareOnX(text: string, env: ShareEnv, url: string | null = null): Promise<'opened' | 'copied' | 'manual'> {
  let win: unknown = null;
  try {
    win = env.open(intentUrl(text, url));
  } catch {
    win = null;
  }
  if (win) return 'opened';
  try {
    await env.copy(shareTextWithLink(text, url));
    return 'copied';
  } catch {
    return 'manual';
  }
}

/** 未完走（途中終了）の走行は完走結果として共有しない。 */
export function shareableResult(r: RunResult | null): r is RunResult {
  return !!r && r.mode === 'competition' && r.recordCs > 0;
}
