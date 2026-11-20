import type { AnchorKey, FxOp, FxStep } from './trick-fx-81';
import type { PointRing, Quat, Rgb, Vec } from './trick-fx-math';
import type { FxPen } from './trick-fx-pen';

export type FxBody = 'dog' | 'rider';

/** 描画中の1件の演出から、部品の描き方が読める情報。 */
export interface FxDrawContext {
  readonly pen: FxPen;
  /** 描画専用の時計（停止中は進まない）。 */
  readonly clockMs: number;
  /** 動きを減らす設定。動く形は短い静止形に置き換える。 */
  readonly reduced: boolean;
  /** 光を弱くする設定。粒の数を減らす。 */
  readonly weak: boolean;
  /** 進行方向（ラジアン）。着地では接地した瞬間の向き。 */
  readonly yaw: number;
  /** 着地の接地点。空中では null。 */
  readonly contact: Vec | null;
  /** 床の高さ（着地点、なければ足元）。 */
  readonly groundY: number;
  /** 段階が上がった・着地したなどで消えかけている。 */
  readonly fading: boolean;
  /** 空中で連携が実際に成立してからの時間（ms）。成立していなければ null。 */
  readonly comboAgeMs: number | null;
  /** 着地の時点で連携が成立していたか。 */
  readonly comboLanding: boolean;
  pos(key: AnchorKey, out: Vec): boolean;
  hist(key: AnchorKey): PointRing | null;
  /** agoMs だけ前の位置。 */
  past(key: AnchorKey, agoMs: number, out: Vec): boolean;
  /** 身体の回転軸（止まっていれば身体の左右の軸）。 */
  axis(body: FxBody | null, out: Vec): Vec;
  /** 身体の回転の速さ（ラジアン/秒）。 */
  speed(body: FxBody): number;
  /** 身体がこれまでに回った角度の合計（ラジアン）。 */
  angle(body: FxBody): number;
  quat(body: FxBody): Quat | null;
  center(body: FxBody, out: Vec): boolean;
  color(step: FxStep, key: AnchorKey | null): Rgb;
  /** 部品ごとに一度だけ true（粒を一度だけ出すため）。 */
  once(stepIndex: number): boolean;
  /** 演出ごとの小さな覚え書き（交点の星など）。 */
  readonly memo: Record<string, number>;
  /** 2つの輪の交点を探すための、直前に描いた輪の点。 */
  readonly ringPoints: Float32Array;
  ringCount: number;
}

/** 部品1つの描き方。t は部品の開始からの時間、alpha は全体の濃さ。 */
export type FxStepDrawer = (ctx: FxDrawContext, step: FxStep, index: number, t: number, alpha: number) => void;
export type FxDrawerTable = Partial<Record<FxOp, FxStepDrawer>>;
