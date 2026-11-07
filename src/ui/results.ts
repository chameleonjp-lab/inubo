import { h, fmtInt } from './dom';
import { formatTime } from './share';
import { DOGS } from '../content/dogs';
import type { RunResult } from '../game/types';
import type { SaveOutcome } from '../storage/records';
import type { BoardState } from '../ranking/client';

/**
 * 結果の画面。総合点を最も大きく、その直下に今回の完走タイム・タイム点・技点を並べる（R75）。
 * 更新した記録だけを肉球の印で祝い（R69）、いちばん惜しかった区間と次に試せる操作を最大1件出す（R76）。
 */

export interface ResultsActions {
  retry: () => void;
  home: () => void;
  share: () => void;
  ranking: ((metric: 'total' | 'time', onState: (s: BoardState) => void) => void) | null;
}

export function renderResults(r: RunResult, courseName: string, saved: SaveOutcome, challengeLabel: string | null, act: ResultsActions): HTMLElement {
  const paw = (on: boolean, label: string) => (on ? h('span', { class: 'best-paw', 'aria-label': label, title: label }, '🐾 更新') : null);
  const sections = h(
    'ol',
    { class: 'sections', 'aria-label': '区間ごとの技点' },
    r.sections.map((s, i) =>
      h('li', { class: `sec sec-${s.state}`, title: `区間${i + 1}` }, h('span', { class: 'sec-n' }, String(i + 1)), h('span', { class: 'sec-p' }, s.state === 'scored' ? fmtInt(s.points) : s.state === 'missed' ? '－' : '・')),
    ),
  );
  const near = r.nearMiss
    ? h('div', { class: 'near-miss', 'data-testid': 'near-miss' }, h('h3', {}, `惜しかった区間: ${r.nearMiss.sectionNumber}`), h('p', {}, r.nearMiss.hint))
    : null;
  const stamp = saved.newStamp ? h('p', { class: 'stamp-new' }, `🐾 ${DOGS[r.dogId].name}の「${courseName}」完走スタンプ`) : null;
  const challenge = saved.newChallenge && challengeLabel ? h('p', { class: 'stamp-new' }, `🐾 寄り道課題を達成: ${challengeLabel}`) : null;
  const notSaved = saved.attempted && !saved.saved ? h('p', { class: 'warn' }, 'この端末に記録を保存できませんでした。今回の結果はこの画面で確認できます。') : null;

  const board = h('div', { class: 'board hidden', 'data-testid': 'board' });
  let rankingBlock: HTMLElement | null = null;
  if (act.ranking) {
    const show = (metric: 'total' | 'time') => {
      board.classList.remove('hidden');
      act.ranking!(metric, (s) => renderBoard(board, s, metric, () => show(metric)));
    };
    rankingBlock = h(
      'div',
      { class: 'ranking-tabs' },
      h('button', { class: 'btn small', onclick: () => show('total') }, 'ランキング（総合）'),
      h('button', { class: 'btn small', onclick: () => show('time') }, 'ランキング（タイム）'),
    );
  }

  return h(
    'section',
    { class: 'screen results', 'data-testid': 'results' },
    h('p', { class: 'res-course' }, `${courseName}｜${DOGS[r.dogId].name}`),
    h('div', { class: 'total-wrap' }, h('div', { class: 'total', 'data-testid': 'total' }, fmtInt(r.total)), h('span', { class: 'total-unit' }, '点'), paw(saved.newBestScore, '総合の自己最高を更新')),
    h(
      'dl',
      { class: 'breakdown' },
      h('div', { class: 'row reveal', style: 'animation-delay:.2s' }, h('dt', {}, '完走タイム'), h('dd', { 'data-testid': 'time' }, formatTime(r.recordCs), paw(saved.newBestTime, '完走タイムの自己最速を更新'))),
      h('div', { class: 'row reveal', style: 'animation-delay:.45s' }, h('dt', {}, 'タイム点'), h('dd', { 'data-testid': 'time-score' }, fmtInt(r.timeScore))),
      h('div', { class: 'row reveal', style: 'animation-delay:.7s' }, h('dt', {}, '技点'), h('dd', { 'data-testid': 'trick-score' }, fmtInt(r.trickScore))),
    ),
    h('p', { class: 'trick-detail' }, `ジャンプの技 ${fmtInt(r.jumpPoints)}・手すり ${fmtInt(r.railPoints)}・連続 ${fmtInt(r.streakBonus)}${r.trickRaw > r.trickScore ? `（上限 5,000 を適用）` : ''}`),
    sections,
    near,
    stamp,
    challenge,
    notSaved,
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', 'data-testid': 'retry', onclick: act.retry }, 'もう一度（同じ犬・コース）'),
      h('button', { class: 'btn x-share', 'data-testid': 'share', onclick: act.share }, 'Xでシェア'),
      h('button', { class: 'btn', 'data-testid': 'home', onclick: act.home }, 'ホームへ'),
    ),
    h('div', { class: 'share-fallback hidden', 'data-testid': 'share-fallback' }),
    rankingBlock,
    board,
  );
}

export function renderBoard(el: HTMLElement, s: BoardState, metric: 'total' | 'time', retry: () => void): void {
  el.replaceChildren();
  el.append(h('h3', {}, metric === 'total' ? '総合スコアの順位（上位30人）' : '完走タイムの順位（上位30人）'));
  if (s.kind === 'loading') el.append(h('p', { 'data-state': 'loading' }, '読み込み中…'));
  else if (s.kind === 'empty') el.append(h('p', { 'data-state': 'empty' }, 'まだ記録がありません。'));
  else if (s.kind === 'error') el.append(h('p', { 'data-state': 'error' }, '読み込めませんでした。'), h('button', { class: 'btn small', onclick: retry }, '再試行'));
  else if (s.kind === 'ready') {
    el.append(
      h(
        'ol',
        { class: 'board-list', 'data-state': 'ready' },
        s.rows.map((r) => h('li', {}, h('span', { class: 'rank' }, `${r.rank}位`), h('span', { class: 'name' }, r.displayName), h('span', { class: 'dog' }, DOGS[r.dogId].name), h('span', { class: 'val' }, metric === 'total' ? `${fmtInt(r.value)}点` : formatTime(r.value)))),
      ),
    );
  }
}
