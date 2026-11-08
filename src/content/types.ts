/**
 * コース・犬種のデータの形。コースは版（courseVersion）ごとに固定し、配置を変えたら版を上げる。
 * 位置は「背骨」の中心線に沿った距離 u（m）と、道の中心からの横位置 x（m、右が正）で書く。
 */

export type CourseId = 'park' | 'shopping-street' | 'riverside' | 'practice';
export type DogId = 'shiba' | 'corgi' | 'whippet';

export interface DogSpec {
  id: DogId;
  name: string;
  /** 直線の最高速の指数（柴犬=100）。 */
  speedIndex: number;
  /** 目標の横位置に届く速さの指数（柴犬=100）。 */
  handlingIndex: number;
  /** 見た目だけに使う。接触範囲の計算には使わない。 */
  look: DogLook;
}

export interface DogLook {
  body: string;
  belly: string;
  ear: 'pointy' | 'big' | 'folded';
  tail: 'curl' | 'stub' | 'thin';
  legLength: number;
  bodyLength: number;
  bodyHeight: number;
}

export type Edge = 'wall' | 'drop';

export interface SpineSeg {
  len: number;
  /** この区間で曲がる角度（度）。正が右。 */
  turn?: number;
}

export interface Key {
  u: number;
  v: number;
}

export interface ForkOption {
  to: string;
  /** 分岐点での、元の道の横位置の範囲 [xMin, xMax)。 */
  xMin: number;
  xMax: number;
  /** 道しるべが足跡を出す「技を狙える道」。 */
  trick?: boolean;
  label: string;
}

export type NextDef =
  | { kind: 'path'; to: string }
  | { kind: 'fork'; forkId: string; options: ForkOption[] }
  | { kind: 'end' };

export interface PathDef {
  id: string;
  u0: number;
  u1: number;
  /** 背骨の中心から道の中心をずらす量（キーの間はなめらかに補間）。省略時は 0。 */
  offset?: Key[];
  /** 道幅の半分（m）。キーで書くと途中で広がる・狭まる。 */
  halfWidth: number | Key[];
  /** [左, 右] の端。 */
  edges?: [Edge, Edge];
  /** 路面の高さ（m）。省略時はコース共通の高さ。 */
  height?: Key[];
  next: NextDef;
  /** 経路の記録に使う名前（例: 中央の階段）。 */
  route?: string;
}

interface Placed {
  id: string;
  path: string;
}

export type ObjectDef =
  | (Placed & { kind: 'fence'; u: number; x0: number; x1: number; height: number; depth?: number })
  | (Placed & { kind: 'wall'; u0: number; u1: number; x0: number; x1: number; height: number; look?: 'wall' | 'planter' | 'bollard' | 'shop' })
  | (Placed & { kind: 'kicker'; u0: number; u1: number; x0: number; x1: number; height: number })
  | (Placed & { kind: 'stairs'; u0: number; u1: number; steps: number })
  | (Placed & { kind: 'gate'; u: number; x0: number; x1: number; height: number; periodUs: number; offsetUs: number })
  | (Placed & { kind: 'rail'; u0: number; u1: number; x: number; h0: number; h1: number })
  | (Placed & { kind: 'food'; u: number; x: number; h: number })
  | (Placed & { kind: 'guide'; u: number; x: number; h: number })
  | (Placed & { kind: 'poop'; u: number; x: number })
  | (Placed & { kind: 'checkpoint'; u: number; x: number })
  | (Placed & { kind: 'arrow'; u: number; side: 'left' | 'right'; dir: 'left' | 'right' });

export interface SectionDef {
  path: string;
  u0: number;
  u1: number;
  /** 採点機会の番号。同じ位置の左右の分岐は同じ番号にする。 */
  opp: string;
}

export interface ChallengeDef {
  id: string;
  label: string;
  /** railFull: 指定の手すりを端まで渡りきる。route: 指定の道を通って完走する。 */
  kind: 'railFull' | 'route';
  target: string;
}

/** 自動操縦の手順。テストと自動再生で使う。 */
export type RouteStep =
  | { at: number; path?: string; steer: number }
  | { at: number; path?: string; jump: true }
  | { at: number; path?: string; trick: TrickPlan };

export interface TrickPlan {
  /** 技を出すまでの離陸からの時間。 */
  afterUs: number;
  dog?: { vertical: boolean; clockwise: boolean };
  body?: number;
  /** 同じ指で円→線（片手）にするか、2本指にするか。 */
  style?: 'two' | 'one';
}

export interface CourseDef {
  id: CourseId;
  version: string;
  name: string;
  theme: 'park' | 'street' | 'river' | 'plaza';
  /** 通常の平地最高速に掛けるコース固有の倍率。省略時は 1。 */
  speedMultiplier?: number;
  spine: { start: [number, number]; heading: number; segs: SpineSeg[] };
  height: Key[];
  paths: PathDef[];
  start: { path: string; u: number };
  goal: { path: string; u: number } | null;
  objects: ObjectDef[];
  sections: SectionDef[];
  /** タイム点の基準（0.01秒単位）。provisional は実測で固定する前の値。 */
  timeScore: { fullCs: number; zeroCs: number; provisional: boolean };
  challenge: ChallengeDef | null;
  autoRoutes: Record<string, RouteStep[]>;
}
