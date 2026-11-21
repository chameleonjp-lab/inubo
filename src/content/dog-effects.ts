import type { DogId } from './types';

export interface DogEffectColors {
  main: string;
  partner: string;
  light: string;
  glint: string;
  ink: string;
  shade: string;
  dust: string;
}

/** 犬種の演出色。身体、衣装、コースの素材色には使わない。 */
export const DOG_EFFECT_COLORS: Record<DogId, DogEffectColors> = {
  shiba: { main: '#f66a25', partner: '#ffc34d', light: '#ffe0a3', glint: '#fff3d9', ink: '#35170c', shade: '#9b3b0e', dust: '#d9a175' },
  corgi: { main: '#13d3e9', partner: '#25a1f4', light: '#a8f2ff', glint: '#e5fbff', ink: '#07313c', shade: '#005973', dust: '#77b4c3' },
  whippet: { main: '#aa62ff', partner: '#eb8df5', light: '#e6cfff', glint: '#f7e8ff', ink: '#2e1643', shade: '#6a379f', dust: '#b99cce' },
};

export function dogEffectStyle(dogId: DogId): string {
  return Object.entries(DOG_EFFECT_COLORS[dogId]).map(([name, hex]) => `--effect-${name}:${hex}`).join(';');
}
