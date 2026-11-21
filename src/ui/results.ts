import { language, t } from './i18n';
import { dogEffectStyle } from '../content/dog-effects';
import './result-celebration.css';
import { resultCelebration } from './result-celebration';
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
  const paw = (on: boolean, label: string) => (on ? h('span', { class: 'best-paw', 'aria-label': language() === 'ja' ? label : t('更新'), title: language() === 'ja' ? label : t('更新') }, `🐾 ${t('更新')}`) : null);
  const celebration = resultCelebration(r.total);
  const ornaments = Array.from({ length: celebration.ornaments }, (_, i) => {
    const pair = Math.floor(i / 2);
    const row = (pair * 5 + i % 2 * 2) % 13;
    return h('span', {
      class: 'result-ornament',
      style: `--ornament-row:${row};--ornament-column:${Math.floor(pair / 6)}`,
    }, celebration.band < 3 ? '·' : celebration.band < 5 ? '✦' : pair % 3 === 0 ? '✧' : '✦');
  });
  const sections = r.sections.length ? h(
    'ol',
    { class: 'sections', 'aria-label': '区間ごとの技点' },
    r.sections.map((s, i) =>
      h('li', { class: `sec sec-${s.state}`, title: `区間${i + 1}` }, h('span', { class: 'sec-n' }, String(i + 1)), h('span', { class: 'sec-p' }, s.state === 'scored' ? fmtInt(s.points) : s.state === 'missed' ? '－' : '・')),
    ),
  ) : null;
  const near = r.nearMiss
    ? h('div', { class: 'near-miss', 'data-testid': 'near-miss' }, h('h3', {}, `惜しかった区間: ${r.nearMiss.sectionNumber}`), h('p', {}, r.nearMiss.hint))
    : null;
  const stamp = saved.newStamp ? h('p', { class: 'stamp-new' }, `🐾 ${t('完走スタンプ')} · ${t(DOGS[r.dogId].name)} · ${t(courseName)}`) : null;
  const challenge = saved.newChallenge && challengeLabel ? h('p', { class: 'stamp-new' }, `🐾 ${t('寄り道課題を達成')}${language() === 'ja' ? ' · ' + challengeLabel : ''}`) : null;
  const notSaved = saved.attempted && !saved.saved ? h('p', { class: 'warn' }, t('記録を保存できませんでした。')) : null;

  const status = h('p', { class: 'ranking-status', 'aria-live': 'polite' });
  const board = h('div', { class: 'board', 'data-testid': 'board', 'aria-live': 'polite' });
  const detailURL = new URL('https://chameleonjp-lab.github.io/chameleonjp_lab/inubo-ranking.html');
  detailURL.searchParams.set('lang', language());
  if (act.ranking) {
    let request = 0;
    const show = () => {
      const current = ++request;
      act.ranking!('total', state => {
        if (request === current) renderBoard(board, state, 'total', show);
      });
    };
    board.addEventListener('ranking-updated', show);
    show();
  }

  return h(
    'section',
    { class: 'screen results', 'data-testid': 'results', style: dogEffectStyle(r.dogId) },
    h('p', { class: 'res-course' }, `${t(courseName)}｜${t(DOGS[r.dogId].name)}`),
    h('div', { class: 'result-celebration', 'data-result-stage': celebration.stage, 'data-result-band': celebration.band, 'data-testid': 'result-celebration' },
      h('div', { class: 'result-ornaments', 'aria-hidden': 'true' }, ornaments),
      h('div', { class: 'total-wrap' }, h('div', { class: 'total', 'data-testid': 'total' }, fmtInt(r.total)), h('span', { class: 'total-unit' }, t('点')), paw(saved.newBestScore, '総合の自己最高を更新')),
      h('h2', { class: 'result-title', 'data-testid': 'result-title' }, language() === 'ja' ? celebration.title : t('称号 {n}', { n: celebration.stage })),
    ),
    h(
      'dl',
      { class: 'breakdown' },
      h('div', { class: 'row reveal', style: 'animation-delay:.2s' }, h('dt', {}, t('完走タイム')), h('dd', { 'data-testid': 'time' }, formatTime(r.recordCs), paw(saved.newBestTime, '完走タイムの自己最速を更新'))),
      h('div', { class: 'row reveal', style: 'animation-delay:.45s' }, h('dt', {}, t('タイム点')), h('dd', { 'data-testid': 'time-score' }, fmtInt(r.timeScore))),
      h('div', { class: 'row reveal', style: 'animation-delay:.7s' }, h('dt', {}, t('技点')), h('dd', { 'data-testid': 'trick-score' }, fmtInt(r.trickScore))),
    ),
    h('p', { class: 'trick-detail' }, t('ジャンプの技 {jump}・手すりと塀 {rail}・連続 {combo}', { jump: fmtInt(r.jumpPoints), rail: fmtInt(r.railPoints), combo: fmtInt(r.streakBonus) })),
    sections,
    near,
    stamp,
    challenge,
    notSaved,
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', 'data-testid': 'retry', onclick: act.retry }, t('再スタート')),
      h('button', { class: 'btn x-share', 'data-testid': 'share', onclick: act.share }, t('Xでシェア')),
    ),
    h('div', { class: 'share-fallback hidden', 'data-testid': 'share-fallback' }),
    act.ranking ? status : null,
    act.ranking ? board : null,
    h('div', { class: 'actions result-bottom' },
      act.ranking ? h('a', { class: 'btn', href: detailURL.href, 'data-testid': 'detail-ranking' }, t('詳細ランキング')) : null,
      h('button', { class: 'btn', 'data-testid': 'home', onclick: act.home }, t('ホームへ'))),

  );
}

export function renderBoard(el: HTMLElement, s: BoardState, metric: 'total' | 'time', retry: () => void): void {
  el.replaceChildren();
  el.append(h('h3', {}, `${t('上位30人')} · ${t(metric === 'total' ? '総合' : 'タイム')}`));
  if (s.kind === 'loading') el.append(h('p', { 'data-state': 'loading' }, t('読み込み中…')));
  else if (s.kind === 'empty') el.append(h('p', { 'data-state': 'empty' }, t('まだ記録がありません。')));
  else if (s.kind === 'error') el.append(h('p', { 'data-state': 'error' }, t('読み込めませんでした。')), h('button', { class: 'btn small', onclick: retry }, t('再試行')));
  else if (s.kind === 'ready') {
    el.append(
      h(
        'ol',
        { class: 'board-list', 'data-state': 'ready', tabindex: 0, 'aria-label': t('上位30人') },
        s.rows.map((r) => h('li', {}, h('span', { class: 'rank' }, t('{n}位', { n: fmtInt(r.rank) })), h('span', { class: 'name' }, r.displayName), h('span', { class: 'dog' }, t(DOGS[r.dogId].name)), h('span', { class: 'val' }, metric === 'total' ? `${fmtInt(r.value)} ${t('点')}` : formatTime(r.value)))),
      ),
    );
  }
}
