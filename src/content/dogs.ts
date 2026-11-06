import type { DogId, DogSpec } from './types';

/**
 * 3種の犬。性能の違いは「直線の最高速」と「目標の横位置に届く速さ」の2つだけ（R32）。
 * ジャンプ・回転・接触判定の大きさ・技の配点は全犬種で共通（R35）。look は見た目専用。
 */
export const DOGS: Record<DogId, DogSpec> = {
  shiba: {
    id: 'shiba',
    name: '柴犬',
    speedIndex: 100,
    handlingIndex: 100,
    look: { body: '#d9822b', belly: '#f6e7d2', ear: 'pointy', tail: 'curl', legLength: 0.32, bodyLength: 0.9, bodyHeight: 0.34 },
  },
  corgi: {
    id: 'corgi',
    name: 'コーギー',
    speedIndex: 93,
    handlingIndex: 115,
    look: { body: '#e39a3b', belly: '#fbf3e6', ear: 'big', tail: 'stub', legLength: 0.18, bodyLength: 1.0, bodyHeight: 0.34 },
  },
  whippet: {
    id: 'whippet',
    name: 'ウィペット',
    speedIndex: 107,
    handlingIndex: 85,
    look: { body: '#9c8f86', belly: '#e9e2dc', ear: 'folded', tail: 'thin', legLength: 0.44, bodyLength: 0.95, bodyHeight: 0.3 },
  },
};

export const DOG_ORDER: DogId[] = ['shiba', 'corgi', 'whippet'];
