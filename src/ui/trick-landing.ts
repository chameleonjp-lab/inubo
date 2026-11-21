import './trick-landing.css';
import './trick-name-flow.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';

export function showTrickLanding(element: HTMLElement, landing: TrickLandingText, showName = true): void {
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
    showName ? h('div', { class: 'trick-landing-title' },
      h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, landing.name)) : null,
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

const TRICK_NAME_LANE_COUNT = 5;

/** 連続した技名を上から順に流し、満席なら先頭の段から入れ替える。 */
export class TrickNameFlow {
  private readonly lanes = Array.from({ length: TRICK_NAME_LANE_COUNT }, (_, i) =>
    h('div', { class: 'trick-name-lane', 'data-lane': i + 1 }));
  readonly element = h('div', { class: 'trick-name-flow', 'data-testid': 'trick-name-flow', role: 'log', 'aria-label': '決めた技' }, this.lanes);
  private next = 0;

  push(landing: TrickLandingText, tier: number): void {
    if (!landing.name.trim()) return;
    if (this.lanes.every(lane => !lane.firstChild)) this.next = 0;
    const lane = this.lanes[this.next];
    this.next = (this.next + 1) % this.lanes.length;
    const level = Math.max(1, landing.landingLevel || tier * 2);
    const weight = 630 + level * 37;
    const saturation = 30 + level * 7;
    const duration = 5.8 + Math.min(1.8, landing.name.length * 0.034);
    const label = h('div', {
      class: 'flying-trick',
      'data-testid': 'landing-trick-name',
      'data-target': landing.fxTarget ?? undefined,
      'data-level': level,
      style: `--flow-level:${level};--flow-weight:${weight};--flow-saturation:${saturation}%;--flow-time:${duration}s`,
    }, h('span', {}, landing.name));
    label.addEventListener('animationend', event => {
      if (event.target === label) label.remove();
    });
    lane.replaceChildren(label);
  }

  setPaused(paused: boolean): void {
    if (this.element.dataset.paused !== String(paused)) this.element.dataset.paused = String(paused);
  }
}
