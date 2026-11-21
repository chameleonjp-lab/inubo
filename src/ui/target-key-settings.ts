import type { FreeTarget } from '../game/free-motion';
import { DEFAULT_TARGET_KEYS, keyLabel, ROTATION_TARGETS, targetKeyFromEvent } from '../input/target-keys';
import type { Settings } from '../storage/records';
import { h } from './dom';
import { t } from './i18n';

export function renderTargetKeySettings(settings: Settings, save: () => void): HTMLElement {
  const buttons = new Map<FreeTarget, HTMLButtonElement>();
  let listening: FreeTarget | null = null;
  const refresh = () => {
    for (const [target, label] of ROTATION_TARGETS) {
      const button = buttons.get(target)!;
      const recording = listening === target;
      button.textContent = recording ? t('キーを押してください') : keyLabel(settings.targetKeys[target]);
      button.setAttribute('aria-label', t('{target}のキーを変更（{key}）', { target: t(label), key: button.textContent }));
      button.setAttribute('aria-pressed', String(recording));
    }
  };
  const controls = ROTATION_TARGETS.map(([target, label]) => {
    const button = h('button', {
      type: 'button', class: 'btn small', 'data-testid': `bind-key-${target}`,
      onclick: () => {
        button.focus();
        listening = target;
        refresh();
      },
      onblur: () => {
        if (listening !== target) return;
        listening = null;
        refresh();
      },
    });
    button.addEventListener('keydown', event => {
      if (listening !== target || event.isComposing) return;
      const key = targetKeyFromEvent(event);
      if (!key && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (key) {
        const bindings = settings.targetKeys;
        const occupied = ROTATION_TARGETS.find(([other]) => other !== target && bindings[other] === key);
        if (occupied) bindings[occupied[0]] = bindings[target];
        bindings[target] = key;
        save();
      }
      listening = null;
      refresh();
    });
    buttons.set(target, button);
    return h('div', { class: 'setting target-key-row' }, h('span', {}, t(label)), button);
  });
  refresh();
  return h('fieldset', { class: 'target-key-settings' },
    h('legend', {}, t('PCのキー割り当て')),
    h('p', { class: 'note' }, t('ボタンを選んでキーを押します。同じキーを選ぶと割り当てが入れ替わります。')),
    controls,
    h('button', {
      type: 'button', class: 'btn small', 'data-testid': 'reset-target-keys',
      onclick: () => {
        listening = null;
        settings.targetKeys = { ...DEFAULT_TARGET_KEYS };
        save();
        refresh();
      },
    }, t('初期キーに戻す')),
  );
}
