import './trick-landing.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';

export function showTrickLanding(element: HTMLElement, landing: TrickLandingText): void {
  const changes = [
    landing.switchCount > 0 ? `対象切替 ${landing.switchCount}回` : '',
    landing.directionCount > 0 ? `方向切替 ${landing.directionCount}回` : '',
  ].filter(Boolean).join('・');
  const numeric = landing.score.startsWith('＋');
  element.replaceChildren(h('div', {
    class: 'trick-landing-card',
    style: `--fx-level:${landing.landingLevel}`,
    'data-testid': 'trick-fx-card',
    'data-fx-target': landing.fxTarget ?? 'none',
    'data-fx-f': landing.emphasisId ?? '',
    'data-fx-a': landing.trailId ?? '',
    'data-fx-l': landing.landingId ?? '',
    'data-fx-level': String(landing.landingLevel),
  },
    h('div', { class: 'trick-landing-title' },
      h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, landing.name)),
    h('div', { class: 'trick-landing-points' },
      h('span', {
        class: `trick-landing-score${numeric ? ' is-numeric' : ''}`,
        'data-testid': 'landing-trick-score',
      }, landing.score, numeric ? h('small', {}, '点') : null),
      landing.full ? h('span', { class: 'trick-landing-full' }, '回転満点') : null,
      landing.switchBonus > 0
        ? h('span', { class: 'trick-landing-combo', 'data-testid': 'landing-combo' },
          h('strong', {}, `連携 ＋${landing.switchBonus.toLocaleString('ja-JP')}点`), changes ? h('small', {}, changes) : null)
        : null),
  ));
}
