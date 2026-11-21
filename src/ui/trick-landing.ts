import './trick-landing.css';
import './trick-name-flow.css';
import type { TrickLandingText } from '../view/trick-landing';
import { h } from './dom';
import { t, translateTrickName } from './i18n';

export function showTrickLanding(element: HTMLElement, landing: TrickLandingText, showName = true): void {
  const changes = [
    landing.switchCount > 0 ? `${t('対象切替')} ${landing.switchCount}` : '',
    landing.directionCount > 0 ? `${t('方向切替')} ${landing.directionCount}` : '',
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
      h('span', { class: 'trick-landing-name', 'data-testid': 'landing-trick-name' }, translateTrickName(landing.name))) : null,
    h('div', { class: 'trick-landing-points' },
      h('span', {
        class: `trick-landing-score${numeric ? ' is-numeric' : ''}`,
        'data-testid': 'landing-trick-score',
      }, landing.score, numeric ? h('small', {}, t('点')) : null),
      landing.full ? h('span', { class: 'trick-landing-full' }, t('回転満点')) : null,
      landing.switchBonus > 0
        ? h('span', { class: 'trick-landing-combo', 'data-testid': 'landing-combo' },
          h('strong', {}, `${t('連携')} ＋${landing.switchBonus.toLocaleString()} ${t('点')}`), changes ? h('small', {}, changes) : null)
        : null),
  ));
}

const MAX_TRICK_NAMES = 5;
const SCROLL_PX_PER_MS = 0.3145;
const TRICK_NAME_GAP = 14;

interface FlyingTrick {
  lane: HTMLElement;
  label: HTMLElement;
  animation: Animation;
  from: number;
}

function scrollKeyframes(from: number, width: number): Keyframe[] {
  return [{ transform: `translateX(${from}px)` }, { transform: `translateX(${-width}px)` }];
}

function scrollDuration(from: number, width: number): number {
  return Math.max(1, (from + width) / SCROLL_PX_PER_MS);
}

/** 先行する文字の末尾が入ってから、同じ段に次の技名を流す。 */
export class TrickNameFlow {
  private readonly lanes = Array.from({ length: MAX_TRICK_NAMES }, (_, i) =>
    h('div', { class: 'trick-name-lane', 'data-lane': i + 1 }));
  readonly element = h('div', { class: 'trick-name-flow', 'data-testid': 'trick-name-flow', role: 'log', 'aria-label': t('決めた技') }, this.lanes);
  private active: FlyingTrick[] = [];
  private width = 0;
  private paused = false;

  push(landing: TrickLandingText, tier: number): void {
    if (!landing.name.trim()) return;
    const flow = this.element.getBoundingClientRect();
    if (flow.width <= 0) return;
    this.width = flow.width;
    // 5件を超えたら、最も早く表示した技名の枠を明ける。
    if (this.active.length === MAX_TRICK_NAMES) this.remove(this.active[0]);

    let from = flow.width;
    const lane = this.lanes.find(row => {
      const previous = row.lastElementChild;
      if (!previous) return true;
      const trailingEdge = previous.getBoundingClientRect().right - flow.left;
      if (trailingEdge > flow.width) return false;
      from = Math.max(from, trailingEdge + TRICK_NAME_GAP);
      return true;
    })!;

    const level = Math.max(1, landing.landingLevel || tier * 2);
    const weight = 630 + level * 37;
    const saturation = 30 + level * 7;
    const label = h('div', {
      class: 'flying-trick',
      'data-testid': 'landing-trick-name',
      'data-target': landing.fxTarget ?? undefined,
      'data-level': level,
      style: `--flow-level:${level};--flow-weight:${weight};--flow-saturation:${saturation}%`,
    }, h('span', {}, translateTrickName(landing.name)));
    lane.append(label);
    const width = label.getBoundingClientRect().width;
    const animation = label.animate(scrollKeyframes(from, width), { duration: scrollDuration(from, width), fill: 'both' });
    const entry = { lane, label, animation, from };
    this.active.push(entry);
    if (this.paused) animation.pause();
    animation.onfinish = () => this.remove(entry);
  }

  private remove(entry: FlyingTrick): void {
    entry.animation.onfinish = null;
    entry.animation.cancel();
    entry.label.remove();
    this.active = this.active.filter(item => item !== entry);
  }

  /** 端末を回しても、同じ段の文字の間隔と流れる速さを保つ。 */
  resize(): void {
    if (!this.active.length) return;
    const width = this.element.getBoundingClientRect().width;
    if (width <= 0) return;
    const shift = width - this.width;
    this.width = width;
    const trailingEdges = new Map<HTMLElement, number>();
    for (const entry of this.active) {
      const { animation, label, lane } = entry;
      const x = entry.from - Number(animation.currentTime ?? 0) * SCROLL_PX_PER_MS + shift;
      const from = Math.max(x, trailingEdges.get(lane) ?? -Infinity);
      const labelWidth = label.getBoundingClientRect().width;
      trailingEdges.set(lane, from + labelWidth + TRICK_NAME_GAP);
      entry.from = from;
      const effect = animation.effect as KeyframeEffect;
      effect.setKeyframes(scrollKeyframes(from, labelWidth));
      effect.updateTiming({ duration: scrollDuration(from, labelWidth) });
      animation.currentTime = 0;
    }
  }

  clear(): void {
    for (const entry of this.active) this.remove(entry);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.element.dataset.paused = String(paused);
    for (const { animation } of this.active) {
      if (paused) animation.pause();
      else animation.play();
    }
  }
}
