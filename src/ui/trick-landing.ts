import './trick-landing.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';

/**
 * 着地の技名・点・連携点の表示。81種類の着地L の段階と対象を data-fx-* に載せ、文字の飾りだけを変える。
 * 大きな光は3D画面の床に描くので、ここでは文字を読みやすく保つ。
 */
export function showTrickLanding(element: HTMLElement, landing: TrickLandingText): void {
  element.dataset.fxTarget = landing.fxTarget ?? '';
  element.dataset.fxLanding = landing.landingId ?? '';
  element.replaceChildren(h('div', {
    class: 'trick-landing-card',
    'data-testid': 'trick-fx-card',
    'data-fx-target': landing.fxTarget ?? 'none',
    'data-fx-f': landing.emphasisId ?? '',
    'data-fx-a': landing.trailId ?? '',
    'data-fx-l': landing.landingId ?? '',
    'data-fx-level': String(landing.landingLevel),
  },
    h('span', { class: 'trick-fx-mark', 'aria-hidden': 'true' }),
    h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, landing.name),
    landing.switchBonus > 0
      ? h('span', { class: 'trick-landing-combo', 'data-testid': 'landing-combo' },
        `切替 ${landing.switchCount}連携　＋${landing.switchBonus.toLocaleString('ja-JP')}点`)
      : null,
    h('span', { class: 'trick-landing-score', 'data-testid': 'landing-trick-score' },
      landing.full ? h('span', { class: 'trick-landing-full' }, '回転満点') : null, landing.score),
  ));
}
