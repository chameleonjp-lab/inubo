import { messages } from './locale-messages';
import { help } from './locale-help';
import { COMBO_TRICKS, DIRECTION_NAMES, PAIR_TRICKS, SINGLE_TRICKS, freeTrickName } from '../game/free-trick-catalog';
import type { FreeTarget } from '../game/free-motion';
import type { StorageLike } from '../storage/records';

export const LANGUAGES = [
  ['ja', '日本語'], ['en', 'English'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)'], ['zh-Hans', '简体中文'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['ko', '한국어'], ['ru', 'Русский'], ['it', 'Italiano'], ['zh-Hant', '繁體中文'],
  ['id', 'Bahasa Indonesia'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'],
] as const;
export type Language = typeof LANGUAGES[number][0];
const KEY = 'inubo:v1:language';
const rows = (messages.trim() + '\n' + help.trim()).split('\n').map(line => line.split('|'));
export const helpParagraphs = help.trim().split('\n').map(line => line.split('|')[0]);
const catalogue = new Map(rows.map(row => [row[0], row]));
let current: Language = 'ja';
let languageStore: StorageLike | undefined;

export function language(): Language { return current; }

export function initLanguage(store: StorageLike): void {
  languageStore = store;
  const param = new URLSearchParams(window.location.search).get('lang');
  let stored: string | null = null;
  try { stored = store.getItem(KEY); } catch { /* 設定を保持できない端末でも遊べる */ }
  const selected = LANGUAGES.find(([id]) => id === param) ?? LANGUAGES.find(([id]) => id === stored);
  applyLanguage(selected?.[0] ?? 'ja');
}

export function setLanguage(next: Language): void {
  applyLanguage(next);
  try { languageStore?.setItem(KEY, next); } catch { /* 設定の保存に失敗しても操作を続ける */ }
}

function applyLanguage(next: Language): void {
  current = next;
  if (typeof document === 'undefined') return;
  document.documentElement.lang = next;
  document.title = t('イヌボー') + '｜' + t('犬のスケボー');
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const value = catalogue.get(key)?.[LANGUAGES.findIndex(([id]) => id === current)] ?? key;
  return value.replace(/\{(\w+)\}/g, (token, name: string) => String(params[name] ?? token));
}

const subjects: Record<FreeTarget, string> = { common: '両方', dog: '犬', rider: '人' };
const tricks = new Map<string, { subject: string; motion: string[] }>();
for (const target of ['common', 'dog', 'rider'] as const) {
  for (const pattern of SINGLE_TRICKS.flat()) tricks.set(freeTrickName(target, pattern, true), { subject: subjects[target], motion: [pattern.motion] });
  for (const pattern of PAIR_TRICKS) tricks.set(freeTrickName(target, pattern, false), { subject: subjects[target], motion: pattern.directions.map(i => DIRECTION_NAMES[i]) });
  const combos = [
    [COMBO_TRICKS.threeAxes, ['多方向連続技']],
    [COMBO_TRICKS.flipReverse, ['反転連続技', DIRECTION_NAMES[0], DIRECTION_NAMES[1]]],
    [COMBO_TRICKS.spinReverse, ['反転連続技', DIRECTION_NAMES[2], DIRECTION_NAMES[3]]],
    [COMBO_TRICKS.rollReverse, ['反転連続技', DIRECTION_NAMES[4], DIRECTION_NAMES[5]]],
    [COMBO_TRICKS.multiReverse, ['多方向連続技', '反転連続技']],
  ] as const;
  for (const [pattern, motion] of combos) tricks.set(freeTrickName(target, pattern, false), { subject: subjects[target], motion: [...motion] });
}

export function translateTrickName(name: string): string {
  if (current === 'ja') return name;
  const parts = name.split('・');
  const count = parts.pop()?.replace(/の大連舞$/, '') ?? '';
  const prefixes: Record<string, string[]> = { '限界突破': ['限界突破'], '天翔ける疾風の連続技': ['天翔ける', '疾風'],
    '疾風の連続技': ['疾風'], '連続技': ['連携'] };
  const tags: string[] = [];
  while (parts[0] in prefixes) tags.push(...prefixes[parts.shift()!]);
  const base = tricks.get(parts.join('・'));
  if (!base) return t(name);
  const turns = count === '半回転' ? t(count) : t('{n}回転', { n: Number.parseFloat(count).toLocaleString(current) });
  return [...tags.map(tag => t(tag)), t(base.subject), base.motion.map(motion => t(motion)).join(' + '), turns].join(' · ');
}
