import type { FreeTarget } from '../game/free-motion';

export const ROTATION_TARGETS = [
  ['common', '両方'], ['dog', '犬のみ'], ['rider', '人のみ'],
] as const;

export type TargetKeys = Record<FreeTarget, string>;
export const DEFAULT_TARGET_KEYS: Readonly<TargetKeys> = { common: 'a', dog: 's', rider: 'd' };

function normalizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^[^\p{C}]\p{M}*$/u.test(value)) return value.toLowerCase().normalize('NFC');
  return /^(?:Arrow(?:Up|Down|Left|Right)|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|F(?:[1-9]|1\d|2[0-4]))$/.test(value)
    ? value : null;
}

export function loadTargetKeys(value: unknown): TargetKeys {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TARGET_KEYS };
  const stored = value as Partial<TargetKeys>;
  const common = normalizeKey(stored.common), dog = normalizeKey(stored.dog), rider = normalizeKey(stored.rider);
  if (!common || !dog || !rider || new Set([common, dog, rider]).size !== 3) return { ...DEFAULT_TARGET_KEYS };
  return { common, dog, rider };
}

export function targetKeyFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
  return normalizeKey(event.key);
}

export function keyLabel(key: string): string {
  return key === ' ' ? 'Space' : /^[a-z]$/.test(key) ? key.toUpperCase() : key;
}
