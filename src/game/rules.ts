/**
 * 採点・操作の版（rulesVersion）と、走行計算で共通に使う値。
 * ここを変えて公開記録の意味が変わる場合は RULES_VERSION を上げ、旧版の記録と混ぜない。
 * 値の多くは仕様書§1の「試作値」。実機（iPhone 17 Pro）で測ってから固定する。
 */
export const RULES_VERSION = 'rules-1';

/** 走行計算の一定の刻み。描画の回数とは無関係に、走行時刻 0 から 5ms ごとに進める。 */
export const TICK_US = 5_000;
/** 「3・2・1」の長さ。 */
export const COUNTDOWN_US = 3_000_000;
/** 1フレームで計算へ渡す最大の時間。止まっていた実時間をまとめて物理演算へ渡さない。 */
export const MAX_FRAME_US = 100_000;

// ---- 動き ----
/** 柴犬（指数100）の平地の最高速 m/s。 */
export const BASE_SPEED = 10;
/** 発進・再発進の加速 m/s²。 */
export const LAUNCH_ACCEL = 14;
/** 坂で通常速度がゆるやかに変わる速さ m/s²。 */
export const SLOPE_ACCEL = 2.5;
/** 柴犬（指数100）が目標の横位置へ向かう速さ m/s。 */
export const LATERAL_SPEED = 4.5;
/** 横払い 1（画面の短辺と同じ長さ）あたりの目標位置の移動量 m。 */
export const STEER_GAIN = 9;
export const GRAVITY = 14;
/** 平地のジャンプ初速 m/s（頂点 1.12m、滞空 0.8 秒）。 */
export const JUMP_VY = 5.6;
/** 踏切台からのジャンプ初速 m/s。 */
export const KICKER_VY = 9.0;
/** 手すりから前へ跳び降りる初速 m/s。 */
export const RAIL_JUMP_VY = 5.0;

// ---- 犬種共通の足元判定（体格や見た目から計算しない） ----
/** 足元中心から鼻先までの長さ。正面の接触はこの位置で判定する。 */
export const FOOT_FRONT = 0.45;
/** 足元中心からの横幅の半分。 */
export const FOOT_HALF_WIDTH = 0.25;
/** 犬の体の高さ（フードの袋との高さの重なりに使う）。 */
export const BODY_HEIGHT = 0.9;
/** これより低い段差は乗り越える。 */
export const STEP_UP = 0.18;
/** これより低い下り段差は浮かずに降りる（階段の一段 0.2m を歩いて下りられる）。 */
export const STEP_DOWN = 0.25;
/** 手すりの太さの半分。 */
export const RAIL_HALF_WIDTH = 0.06;
/** 上から下りてきたとき、手すりに乗れる横のずれ。 */
export const RAIL_SNAP = 0.45;
/** 道の端が壁のとき、端から足元中心までの最小距離。 */
export const EDGE_MARGIN = 0.3;
/** 道の端が落下側のとき、目標位置として端の外へ出せる量。 */
export const DROP_OVERREACH = 1.4;

// ---- 落下と復帰 ----
export const FALL_US = 900_000;
/** 落下と判定する、道の高さからの下がり幅。 */
export const FALL_DEPTH = 0.6;

// ---- 回転 ----
export const DOG_SPIN_US = 360_000;
export const BODY_ROT_US = 480_000;
export const MAX_SLOTS = 2;
/** 空中で犬の基本姿勢が着地面へそろう時定数。 */
export const ATTITUDE_TAU_US = 120_000;

// ---- アイテム ----
export const FOOD_US = 5_000_000;
export const FOOD_MULT = 1.25;
export const POOP_US = 2_000_000;
export const POOP_MULT = 0.6;
export const ITEM_REACH_X = 0.6;
export const POOP_REACH_X = 0.45;

// ---- 採点 ----
export const TIME_SCORE_MAX = 5_000;
export const TRICK_SCORE_MAX = 5_000;
export const DOG_BASE = 100;
export const BODY_CARDINAL_BASE = 150;
export const BODY_DIAGONAL_BASE = 200;
export const COMPOSITE_BONUS = 100;
export const STREAK_LENGTH = 3;
export const STREAK_BONUS = 100;
export const RAIL_POINTS_PER_M = 10;
export const RAIL_POINTS_MAX = 100;
export const LANDING_PERFECT_DEG = 10;
export const LANDING_OK_DEG = 30;

/** 完走の走行時刻（µs）を記録用の 0.01 秒単位に丸める。0.005 秒ちょうどは上へ。 */
export function toCentiseconds(elapsedUs: number): number {
  return Math.floor((elapsedUs + 5_000) / 10_000);
}
