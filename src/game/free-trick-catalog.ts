import type { FreeTarget } from './free-motion';

export const DIRECTION_NAMES = ['バックフリップ', 'フロントフリップ', '左スピン', '右スピン', '左バレルロール', '右バレルロール'] as const;
export const TARGET_NAMES = { common: '犬と人', dog: '犬', rider: '人' } as const;
type TargetNames = readonly [both: string, dog: string, rider: string];

export interface FreeTrickPattern {
  motion: string;
  minimumHalfTurns: number;
  names: TargetNames;
}

const singleFlavors: readonly (readonly TargetNames[])[] = [
  [
    ['シンクロポップ', '肉球ポップ', 'ヒールポップ'],
    ['ツインムーン', 'しっぽムーン', '背面ムーン'],
    ['双月返し', '月追いワンターン', '月面リバース'],
    ['二重虹返し', 'しっぽダブル', '背面ダブル'],
    ['双翼ムーンサイクロン', '遠吠えムーンサイクロン', '天空ムーンサイクロン'],
  ],
  [
    ['ツインダイブ', '鼻先ダイブ', '肩先ダイブ'],
    ['二人飛び込み', '疾走ダイブ', 'フロントダイブ'],
    ['双流れ星', 'ほね追いメテオ', '流星ダイブ'],
    ['二重飛び込み', '鼻先ダブル', '前転ダブル'],
    ['双翼メテオループ', '遠吠えメテオループ', '天空メテオループ'],
  ],
  [
    ['左寄せシンクロ', '左寄せ肉球', '左寄せピボット'],
    ['左のツインリング', '左のしっぽリング', '左のハンドリング'],
    ['左巻き連旋', '左巻き小走り', '左巻きショルダー'],
    ['左巻き二重輪', '左巻きダブルテイル', '左巻きダブルピボット'],
    ['双翼レフトボルテックス', '遠吠えレフトボルテックス', '天空レフトボルテックス'],
  ],
  [
    ['右寄せシンクロ', '右寄せ肉球', '右寄せピボット'],
    ['右のツインリング', '右のしっぽリング', '右のハンドリング'],
    ['右巻き連旋', '右巻き小走り', '右巻きショルダー'],
    ['右巻き二重輪', '右巻きダブルテイル', '右巻きダブルピボット'],
    ['双翼ライトボルテックス', '遠吠えライトボルテックス', '天空ライトボルテックス'],
  ],
  [
    ['左傾きツイン', '左傾きころり', '左傾きサイド'],
    ['左のペアロール', '左の芝生ロール', '左のサイドロール'],
    ['左流れコーク', '左流れしっぽコーク', '左流れショルダーコーク'],
    ['左のダブルコーク', '左の肉球ダブルロール', '左のボディダブルロール'],
    ['双翼レフトスパイラル', '遠吠えレフトスパイラル', '天空レフトスパイラル'],
  ],
  [
    ['右傾きツイン', '右傾きころり', '右傾きサイド'],
    ['右のペアロール', '右の芝生ロール', '右のサイドロール'],
    ['右流れコーク', '右流れしっぽコーク', '右流れショルダーコーク'],
    ['右のダブルコーク', '右の肉球ダブルロール', '右のボディダブルロール'],
    ['双翼ライトスパイラル', '遠吠えライトスパイラル', '天空ライトスパイラル'],
  ],
];

export const SINGLE_TRICKS = singleFlavors.map((flavors, direction) =>
  flavors.map((names, i): FreeTrickPattern => ({
    motion: DIRECTION_NAMES[direction], minimumHalfTurns: i + 1, names,
  })));

const pairs: readonly (readonly [number, number, TargetNames])[] = [
  [0, 1, ['双翼シーソー', 'しっぽシーソー', '宙返りスイッチ']],
  [0, 2, ['左の双月アーク', 'しっぽ左月返し', '背面レフトアーク']],
  [0, 3, ['右の双月アーク', 'しっぽ右月返し', '背面ライトアーク']],
  [0, 4, ['左の双翼クレセント', '肉球レフトムーン', '背面レフトコーク']],
  [0, 5, ['右の双翼クレセント', '肉球ライトムーン', '背面ライトコーク']],
  [1, 2, ['左の双星ダイブ', '鼻先レフトダイブ', '前転レフトアーク']],
  [1, 3, ['右の双星ダイブ', '鼻先ライトダイブ', '前転ライトアーク']],
  [1, 4, ['左の双翼メテオ', '肉球レフトメテオ', '前転レフトコーク']],
  [1, 5, ['右の双翼メテオ', '肉球ライトメテオ', '前転ライトコーク']],
  [2, 3, ['シンクロ切り返し', 'しっぽジグザグ', 'バック・アンド・フォース']],
  [2, 4, ['左巻きツインツイスター', '左巻きしっぽツイスター', '左巻きサイドツイスター']],
  [2, 5, ['左・右の交差翼', '左スピンと右ころり', 'レフト・クロスロール']],
  [3, 4, ['右・左の交差翼', '右スピンと左ころり', 'ライト・クロスロール']],
  [3, 5, ['右巻きツインツイスター', '右巻きしっぽツイスター', '右巻きサイドツイスター']],
  [4, 5, ['双翼ワイパー', 'おなかワイパー', 'サイド・スイッチ']],
];

export const PAIR_TRICKS = pairs.map(([first, second, names]) => ({
  directions: [first, second],
  motion: DIRECTION_NAMES[first] + '＋' + DIRECTION_NAMES[second],
  minimumHalfTurns: 2,
  names,
}));

export const COMBO_TRICKS = {
  threeAxes: { motion: '3方向以上・反転する軸なし', minimumHalfTurns: 3,
    names: ['双翼トリプルオービット', '肉球トリプルオービット', '天空トリプルオービット'] },
  flipReverse: { motion: '3方向以上・宙返りだけ前後両方', minimumHalfTurns: 3,
    names: ['双月リバースコンボ', 'しっぽムーンリバース', '前後サマーソルトコンボ'] },
  spinReverse: { motion: '3方向以上・旋回だけ左右両方', minimumHalfTurns: 3,
    names: ['双輪リバースコンボ', '肉球スピンリバース', '両旋回カウンターコンボ'] },
  rollReverse: { motion: '3方向以上・横転だけ左右両方', minimumHalfTurns: 3,
    names: ['双翼バレルリバース', '芝生バレルリバース', '両横転カウンターコンボ'] },
  multiReverse: { motion: '4方向以上・2軸以上で両方向', minimumHalfTurns: 4,
    names: ['双翼ミラーストーム', '遠吠えミラーストーム', '天空ミラーストーム'] },
} satisfies Record<string, FreeTrickPattern>;

/** 半回転以上成立した方向は、重複のない0〜5の番号で渡す。 */
export function matchFreeTrick(directions: readonly number[], halfTurns: number): FreeTrickPattern {
  if (directions.length === 1) return SINGLE_TRICKS[directions[0]][Math.min(halfTurns, 5) - 1];
  if (directions.length === 2) return PAIR_TRICKS.find(pattern => pattern.directions.every(i => directions.includes(i)))!;

  const reversedAxes = [0, 2, 4].filter(i => directions.includes(i) && directions.includes(i + 1));
  if (reversedAxes.length >= 2) return COMBO_TRICKS.multiReverse;
  if (reversedAxes[0] === 0) return COMBO_TRICKS.flipReverse;
  if (reversedAxes[0] === 2) return COMBO_TRICKS.spinReverse;
  if (reversedAxes[0] === 4) return COMBO_TRICKS.rollReverse;
  return COMBO_TRICKS.threeAxes;
}

const TARGET_NAME_INDEX = { common: 0, dog: 1, rider: 2 } as const;

export function freeTrickName(target: FreeTarget, pattern: FreeTrickPattern, singleDirection: boolean): string {
  const name = pattern.names[TARGET_NAME_INDEX[target]];
  const subject = TARGET_NAMES[target];
  return singleDirection ? `${subject}の${pattern.motion}「${name}」` : `${subject}の${name}`;
}
