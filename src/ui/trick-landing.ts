import './trick-landing.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';

export function showTrickLanding(element: HTMLElement, landing: TrickLandingText): void {
  const fx = landing.fx;
  element.dataset.trickFx = fx.id;
  element.replaceChildren(h('div', {
    class: 'trick-landing-card',
    'data-fx-tier': String(fx.tier),
    'data-fx-motion': fx.motion,
    'data-fx-burst': fx.burst,
    'data-testid': 'trick-fx-card',
  },
    h('span', { class: 'trick-fx-flight', 'aria-hidden': 'true' }),
    h('span', { class: 'trick-fx-impact', 'aria-hidden': 'true' }),
    h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, landing.name),
    landing.switchBonus > 0
      ? h('span', { class: 'trick-landing-combo', 'data-testid': 'landing-combo' },
        `切替 ${landing.switchCount}連携　＋${landing.switchBonus.toLocaleString('ja-JP')}点`)
      : null,
    h('span', { class: 'trick-landing-score', 'data-testid': 'landing-trick-score' },
      landing.full ? h('span', { class: 'trick-landing-full' }, '回転満点') : null, landing.score),
  ));
}
