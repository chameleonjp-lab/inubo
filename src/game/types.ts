import type { CourseId, DogId, DogSpec } from '../content/types';
import type { CourseRt } from './track';
import type { Candidate, TrickResolution } from './tricks';

export type RunMode = 'competition' | 'practice';

/** 1走に一度発行する走行の識別情報。再挑戦は新しい走行、中断からの再開と通信の再送は同じ走行を使う。 */
export interface RunIdentity {
  runId: string;
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  dogId: DogId;
  mode: RunMode;
  /** スタート時に固定した登録名（空欄なら ''）。 */
  playerName: string;
  /** スタート時に固定した公開順位への参加可否。 */
  rankingOptIn: boolean;
  participantId: string | null;
  /** 見た目の色（能力には影響しない）。 */
  outfit: { clothes: string; helmet: string };
}

/** 指の操作から作る入力。時刻は走行時計の整数マイクロ秒。 */
export type GestureFact =
  | { kind: 'down'; atUs: number; strokeId: number }
  | { kind: 'steer'; atUs: number; strokeId: number; dx: number }
  | { kind: 'forward'; atUs: number; strokeId: number }
  | { kind: 'circle'; atUs: number; strokeId: number; vertical: boolean; clockwise: boolean; aspect: number }
  | { kind: 'line'; atUs: number; strokeId: number; dir8: number; afterCircle: boolean }
  | { kind: 'reject'; atUs: number; strokeId: number; reason: 'short' | 'open' | 'small' }
  | { kind: 'up'; atUs: number; strokeId: number; cancelled: boolean };

export type MotionMode = 'ground' | 'air' | 'rail' | 'falling';

export interface Effects {
  foodUntilUs: number | null;
  poopUntilUs: number | null;
}

export interface StrokeRec {
  strokeId: number;
  downUs: number;
  upUs: number | null;
  cancelled: boolean;
  tag: 'ground' | 'air' | 'ignored';
  jumpId: number | null;
  baseTargetX: number;
  consumed: boolean;
  candidates: Candidate[];
}

export interface JumpRec {
  jumpId: number;
  takeoffUs: number;
  kind: 'flat' | 'kicker' | 'rail' | 'drop';
  fromRail: string | null;
  strokes: number[];
  resolution: TrickResolution;
}

export interface RailGrind {
  railId: string;
  entryMm: number;
  entryUs: number;
}

export interface PendingRail {
  railId: string;
  distMm: number;
  fullLength: boolean;
}

export interface Blocked {
  solidId: string;
  face: 'front' | 'side';
  /** 側面の接触で、壁がある向き（+1=右、-1=左）。 */
  side: number;
  sinceUs: number;
}

export type SimEventKind =
  | 'countdown'
  | 'start'
  | 'pause'
  | 'resume'
  | 'jump'
  | 'land'
  | 'landFail'
  | 'trickHeld'
  | 'trickStart'
  | 'trickReject'
  | 'composite'
  | 'collide'
  | 'relaunch'
  | 'clear'
  | 'railOn'
  | 'railOff'
  | 'railScore'
  | 'railLost'
  | 'food'
  | 'boostEnd'
  | 'poop'
  | 'slowEnd'
  | 'guide'
  | 'guideClose'
  | 'fork'
  | 'merge'
  | 'checkpoint'
  | 'fall'
  | 'respawn'
  | 'sectionScore'
  | 'sectionMiss'
  | 'streak'
  | 'gateLamp'
  | 'gateRise'
  | 'gateFall'
  | 'slope'
  | 'goal';

/** 接触と技の出来事。計算側で1回だけ発行し、音や表示はそれを読む。 */
export interface SimEvent {
  runId: string;
  seq: number;
  atUs: number;
  kind: SimEventKind;
  pathId: string;
  sMm: number;
  x: number;
  y: number;
  objId?: string;
  data?: Record<string, number | string | boolean | null | string[]>;
}

export interface SettledJump {
  jumpId: number;
  atUs: number;
  opp: string | null;
  sectionKey: string | null;
  names: string[];
  base: number;
  composite: boolean;
  tenths: number;
  points: number;
  awarded: number;
  onRail: boolean;
}

export interface FailureRec {
  jumpId: number;
  atUs: number;
  opp: string | null;
  sectionKey: string | null;
  /** 成功していれば得られたはずの基礎点（複合の分を含む）。 */
  wouldBase: number;
  reason: 'underRotated' | 'tilted';
  names: string[];
  composite: boolean;
}

export interface ScoreState {
  scoredOpps: Record<string, { points: number; jumpId: number; sectionKey: string }>;
  scoredRails: Record<string, number>;
  streak: number;
  streakBonus: number;
  jumpPoints: number;
  railPoints: number;
  settledJumps: Record<number, true>;
  jumps: SettledJump[];
  failures: FailureRec[];
  railLog: { railId: string; distMm: number; points: number; lost: boolean }[];
  missedOpps: string[];
}

export interface NearMiss {
  opp: string;
  sectionKey: string;
  sectionNumber: number;
  wouldBase: number;
  names: string[];
  hint: string;
}

/** ゴールで固定する確定結果。結果画面・保存・共有・順位送信は同じ内容を受け取る。 */
export interface RunResult {
  runId: string;
  courseId: CourseId;
  courseVersion: string;
  rulesVersion: string;
  dogId: DogId;
  mode: RunMode;
  finishUs: number;
  recordCs: number;
  timeScore: number;
  trickRaw: number;
  trickScore: number;
  total: number;
  jumpPoints: number;
  railPoints: number;
  streakBonus: number;
  sections: { opp: string; points: number; state: 'scored' | 'missed' | 'open' }[];
  rails: { railId: string; points: number }[];
  jumps: SettledJump[];
  nearMiss: NearMiss | null;
  route: string[];
  challengeDone: boolean;
  itemsTaken: string[];
}

export interface PoseSample {
  tUs: number;
  pathId: string;
  s: number;
  x: number;
  y: number;
}

export interface SimState {
  id: RunIdentity;
  course: CourseRt;
  dog: DogSpec;
  simUs: number;
  finished: boolean;
  result: RunResult | null;
  pathId: string;
  s: number;
  x: number;
  targetX: number;
  y: number;
  vy: number;
  mode: MotionMode;
  baseSpeed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  blocked: Blocked | null;
  ghostGates: string[];
  basePitch: number;
  lastCheckpoint: { pathId: string; s: number; x: number; id: string };
  fallUntilUs: number | null;
  effects: Effects;
  consumed: Record<string, true>;
  guide: { active: boolean; forkId: string | null };
  jump: JumpRec | null;
  jumpCounter: number;
  rail: RailGrind | null;
  pendingRail: PendingRail | null;
  railsCompleted: string[];
  strokes: Record<number, StrokeRec>;
  score: ScoreState;
  inputQueue: GestureFact[];
  inputLog: GestureFact[];
  events: SimEvent[];
  eventSeq: number;
  route: string[];
  forkStack: string[];
  gatePhases: Record<string, string>;
  slopeSign: number;
  /** 同じ物への接触音を重ねないための、最後に接触を知らせた時刻。 */
  collideAt: Record<string, number>;
  /** 直前に「区間を抜けた」と処理した区間と時刻（道の終わりと重なったときの二重処理を防ぐ）。 */
  exitedSection: { key: string; atUs: number } | null;
}
