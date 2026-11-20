/**
 * 81種類の空中・着地演出の定義（docs/2026-11-20-81-trick-visual-spec.md が正本）。
 * B（両方）・H（人のみ）・D（犬のみ）それぞれに、派手さF10段階・空中軌跡A7段階・着地L10段階を持つ。
 * 10×7×10の掛け算ではなく、3対象×27件＝81件。1回のジャンプで同時に使うのはF1件・A1件・L1件だけ。
 *
 * 各IDは「どの身体の位置（起点）から」「どの基本部品を」「どの時間で」描くかの手順（recipe）を持つ。
 * 基本部品は少数を使い回し、IDごとに組み合わせ・起点・時間・形の値を変えて別々の見た目にする。
 * 描画は src/view/trick-fx-draw.ts が受け持ち、ここは文字と数字だけの静的な表にする。
 */

export const FX_TARGETS = ['B', 'H', 'D'] as const;
export const FX_KINDS = ['F', 'A', 'L'] as const;
export type FxTarget = typeof FX_TARGETS[number];
export type FxKind = typeof FX_KINDS[number];
export const FX_LEVEL_COUNT: Readonly<Record<FxKind, number>> = { F: 10, A: 7, L: 10 };

type Two = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09';
export type FxId =
  | `${FxTarget}-F${Two | '10'}`
  | `${FxTarget}-A${'01' | '02' | '03' | '04' | '05' | '06' | '07'}`
  | `${FxTarget}-L${Two | '10'}`;

/** 身体の上の見えない計測点。contact は着地の接地点、pivot は回転の支点。 */
export const ANCHOR_KEYS = [
  'dogNose', 'dogEarL', 'dogEarR', 'dogTail', 'dogPawFL', 'dogPawFR', 'dogPawBL', 'dogPawBR', 'dogBack', 'dogBelly',
  'riderHead', 'riderHelmet', 'riderShoulderL', 'riderShoulderR', 'riderHandL', 'riderHandR', 'riderWaist', 'riderShoeL', 'riderShoeR',
  'pivot', 'contact',
] as const;
export type AnchorKey = typeof ANCHOR_KEYS[number];
export type BodyAnchorKey = Exclude<AnchorKey, 'contact'>;
export const anchorBody = (key: AnchorKey): 'dog' | 'rider' | null =>
  key.startsWith('dog') ? 'dog' : key.startsWith('rider') ? 'rider' : null;

/** 基本部品。空中は身体の計測点に追従し、着地は接地点の床に描く。 */
export type FxOp =
  // 空中（派手さF・軌跡A）
  | 'glow' | 'outline' | 'rim' | 'relay' | 'arc' | 'band' | 'axis' | 'pulse' | 'ghost' | 'orbit' | 'crossStar'
  | 'trail' | 'halfArc' | 'helix' | 'eight' | 'ellipses' | 'braid' | 'crescent' | 'arrow' | 'constellation' | 'fan'
  // 着地L
  | 'groundDot' | 'ring' | 'prints' | 'spray' | 'ripples' | 'rays' | 'crown' | 'collect' | 'fall' | 'silhouette'
  | 'swirl' | 'bounce' | 'petals' | 'pawBand' | 'emblem' | 'descend';

/** 色。body は計測点の身体（犬=橙、人=青）に合わせる。amber は犬の琥珀色、ice は人の青白。 */
export type FxColor = 'dog' | 'rider' | 'amber' | 'ice' | 'white' | 'body';

export interface FxStep {
  op: FxOp;
  at: readonly AnchorKey[];
  color: FxColor;
  /** 開始（演出の開始からのms）。 */
  t0: number;
  /** 長さ（ms）。0 は空中にいる間ずっと続く。 */
  dur: number;
  /** 大きさの基準（m）。 */
  size: number;
  /** 部品の数（線の本数・輪の数・粒の数など）。 */
  n?: number;
  /** 実際に連携が成立したときだけ描く（ボタンの連打では出さない）。 */
  combo?: boolean;
  /** 部品ごとの形の値。 */
  p?: Readonly<Record<string, number>>;
}

export type FxTrigger = 'takeoff' | 'rotation' | 'level' | 'land';

export interface FxProgram {
  id: FxId;
  name: string;
  target: FxTarget;
  kind: FxKind;
  level: number;
  anchors: readonly AnchorKey[];
  recipe: readonly FxStep[];
  trigger: FxTrigger;
  /** 着地は一度だけの長さ。空中は0（空中にいる間続き、段階が上がるか着地で消える）。 */
  lifetimeMs: number;
  opacityMax: number;
  sizeMax: number;
  params: Readonly<Record<string, number>>;
}

type StepIn = Omit<FxStep, 't0' | 'dur' | 'size'> & Partial<Pick<FxStep, 't0' | 'dur' | 'size'>>;
const s = (op: FxOp, at: readonly AnchorKey[], color: FxColor, rest: Partial<StepIn> = {}): FxStep =>
  ({ op, at, color, t0: rest.t0 ?? 0, dur: rest.dur ?? 0, size: rest.size ?? 0.1, ...(rest.n !== undefined ? { n: rest.n } : {}),
    ...(rest.combo ? { combo: true } : {}), ...(rest.p ? { p: rest.p } : {}) });

const PAWS = ['dogPawFL', 'dogPawFR', 'dogPawBL', 'dogPawBR'] as const;
const FRONT = ['dogPawFL', 'dogPawFR'] as const;
const SHOULDERS = ['riderShoulderL', 'riderShoulderR'] as const;
const HANDS = ['riderHandL', 'riderHandR'] as const;
const SHOES = ['riderShoeL', 'riderShoeR'] as const;

interface Row { name: string; anchors: readonly AnchorKey[]; recipe: readonly FxStep[]; life?: number; opacity?: number; sizeMax?: number; params?: Record<string, number> }

// ---------------------------------------------------------------- B：両方（犬は橙、人は青）
const B_F: Row[] = [
  { name: '同時点灯', anchors: ['dogPawFL', 'riderShoulderL'], recipe: [
    s('glow', ['dogPawFL', 'riderShoulderL'], 'body', { dur: 600, size: 0.09, p: { rise: 250, fall: 350 } })] },
  { name: '二重輪郭', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('outline', ['dogBack'], 'dog', { size: 1, p: { speedFade: 1 } }), s('outline', ['riderWaist'], 'rider', { size: 1, p: { speedFade: 1 } })] },
  { name: '呼応する明かり', anchors: ['dogPawFL', 'riderShoulderL'], recipe: [
    s('relay', ['dogPawFL', 'dogBack', 'riderWaist', 'riderShoulderL'], 'body', { dur: 500, size: 0.08, n: 2, p: { gap: 120 } })] },
  { name: '対になる円弧', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('arc', ['dogBack'], 'dog', { size: 0.55, p: { sweep: 1.6, side: -1 } }), s('arc', ['riderWaist'], 'rider', { size: 0.55, p: { sweep: 1.6, side: 1 } })] },
  { name: '交差する光帯', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('band', ['dogBack', 'riderWaist'], 'body', { size: 0.12, n: 3, p: { cross: 1, behind: 0.45 } })] },
  { name: '連携の拍動', anchors: ['dogPawFL', 'riderShoulderR'], recipe: [
    s('glow', ['dogPawFL', 'riderShoulderR'], 'body', { size: 0.07, p: { breathe: 900 } }),
    s('pulse', ['dogPawFL', 'riderShoulderR'], 'body', { dur: 600, size: 0.1, combo: true, p: { mark: 1 } })] },
  { name: '重なる輪郭残像', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('ghost', ['dogNose', 'dogBack', 'dogTail'], 'dog', { n: 2, size: 1, p: { lag: 120, life: 400 } }),
    s('ghost', ['riderHead', 'riderWaist', 'riderShoeL'], 'rider', { n: 2, size: 1, p: { lag: 120, life: 400 } })] },
  { name: '二重の軌道光', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('orbit', ['dogBack'], 'dog', { size: 0.7, n: 1, p: { tilt: 0.5, spin: 1.4, pair: 1 } }),
    s('orbit', ['riderWaist'], 'rider', { size: 0.6, n: 1, p: { tilt: -0.6, spin: -1.2, pair: 2 } })] },
  { name: '天空の交点', anchors: ['dogPawFL', 'riderHandR'], recipe: [
    s('trail', ['dogPawFL', 'riderHandR'], 'body', { size: 1, p: { window: 450, style: 3 } }),
    s('crossStar', ['dogPawFL', 'riderHandR'], 'white', { size: 0.16, p: { near: 0.35, hold: 260 } })] },
  { name: '共鳴の大舞', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('orbit', ['dogBack'], 'dog', { size: 0.8, n: 3, p: { tilt: 0.45, spin: 1.1, layers: 1 } }),
    s('orbit', ['riderWaist'], 'rider', { size: 0.75, n: 3, p: { tilt: -0.45, spin: -1, layers: 1 } }),
    s('emblem', ['pivot'], 'white', { dur: 700, size: 0.9, combo: true, p: { shape: 4, air: 1 } })], opacity: 0.86 },
];
const B_A: Row[] = [
  { name: '並走する2本線', anchors: ['dogPawFL', 'riderShoulderL'], recipe: [
    s('trail', ['dogPawFL', 'riderShoulderL'], 'body', { size: 1, p: { window: 200, style: 0 } })] },
  { name: '対称の弧', anchors: ['dogPawFR', 'riderShoulderR'], recipe: [
    s('halfArc', ['dogPawFR'], 'dog', { size: 1, p: { window: 320, bulge: -1 } }),
    s('halfArc', ['riderShoulderR'], 'rider', { size: 1, p: { window: 320, bulge: 1 } })] },
  { name: '二重らせん', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('helix', ['dogBack', 'riderWaist'], 'body', { size: 0.22, p: { window: 520, turns: 2.2 } })] },
  { name: '交差するXの線', anchors: ['dogPawFL', 'riderShoulderR'], recipe: [
    s('trail', ['dogPawFL', 'riderShoulderR'], 'body', { size: 1, p: { window: 360, style: 0 } }),
    s('crossStar', ['dogPawFL', 'riderShoulderR'], 'white', { size: 0.1, p: { near: 0.3, hold: 120, x: 1 } })] },
  { name: '8の字の共演', anchors: ['dogPawFL', 'riderHandL'], recipe: [
    s('eight', ['dogPawFL', 'riderHandL'], 'body', { size: 0.42, p: { stack: 1 } })] },
  { name: '交差する2つの軌道', anchors: ['dogBack', 'riderWaist'], recipe: [
    s('ellipses', ['dogBack', 'riderWaist'], 'body', { size: 0.62, p: { history: 1 } })] },
  { name: '連携の編み紐', anchors: ['dogPawFL', 'riderHandR'], recipe: [
    s('braid', ['dogPawFL', 'riderHandR'], 'body', { size: 0.09, p: { window: 700, waves: 5 } })] },
];
const B_L: Row[] = [
  { name: '同時の足元光', anchors: ['dogPawFL', 'riderShoeL', 'contact'], life: 420, recipe: [
    s('groundDot', [...PAWS, ...SHOES], 'body', { dur: 300, size: 0.07 })] },
  { name: '2つの着地輪', anchors: ['dogPawFL', 'riderShoeL', 'contact'], life: 900, recipe: [
    s('ring', ['dogPawFL', 'riderShoeL'], 'body', { dur: 800, size: 0.55, n: 1 })] },
  { name: '並ぶ足跡印', anchors: ['dogPawFL', 'riderShoeL', 'contact'], life: 1200, recipe: [
    s('prints', ['dogPawFL', 'riderShoeL'], 'body', { dur: 1100, size: 0.32, p: { alternate: 160, pair: 1 } })] },
  { name: '二色の砂花', anchors: ['contact'], life: 1000, recipe: [
    s('spray', ['contact'], 'body', { dur: 700, size: 1, n: 36, p: { fan: 1.1, up: 0.55 } })] },
  { name: '交差する波紋', anchors: ['contact'], life: 1300, recipe: [
    s('ripples', ['contact'], 'body', { dur: 1200, size: 0.95, p: { apart: 0.45, highlight: 1 } })] },
  { name: '連携の刻印', anchors: ['contact'], life: 1400, recipe: [
    s('ripples', ['contact'], 'body', { dur: 900, size: 0.7, p: { apart: 0.7, merge: 1 } }),
    s('emblem', ['contact'], 'white', { t0: 500, dur: 700, size: 0.7, combo: true, p: { shape: 3 } })] },
  { name: '二重の放射光', anchors: ['dogPawFL', 'riderShoeL', 'contact'], life: 1100, recipe: [
    s('rays', ['dogPawFL', 'riderShoeL'], 'body', { dur: 1000, size: 0.7, n: 8, p: { alternate: 1 } })] },
  { name: '二層の冠', anchors: ['dogBack', 'riderWaist', 'contact'], life: 1500, recipe: [
    s('ring', ['contact'], 'white', { dur: 1200, size: 1.0, n: 1 }),
    s('crown', ['dogBack', 'riderWaist'], 'body', { dur: 1400, size: 0.5, n: 2 })] },
  { name: '空中軌跡の着地回収', anchors: ['dogPawFL', 'riderHandR', 'contact'], life: 1700, recipe: [
    s('collect', ['dogPawFL', 'riderHandR'], 'body', { dur: 1600, size: 0.75, n: 2 })] },
  { name: '共演の大フィナーレ', anchors: ['contact'], life: 2000, recipe: [
    s('ring', ['contact'], 'body', { dur: 1800, size: 1.6, n: 2, p: { twoCenters: 0.5 } }),
    s('emblem', ['contact'], 'white', { t0: 350, dur: 1500, size: 1.0, p: { shape: 2 } }),
    s('spray', ['contact'], 'body', { dur: 900, size: 1, n: 30, p: { fan: 3.1, up: 0.8 } })], opacity: 0.86 },
];

// ---------------------------------------------------------------- H：人のみ（青）
const H_F: Row[] = [
  { name: 'ヘルメットの光点', anchors: ['riderHelmet'], recipe: [
    s('glow', ['riderHelmet'], 'rider', { dur: 300, size: 0.08, p: { rise: 90, fall: 210 } })] },
  { name: '肩の細い縁光', anchors: SHOULDERS, recipe: [
    s('rim', SHOULDERS, 'ice', { size: 0.13, p: { speedFade: 1 } })] },
  { name: '手先のきらめき', anchors: HANDS, recipe: [
    s('glow', HANDS, 'ice', { size: 0.06, p: { alternate: 260, stretch: 250 } })] },
  { name: '上体を包む弧', anchors: ['riderWaist', 'riderShoulderL'], recipe: [
    s('arc', ['riderWaist'], 'rider', { size: 0.38, p: { sweep: Math.PI, upper: 1 } })] },
  { name: '体軸の青い線', anchors: ['riderHead', 'riderWaist'], recipe: [
    s('axis', ['riderHead', 'riderWaist'], 'rider', { size: 0.2, p: { period: 1400 } })] },
  { name: '腕の扇光', anchors: HANDS, recipe: [
    s('fan', HANDS, 'rider', { size: 0.42, n: 5, p: { spread: 0.9, velocity: 1 } })] },
  { name: '肩の残像2枚', anchors: SHOULDERS, recipe: [
    s('ghost', ['riderHandL', 'riderShoulderL', 'riderShoulderR', 'riderHandR'], 'rider', { n: 2, size: 1, p: { lag: 110, life: 400 } })] },
  { name: '空中の青い帯', anchors: ['riderWaist', 'riderShoulderL'], recipe: [
    s('band', ['riderWaist'], 'rider', { size: 0.5, n: 4, p: { sweep: 2.2 } })] },
  { name: '人体の光環', anchors: ['riderHead', 'riderWaist'], recipe: [
    s('orbit', ['riderHead', 'riderShoulderL', 'riderWaist'], 'ice', { size: 0.42, n: 3, p: { tilt: 0.35, spin: 0.9, perAnchor: 1 } })] },
  { name: '乗り手の極限演技', anchors: ['riderHead', 'riderHandL', 'riderHandR'], recipe: [
    s('ghost', ['riderHandL', 'riderShoulderL', 'riderHead', 'riderShoulderR', 'riderHandR'], 'ice', { n: 2, size: 1, p: { lag: 90, life: 360 } }),
    s('orbit', ['riderWaist'], 'rider', { size: 0.55, n: 4, p: { tilt: 0.3, spin: 1.3, stagger: 180, layers: 1 } })], opacity: 0.86 },
];
const H_A: Row[] = [
  { name: '頭の一本線', anchors: ['riderHelmet'], recipe: [
    s('trail', ['riderHelmet'], 'rider', { size: 1, p: { window: 200, style: 0 } })] },
  { name: '肩の二本線', anchors: SHOULDERS, recipe: [
    s('trail', SHOULDERS, 'ice', { size: 1, p: { window: 320, style: 2, delay: 80 } })] },
  { name: '手首の三日月', anchors: HANDS, recipe: [
    s('crescent', HANDS, 'rider', { size: 0.3, p: { window: 260 } })] },
  { name: '体軸のらせん', anchors: ['riderWaist'], recipe: [
    s('helix', ['riderWaist'], 'rider', { size: 0.3, p: { window: 600, turns: 3, axisAligned: 1 } })] },
  { name: '折れ曲がる矢印軌跡', anchors: ['riderHandL', 'riderShoulderR'], recipe: [
    s('arrow', ['riderShoulderR', 'riderHandL'], 'rider', { size: 0.14, p: { window: 520, corner: 0.7 } })] },
  { name: '人型8の字', anchors: ['riderHead', 'riderHandL'], recipe: [
    s('eight', ['riderHead', 'riderHandL'], 'rider', { size: 0.34, p: { axisChange: 1 } })] },
  { name: '多層の流星線', anchors: ['riderHead', 'riderShoulderL', 'riderHandL', 'riderHandR'], recipe: [
    s('trail', ['riderHead', 'riderShoulderL', 'riderHandL', 'riderHandR'], 'ice', { size: 1, p: { window: 420, style: 4, speedLength: 1 } })] },
];
const H_L: Row[] = [
  { name: '靴底の点', anchors: [...SHOES, 'contact'], life: 400, recipe: [
    s('groundDot', SHOES, 'rider', { dur: 300, size: 0.08 })] },
  { name: '足元の半輪', anchors: ['riderShoeL', 'contact'], life: 900, recipe: [
    s('ring', ['riderShoeL'], 'rider', { dur: 800, size: 0.6, n: 1, p: { half: 1 } })] },
  { name: '手のひらの印', anchors: [...HANDS, 'contact'], life: 900, recipe: [
    s('prints', HANDS, 'ice', { dur: 800, size: 0.3, p: { shape: 2, side: 0.55 } })] },
  { name: '肩から落ちる光', anchors: [...SHOULDERS, 'contact'], life: 1100, recipe: [
    s('fall', SHOULDERS, 'rider', { dur: 1000, size: 0.06, n: 10 })] },
  { name: '靴底の二重波紋', anchors: [...SHOES, 'contact'], life: 1200, recipe: [
    s('ring', SHOES, 'rider', { dur: 1100, size: 0.7, n: 2, p: { ellipse: 1.6, gap: 180 } })] },
  { name: '人型の成功印', anchors: ['riderHead', 'riderWaist', 'contact'], life: 700, recipe: [
    s('silhouette', ['riderHead', 'riderShoulderL', 'riderShoulderR', 'riderHandL', 'riderHandR', 'riderWaist', 'riderShoeL', 'riderShoeR'], 'ice', { dur: 600, size: 1, p: { back: 0.45, hold: 500 } })] },
  { name: '腕の弧が閉じる', anchors: [...HANDS, 'contact'], life: 1400, recipe: [
    s('collect', HANDS, 'rider', { dur: 1300, size: 0.7, n: 1, p: { sparks: 4 } })] },
  { name: '青い光の扇', anchors: [...SHOULDERS, 'contact'], life: 1300, recipe: [
    s('fan', SHOULDERS, 'rider', { dur: 1200, size: 0.9, n: 7, p: { spread: 1.1, sides: 1 } })] },
  { name: '上体の光環が下降', anchors: ['riderWaist', 'contact'], life: 1400, recipe: [
    s('descend', ['riderWaist'], 'ice', { dur: 1400, size: 0.5, n: 2 })] },
  { name: '乗り手の大成功', anchors: ['riderHead', 'riderHandL', 'riderHandR', 'contact'], life: 2000, recipe: [
    s('ring', ['contact'], 'rider', { dur: 1800, size: 1.3, n: 4, p: { gap: 140 } }),
    s('ghost', ['riderHandL', 'riderShoulderL', 'riderHead', 'riderShoulderR', 'riderHandR'], 'ice', { dur: 900, n: 2, size: 1, p: { lag: 120, life: 900, frozen: 1 } })], opacity: 0.86 },
];

// ---------------------------------------------------------------- D：犬のみ（橙・琥珀）
const D_F: Row[] = [
  { name: '鼻先の光', anchors: ['dogNose'], recipe: [
    s('glow', ['dogNose'], 'dog', { dur: 250, size: 0.07, p: { rise: 80, fall: 170 } })] },
  { name: '前足の縁光', anchors: FRONT, recipe: [
    s('rim', FRONT, 'dog', { size: 0.1, p: { speedFade: 1, full: 1 } })] },
  { name: 'しっぽの光点', anchors: ['dogTail'], recipe: [
    s('glow', ['dogTail'], 'dog', { size: 0.07, p: { stretch: 180 } })] },
  { name: '耳のきらめき', anchors: ['dogEarL', 'dogEarR'], recipe: [
    s('glow', ['dogEarL', 'dogEarR'], 'amber', { size: 0.055, p: { breathe: 700, stretch: 120 } })] },
  { name: '四足の拍動', anchors: PAWS, recipe: [
    s('relay', ['dogPawFL', 'dogPawFR', 'dogPawBR', 'dogPawBL'], 'dog', { size: 0.07, n: 1, p: { loop: 900 } })] },
  { name: '胴体の帯', anchors: ['dogBack', 'dogBelly'], recipe: [
    s('band', ['dogBack', 'dogBelly'], 'dog', { size: 0.06, n: 3, p: { around: 1 } })] },
  { name: 'しっぽの扇光', anchors: ['dogTail'], recipe: [
    s('fan', ['dogTail'], 'amber', { size: 0.45, n: 6, p: { spread: 0.5, velocity: -1, speedSpread: 1 } })] },
  { name: '肉球の残像', anchors: PAWS, recipe: [
    s('ghost', PAWS, 'amber', { n: 1, size: 0.08, p: { lag: 90, life: 400, paw: 1 } })] },
  { name: '犬を包む琥珀の輪', anchors: ['dogNose', 'dogBack', 'dogTail'], recipe: [
    s('orbit', ['dogNose', 'dogBack', 'dogTail'], 'amber', { size: 0.62, n: 1, p: { enclose: 1, spin: 0.8 } })] },
  { name: '肉球の極限舞', anchors: [...PAWS, 'dogTail'], recipe: [
    s('trail', [...PAWS, 'dogTail'], 'amber', { size: 1, p: { window: 300, style: 1 } }),
    s('orbit', ['dogBack'], 'amber', { size: 0.85, n: 2, p: { tilt: 0.25, spin: 1.2, assemble: 900 } })], opacity: 0.86 },
];
const D_A: Row[] = [
  { name: 'しっぽの筆線', anchors: ['dogTail'], recipe: [
    s('trail', ['dogTail'], 'dog', { size: 1, p: { window: 200, style: 1 } })] },
  { name: '前足の点線', anchors: FRONT, recipe: [
    s('trail', FRONT, 'dog', { size: 0.045, p: { window: 420, style: 5 } })] },
  { name: '鼻先の円弧', anchors: ['dogNose'], recipe: [
    s('arc', ['dogNose'], 'dog', { size: 0.35, p: { sweep: 1.9, follow: 1 } })] },
  { name: '肉球のらせん', anchors: PAWS, recipe: [
    s('helix', ['dogBack'], 'dog', { size: 0.34, p: { window: 520, turns: 2.6, through: 1 } }),
    s('glow', PAWS, 'amber', { size: 0.04 })] },
  { name: '4本の足跡線', anchors: PAWS, recipe: [
    s('trail', PAWS, 'dog', { size: 1, p: { window: 380, style: 0, frontBack: 1 } })] },
  { name: '鼻としっぽの二重輪', anchors: ['dogNose', 'dogTail'], recipe: [
    s('ellipses', ['dogNose', 'dogTail'], 'dog', { size: 0.32, p: { aspect: 1 } })] },
  { name: '肉球の星座', anchors: [...PAWS, 'dogNose'], recipe: [
    s('constellation', ['dogNose', 'dogPawFL', 'dogPawBL', 'dogPawBR', 'dogPawFR'], 'amber', { size: 0.05, p: { window: 260 } })] },
];
const D_L: Row[] = [
  { name: '肉球の一押し', anchors: ['dogPawFL', 'contact'], life: 400, recipe: [
    s('prints', ['dogPawFL'], 'dog', { dur: 300, size: 0.3, p: { shape: 0 } })] },
  { name: '4つの足元点', anchors: [...PAWS, 'contact'], life: 700, recipe: [
    s('groundDot', PAWS, 'dog', { dur: 600, size: 0.06, p: { exact: 1 } })] },
  { name: '短いしっぽの渦', anchors: ['dogTail', 'contact'], life: 900, recipe: [
    s('swirl', ['dogTail'], 'dog', { dur: 800, size: 0.45 })] },
  { name: '小さな肉球の輪', anchors: ['dogPawFL', 'contact'], life: 1000, recipe: [
    s('prints', ['dogPawFL'], 'dog', { dur: 900, size: 0.3, p: { shape: 0 } }),
    s('ring', ['dogPawFL'], 'dog', { t0: 120, dur: 800, size: 0.55, n: 1, p: { thin: 1 } })] },
  { name: '四足の波紋', anchors: [...PAWS, 'contact'], life: 1000, recipe: [
    s('ring', PAWS, 'dog', { dur: 900, size: 0.32, n: 1 })] },
  { name: '跳ねる肉球粒', anchors: ['contact'], life: 1100, recipe: [
    s('bounce', ['contact'], 'amber', { dur: 1000, size: 0.12, n: 6, p: { height: 0.55 } })] },
  { name: 'しっぽの花', anchors: ['dogTail', 'contact'], life: 1200, recipe: [
    s('petals', ['dogTail'], 'amber', { dur: 1100, size: 0.55, n: 4 }),
    s('groundDot', FRONT, 'dog', { dur: 500, size: 0.04 })] },
  { name: '琥珀の足跡帯', anchors: ['contact'], life: 1000, recipe: [
    s('pawBand', ['contact'], 'amber', { dur: 1000, size: 0.26, n: 7 })] },
  { name: '肉球と二重輪', anchors: ['dogPawFL', 'contact'], life: 1300, recipe: [
    s('prints', ['contact'], 'amber', { dur: 1200, size: 0.6, p: { shape: 0 } }),
    s('ring', ['contact'], 'dog', { dur: 1200, size: 0.85, n: 2, p: { gap: 120, max: 1.0 } })] },
  { name: '犬の大成功', anchors: [...PAWS, 'dogTail', 'contact'], life: 2000, recipe: [
    s('rays', PAWS, 'amber', { dur: 1300, size: 0.6, n: 5 }),
    s('arc', ['dogTail'], 'dog', { dur: 1200, size: 0.75, p: { sweep: 2.6, ground: 1 } }),
    s('ring', ['contact'], 'amber', { dur: 1800, size: 1.3, n: 2, p: { gap: 160 } }),
    s('emblem', ['contact'], 'amber', { t0: 250, dur: 1600, size: 0.75, p: { shape: 1 } })], opacity: 0.86 },
];

const ROWS: Record<FxTarget, Record<FxKind, Row[]>> = {
  B: { F: B_F, A: B_A, L: B_L },
  H: { F: H_F, A: H_A, L: H_L },
  D: { F: D_F, A: D_A, L: D_L },
};

function build(): readonly FxProgram[] {
  const out: FxProgram[] = [];
  for (const target of FX_TARGETS) {
    for (const kind of FX_KINDS) {
      ROWS[target][kind].forEach((row, i) => {
        const level = i + 1;
        out.push({
          id: `${target}-${kind}${String(level).padStart(2, '0')}` as FxId,
          name: row.name,
          target, kind, level,
          anchors: row.anchors,
          recipe: row.recipe,
          trigger: kind === 'L' ? 'land' : kind === 'A' ? 'rotation' : level === 1 ? 'takeoff' : 'level',
          lifetimeMs: kind === 'L' ? Math.min(2000, row.life ?? 1000) : 0,
          // 段階が上がるほど少し強くするが、顔や前方を隠さない上限に収める。
          opacityMax: Math.min(row.opacity ?? 0.92, 0.72 + 0.02 * level),
          sizeMax: row.sizeMax ?? (kind === 'L' ? 1.8 : 1.0),
          params: row.params ?? {},
        });
      });
    }
  }
  return out;
}

export const TRICK_FX_81: readonly FxProgram[] = build();
const BY_ID = new Map(TRICK_FX_81.map(p => [p.id, p] as const));

export function fxProgram(id: FxId): FxProgram {
  return BY_ID.get(id)!;
}
export function fxId(target: FxTarget, kind: FxKind, level: number): FxId | null {
  const max = FX_LEVEL_COUNT[kind];
  if (!Number.isInteger(level) || level < 1 || level > max) return null;
  return `${target}-${kind}${String(level).padStart(2, '0')}` as FxId;
}
export function isFxId(value: unknown): value is FxId {
  return typeof value === 'string' && BY_ID.has(value as FxId);
}
