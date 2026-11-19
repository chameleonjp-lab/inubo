import './trick-landing.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';

export function showTrickLanding(element: HTMLElement, landing: TrickLandingText): void {
  element.replaceChildren(h('div', { class: 'trick-landing-card' },
    h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, landing.name),
    h('span', { class: 'trick-landing-score', 'data-testid': 'landing-trick-score' },
      landing.full ? h('span', { class: 'trick-landing-full' }, '満点') : null, landing.score),
  ));
}
