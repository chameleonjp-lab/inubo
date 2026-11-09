import { GRAVITY, JUMP_VY, KICKER_VY, LATERAL_SPEED, TICK_US } from './rules';
import {
  COPING_HALF_WIDTH,
  KICKER,
  LAB_FIXTURES,
  RAMP_RADIUS,
  RAMP_TOP_Q,
  labEdge,
  rampPoint,
  sampleLabSurface,
  type LabEdge,
  type LabFixtureId,
} from './trick-lab-terrain';
import { TRICK_LAB_LESSONS, labDemo, type LabButtonId, type LabDemoStep, type LabLesson } from '../content/trick-lab';
import type { DogId } from '../content/types';

/**
 * 技の練習の計算。競技の走行（run.ts）とは別の状態を持ち、記録や順位には一切触れない。
 * 時刻は試行の開始からの整数マイクロ秒。刻みは競技と同じ TICK_US（5ミリ秒）。
 * 同じ練習時刻の入力列なら、描画の間隔や速度設定にかかわらず同じ結果になる。
 */

// ------------------------------------------------------------------ 入力

export type Stance = 'regular' | 'goofy';
export type Load = 'front' | 'center' | 'back';
export type Hand = 'front' | 'back';
/** 犬の背の練習用ベルトに付けた持ち手。toe / heel は両足の間のつま先側・かかと側。 */
export type Handle = 'nose' | 'tail' | 'toe' | 'heel';
export type Tilt = 'up' | 'level' | 'down';
export type FlipDir = 'none' | 'kick' | 'heel';
/** 縁から抜けるときの動き。half は進入時から数えて合計180°になるまで回す。 */
export type ExitMotion = 'straight' | 'revert' | 'backward' | 'bsHalf' | 'fsHalf';

/** 停止中に選ぶ準備。角度は度で、正がフロントサイド（FS）、負がバックサイド（BS）。 */
export interface LabSetup {
  dogYaw: number;
  flip: FlipDir;
  riderYaw: number;
  tilt: Tilt;
  exitMotion: ExitMotion;
  hand: Hand;
  handle: Handle;
}

export const NEUTRAL_SETUP: LabSetup = {
  dogYaw: 0,
  flip: 'none',
  riderYaw: 0,
  tilt: 'level',
  exitMotion: 'straight',
  hand: 'front',
  handle: 'nose',
};

export type LabAction =
  | { type: 'start' }
  | { type: 'aim'; dx: number }
  | { type: 'pop' }
  | { type: 'setup'; setup: Partial<LabSetup> }
  | { type: 'load'; load: Load }
  | { type: 'catch' }
  | { type: 'grab' }
  | { type: 'release' }
  | { type: 'plant' }
  | { type: 'brake' }
  | { type: 'exit' };

export interface LabInput {
  attemptId: string;
  atUs: number;
  seq: number;
  action: LabAction;
}

/** 「左」「右」1回、または画面の短辺の10%の横払いで動かす横の目標（メートル）。 */
export const AIM_STEP_M = 0.4;
/** 短辺に対する横払いの比率を横の移動量に直す。 */
export function aimFromSwipe(fractionOfShortSide: number): number {
  return Math.round((fractionOfShortSide / 0.1) * AIM_STEP_M * 1000) / 1000;
}

// ------------------------------------------------------------------ 試作値

export const LAB_ENTRY_SPEED = 3.5;
export const LAB_RAMP_SPEED = 8;
export const LAB_TIMEOUT_US = 8_000_000;
const DOG_SPIN_US = 420_000;
const DOG_QUARTER_US = 240_000;
const FLIP_US = 320_000;
const RIDER_US = 480_000;
const REVERT_US = 180_000;
const HALF_TURN_US = 400_000;
export const REACH_US = 150_000;
const PLANT_US = 120_000;
/** 跳んでから膝を引き上げ、手が持ち手に届くようになるまで。 */
const TUCK_US = 100_000;
export const MIN_GRAB_HOLD_US = 120_000;
export const ANGLE_TOL = 15;
const LAND_AXIS_TOL = 30;
export const STABLE_US = 150_000;
export const STABLE_DIST = 0.2;
export const MANUAL_MIN_US = 500_000;
export const MANUAL_MIN_DIST = 1.0;
export const SLIDE_MIN_DIST = 1.0;
export const STALL_MIN_US = 200_000;
export const ROCK_MIN_US = 80_000;
const BRAKE_DECEL = 3;
const BRAKE_US = 350_000;
/** これより遅く縁に着けば止まれる。速いと縁を越えて飛び出す。 */
export const RAMP_LOCK_SPEED = 3.0;
const SLIDE_FRICTION = 0.6;
const PAD_RADIUS = 0.03;
const BODY_HALF_WIDTH = 0.15;
/** 犬の長軸上の位置（中心から前が正）。 */
const PART_OFFSET = { noseEnd: 0.5, frontPad: 0.35, center: 0, rearPad: -0.35, tailEnd: -0.5 } as const;
const PAW_OFFSET = 0.35;
/** 31: 縁の手前、弧に沿ってこの範囲で跳ぶと縁へ戻れる。 */
export const DISASTER_ZONE = { near: 0.5, far: 1.2 } as const;
const RAMP_AIR_US = 600_000;

// ------------------------------------------------------------------ 状態

export type SupportPart = 'bothPads' | 'frontPad' | 'rearPad' | 'noseEnd' | 'tailEnd' | 'center';
export type AngleClass = 'parallel' | 'perpendicular' | 'diagonal';
export type PadId = 'frontPad' | 'rearPad';

export type LabPhase = 'ready' | 'entry' | 'air' | 'support' | 'landed' | 'done';

export type LabFailReason = 'wrongRotation' | 'wrongSupport' | 'wrongOrder' | 'earlyRelease' | 'collision' | 'unstableLanding' | 'timeout';

export type LabOutcome =
  | { kind: 'success'; atUs: number; detail: string }
  | { kind: 'fail'; atUs: number; reason: LabFailReason; detail: string }
  | { kind: 'abort'; atUs: number; detail: string };

export type LabEventKind =
  | 'setup'
  | 'start'
  | 'aim'
  | 'load'
  | 'pop'
  | 'takeoff'
  | 'catch'
  | 'grab'
  | 'grabReach'
  | 'grabMiss'
  | 'release'
  | 'plant'
  | 'plantContact'
  | 'brake'
  | 'exit'
  | 'manualOn'
  | 'manualOff'
  | 'supportOn'
  | 'supportOff'
  | 'stall'
  | 'zone'
  | 'land'
  | 'ignored'
  | 'success'
  | 'fail';

export interface LabEvent {
  atUs: number;
  kind: LabEventKind;
  detail?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface LabContact {
  atUs: number;
  endUs: number | null;
  obstacleId: string;
  surfaceId: string;
  /** 部位: 犬の足組、パッド・裏、人の足・手。 */
  part: string;
  face: 'top' | 'side' | 'ground';
  load: boolean;
  pos: [number, number, number];
  speed: number;
}

interface Rotation {
  axis: 'dogYaw' | 'flip' | 'riderYaw';
  from: number;
  to: number;
  startUs: number;
  durUs: number;
}

export interface GrabRec {
  hand: Hand;
  handle: Handle;
  pressUs: number;
  reachUs: number | null;
  releaseUs: number | null;
  airHoldUs: number;
  onGround: boolean;
}

export interface SupportRec {
  part: SupportPart;
  obstacleId: string;
  angle: AngleClass;
  crossed: PadId[];
  /** 支えていない側の端がどちらにあるか（進入側・反対側）。 */
  hang: { end: 'front' | 'rear'; side: 'entry' | 'far' } | null;
  tilt: Tilt;
  onUs: number;
  offUs: number | null;
  distance: number;
  stillUs: number;
  /** 縁の上で回した角度（度）。 */
  turnedDeg: number;
}

export interface LabState {
  attemptId: string;
  lessonId: string;
  fixtureId: LabFixtureId;
  stance: Stance;
  dogId: DogId;
  /** つま先側の横の向き（regular: +1、goofy: -1）。 */
  toe: 1 | -1;
  timeUs: number;
  startUs: number | null;
  phase: LabPhase;
  setup: LabSetup;
  load: Load;
  /** 直線の地形での位置と速度。 */
  s: number;
  x: number;
  y: number;
  vs: number;
  vy: number;
  targetX: number;
  /** 曲面ランプでの弧の長さと速度（上りが正）。 */
  q: number;
  vq: number;
  /** 犬・人の前が最初に向いていた向きからの、進行方向に対する基準の角度（フェイキーは180）。 */
  baseYaw: number;
  dogYaw: number;
  flip: number;
  riderYaw: number;
  rotations: Rotation[];
  /** 人の足が犬の背から離れている（足を戻す操作が要る）。 */
  feetOff: boolean;
  popped: boolean;
  takeoffUs: number | null;
  takeoffKind: 'pop' | 'kicker' | 'drop' | 'edge' | null;
  brakeUntilUs: number;
  hand: { state: 'idle' | 'reaching' | 'holding'; untilUs: number };
  grabs: GrabRec[];
  plant: { state: 'none' | 'reaching' | 'down'; untilUs: number; contactUs: number | null };
  catchUs: number | null;
  manual: { load: Load; onUs: number; startS: number } | null;
  manualDone: boolean;
  edge: LabEdge | null;
  entrySide: 1 | -1;
  support: SupportRec | null;
  supports: SupportRec[];
  /** 縁を離れる途中（回し終えてから離れる）。 */
  leaving: { atUs: number; descend: boolean } | null;
  landed: { atUs: number; s: number; q: number } | null;
  contacts: LabContact[];
  events: LabEvent[];
  outcome: LabOutcome | null;
  appliedSeq: number[];
  /** 31のランプでの空中の終わり。 */
  rampAirUntilUs: number | null;
  rampPopDist: number | null;
}

export interface LabUpdate {
  state: LabState;
  events: LabEvent[];
}

export function lessonById(id: string): LabLesson {
  const l = TRICK_LAB_LESSONS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lesson ${id}`);
  return l;
}

export function createLabAttempt(opts: { attemptId: string; lessonId: string; fixtureId: LabFixtureId; stance: Stance; dogId: DogId }): LabState {
  const lesson = lessonById(opts.lessonId);
  const toe: 1 | -1 = opts.stance === 'regular' ? 1 : -1;
  const req = lesson.req;
  const edgeSide = req.kind === 'edge' ? req.edge.side : 1;
  const edge = labEdge(opts.fixtureId, (edgeSide * toe) as 1 | -1);
  const st: LabState = {
    ...opts,
    toe,
    timeUs: 0,
    startUs: null,
    phase: 'ready',
    setup: { ...NEUTRAL_SETUP },
    load: 'center',
    s: 0,
    x: 0,
    y: 0,
    vs: 0,
    vy: 0,
    targetX: 0,
    q: 0,
    vq: 0,
    baseYaw: 0,
    dogYaw: 0,
    flip: 0,
    riderYaw: 0,
    rotations: [],
    feetOff: false,
    popped: false,
    takeoffUs: null,
    takeoffKind: null,
    brakeUntilUs: 0,
    hand: { state: 'idle', untilUs: 0 },
    grabs: [],
    plant: { state: 'none', untilUs: 0, contactUs: null },
    catchUs: null,
    manual: null,
    manualDone: false,
    edge,
    entrySide: edge ? (edge.x > 0 ? -1 : 1) : 1,
    support: null,
    supports: [],
    leaving: null,
    landed: null,
    contacts: [],
    events: [],
    outcome: null,
    appliedSeq: [],
    rampAirUntilUs: null,
    rampPopDist: null,
  };
  if (LAB_FIXTURES[opts.fixtureId].kind === 'line') {
    const surf = sampleLabSurface(opts.fixtureId, 0)!;
    st.y = surf.height;
  }
  if (req.kind === 'ramp') {
    st.baseYaw = req.ramp.fakie ? 180 : 0;
    if (req.ramp.start === 'coping') {
      // 25: 台の上で後端裏を縁に掛け、前を曲面へ向けて静止している。
      st.q = RAMP_TOP_Q;
      st.baseYaw = 180;
      st.load = 'back';
    }
    const p = rampPoint(st.q);
    st.s = p.s;
    st.y = p.y;
  }
  return st;
}

// ------------------------------------------------------------------ 補助

/** 関数の中で状態が変わるため、型の絞り込みに頼らず確かめる。 */
function isDone(st: LabState): boolean {
  return st.phase === 'done';
}

function emit(st: LabState, out: LabEvent[], kind: LabEventKind, detail?: string, data?: LabEvent['data']): void {
  const e: LabEvent = { atUs: st.timeUs, kind, ...(detail ? { detail } : {}), ...(data ? { data } : {}) };
  st.events.push(e);
  out.push(e);
}

function finish(st: LabState, out: LabEvent[], outcome: LabOutcome): void {
  if (st.outcome) return;
  st.outcome = outcome;
  st.phase = 'done';
  if (outcome.kind === 'success') emit(st, out, 'success', outcome.detail);
  else if (outcome.kind === 'fail') emit(st, out, 'fail', outcome.detail, { reason: outcome.reason });
}

function fail(st: LabState, out: LabEvent[], reason: LabFailReason, detail: string): void {
  finish(st, out, { kind: 'fail', atUs: st.timeUs, reason, detail });
}

/** 角度を -180〜180 に収める。 */
function wrap180(a: number): number {
  const r = ((a % 360) + 540) % 360 - 180;
  return r === -180 ? 180 : r;
}

function angleAt(r: Rotation, t: number): number {
  const k = Math.max(0, Math.min(1, (t - r.startUs) / r.durUs));
  return r.from + (r.to - r.from) * k;
}

function updateRotations(st: LabState): void {
  for (const r of st.rotations) {
    if (st.timeUs < r.startUs) continue;
    st[r.axis] = angleAt(r, st.timeUs);
  }
  st.rotations = st.rotations.filter((r) => st.timeUs < r.startUs + r.durUs);
}

function addRotation(st: LabState, axis: Rotation['axis'], delta: number, durUs: number): void {
  if (Math.abs(delta) < 1e-9) return;
  st.rotations.push({ axis, from: st[axis], to: st[axis] + delta, startUs: st.timeUs, durUs });
}

/** 回転中のものを止めて、その場の角度で固定する（着地後は回り足さない）。 */
function freezeRotations(st: LabState): void {
  updateRotations(st);
  st.rotations = [];
}

function flipDeg(f: FlipDir): number {
  return f === 'kick' ? 360 : f === 'heel' ? -360 : 0;
}

function dogYawDuration(dogDelta: number, riderDelta: number): number {
  if (riderDelta !== 0 && Math.sign(riderDelta) === Math.sign(dogDelta) && Math.abs(riderDelta) === Math.abs(dogDelta)) return RIDER_US;
  return Math.abs(dogDelta) <= 90 ? DOG_QUARTER_US : DOG_SPIN_US;
}

/** 踏切で、準備した回転を始める。犬だけが回る場合は足が背から離れる。 */
function startAirRotations(st: LabState): void {
  const { dogYaw, riderYaw, flip } = st.setup;
  const f = flipDeg(flip);
  addRotation(st, 'dogYaw', dogYaw, dogYawDuration(dogYaw, riderYaw));
  addRotation(st, 'riderYaw', riderYaw, RIDER_US);
  addRotation(st, 'flip', f, FLIP_US);
  // 90°以内の向き変えは足を乗せたまま腰でひねる。犬だけが大きく回る・裏返る場合は足が離れる。
  if (f !== 0 || Math.abs(dogYaw - riderYaw) > 90) st.feetOff = true;
}

/** 足を戻せるか。犬だけの回転が終わったか、犬と人の差が目標にそろい、裏返りが終わっていればよい。 */
function catchRemaining(st: LabState): number {
  const dog = st.rotations.find((r) => r.axis === 'dogYaw');
  const rider = st.rotations.find((r) => r.axis === 'riderYaw');
  const fl = st.rotations.find((r) => r.axis === 'flip');
  const dogTo = dog ? dog.to : st.dogYaw;
  const riderTo = rider ? rider.to : st.riderYaw;
  const own = Math.abs(dogTo - st.dogYaw);
  const rel = Math.abs((dogTo - riderTo) - (st.dogYaw - st.riderYaw));
  const flipRemain = fl ? Math.abs(fl.to - st.flip) : 0;
  return Math.max(Math.min(own, rel), flipRemain);
}

/** 足で受けたあとは、犬は人と一緒に回る（残りの人の回転だけ進む）。 */
function lockDogToRider(st: LabState): void {
  // 残りがわずかな裏返りは、足で受けた時点で表に戻す。
  const fl = st.rotations.find((r) => r.axis === 'flip');
  if (fl) st.flip = fl.to;
  st.rotations = st.rotations.filter((r) => r.axis !== 'dogYaw' && r.axis !== 'flip');
  const rider = st.rotations.find((r) => r.axis === 'riderYaw');
  if (rider) {
    const end = rider.startUs + rider.durUs;
    const rest = rider.to - st.riderYaw;
    if (end > st.timeUs) st.rotations.push({ axis: 'dogYaw', from: st.dogYaw, to: st.dogYaw + rest, startUs: st.timeUs, durUs: end - st.timeUs });
  }
}

function lineSurface(st: LabState, s: number) {
  return sampleLabSurface(st.fixtureId, s);
}

/** 犬の前端の向き（s, x）。正の角度（FS）は前端がかかと側へ向く。 */
function axisDir(st: LabState): [number, number] {
  const a = ((st.dogYaw + st.baseYaw) * Math.PI) / 180;
  return [Math.cos(a), -st.toe * Math.sin(a)];
}

function partPos(st: LabState, off: number): [number, number] {
  const [ds, dx] = axisDir(st);
  return [st.s + ds * off, st.x + dx * off];
}

function angleClass(yaw: number): AngleClass | null {
  const a = Math.abs(wrap180(yaw));
  const m = Math.min(a, 180 - a);
  if (m <= ANGLE_TOL) return 'parallel';
  if (Math.abs(m - 90) <= ANGLE_TOL) return 'perpendicular';
  if (m >= 20 && m <= 60) return 'diagonal';
  return null;
}

function contact(st: LabState, part: string, obstacleId: string, surfaceId: string, face: LabContact['face'], load: boolean): LabContact {
  const c: LabContact = { atUs: st.timeUs, endUs: null, obstacleId, surfaceId, part, face, load, pos: [st.s, st.x, st.y], speed: st.vs };
  st.contacts.push(c);
  return c;
}

function endContacts(st: LabState, obstacleId: string): void {
  for (const c of st.contacts) if (c.obstacleId === obstacleId && c.endUs === null) c.endUs = st.timeUs;
}

function airborneHandReachable(handle: Handle, hand: Hand): boolean {
  if (hand === 'front' && handle === 'tail') return false;
  if (hand === 'back' && handle === 'nose') return false;
  return true;
}

function reachable(st: LabState): boolean {
  const { hand, handle } = st.setup;
  if (st.phase === 'air' && st.takeoffUs !== null) {
    return st.timeUs - st.takeoffUs >= TUCK_US && airborneHandReachable(handle, hand);
  }
  // 地上では、しゃがんだ後ろ手が背の側面（つま先側・かかと側）に届くだけ。
  return (st.phase === 'entry' || st.phase === 'landed') && hand === 'back' && (handle === 'toe' || handle === 'heel');
}

function lastGrab(st: LabState): GrabRec | null {
  return st.grabs.length ? st.grabs[st.grabs.length - 1] : null;
}

// ------------------------------------------------------------------ 入力の適用

function applyInput(st: LabState, out: LabEvent[], input: LabInput): void {
  const a = input.action;
  const ignore = (why: string) => emit(st, out, 'ignored', why, { action: a.type });
  if (isDone(st)) return;
  switch (a.type) {
    case 'setup':
      if (st.phase !== 'ready') return ignore('準備は止まっている間だけ選べます');
      st.setup = { ...st.setup, ...a.setup };
      emit(st, out, 'setup', undefined, { ...a.setup } as Record<string, string | number>);
      return;
    case 'start':
      if (st.phase !== 'ready') return ignore('すでに走り出しています');
      startEntry(st, out);
      return;
    case 'aim':
      if (st.phase !== 'entry' && st.phase !== 'air') return ignore('今は横へ動けません');
      if (LAB_FIXTURES[st.fixtureId].kind === 'ramp') return ignore('ランプでは横へ動きません');
      st.targetX += a.dx;
      emit(st, out, 'aim', undefined, { dx: a.dx, targetX: st.targetX });
      return;
    case 'pop':
      return doPop(st, out);
    case 'load':
      return doLoad(st, out, a.load);
    case 'catch':
      return doCatch(st, out);
    case 'grab':
      if (st.hand.state !== 'idle') return ignore('手を伸ばしている途中です');
      if (st.phase === 'ready') return ignore('走り出してから');
      st.hand = { state: 'reaching', untilUs: st.timeUs + REACH_US };
      st.grabs.push({ hand: st.setup.hand, handle: st.setup.handle, pressUs: st.timeUs, reachUs: null, releaseUs: null, airHoldUs: 0, onGround: st.phase !== 'air' });
      emit(st, out, 'grab', undefined, { hand: st.setup.hand, handle: st.setup.handle });
      return;
    case 'release': {
      if (st.hand.state !== 'holding') return ignore('持っていません');
      const g = lastGrab(st)!;
      g.releaseUs = st.timeUs;
      st.hand = { state: 'idle', untilUs: 0 };
      endContacts(st, `hand:${g.handle}`);
      emit(st, out, 'release', undefined, { airHoldUs: g.airHoldUs });
      return;
    }
    case 'plant':
      if (st.phase !== 'entry' || st.plant.state !== 'none') return ignore('前足は地上で1回だけ着けます');
      st.plant = { state: 'reaching', untilUs: st.timeUs + PLANT_US, contactUs: null };
      emit(st, out, 'plant');
      return;
    case 'brake':
      if (st.phase === 'ready') return ignore('走っていません');
      st.brakeUntilUs = st.timeUs + BRAKE_US;
      emit(st, out, 'brake');
      return;
    case 'exit':
      return doExit(st, out);
  }
}

function startEntry(st: LabState, out: LabEvent[]): void {
  const lesson = lessonById(st.lessonId);
  st.startUs = st.timeUs;
  emit(st, out, 'start');
  if (lesson.req.kind === 'ramp') {
    if (lesson.req.ramp.start === 'coping') {
      st.phase = 'support';
      beginSupport(st, out, 'tailEnd', 'parallel', [], null, 'coping');
      return;
    }
    st.phase = 'entry';
    st.vq = LAB_RAMP_SPEED;
    return;
  }
  st.phase = 'entry';
  st.vs = LAB_ENTRY_SPEED;
}

function doPop(st: LabState, out: LabEvent[]): void {
  if (st.phase !== 'entry') {
    emit(st, out, 'ignored', '跳べるのは地上だけです', { action: 'pop' });
    return;
  }
  const ramp = LAB_FIXTURES[st.fixtureId].kind === 'ramp';
  st.popped = true;
  emit(st, out, 'pop');
  if (st.manual) endManual(st, out, false);
  if (ramp) {
    // 31: 縁の手前で跳び、回りながら縁へ戻る。
    st.phase = 'air';
    st.takeoffUs = st.timeUs;
    st.takeoffKind = 'pop';
    st.rampAirUntilUs = st.timeUs + RAMP_AIR_US;
    st.rampPopDist = RAMP_TOP_Q - st.q;
    startAirRotations(st);
    st.feetOff = false;
    emit(st, out, 'takeoff', undefined, { kind: 'pop', q: st.q });
    return;
  }
  const surf = lineSurface(st, st.s);
  const planted = st.plant.state === 'down';
  st.phase = 'air';
  st.vy = JUMP_VY + (surf ? surf.grade * st.vs : 0);
  st.takeoffUs = st.timeUs;
  st.takeoffKind = 'pop';
  if (st.plant.state === 'reaching') st.plant.state = 'none';
  startAirRotations(st);
  // 前足で地面を蹴って跳んだ場合、前足は背から離れている。
  if (planted) st.feetOff = true;
  endContacts(st, 'ground');
  emit(st, out, 'takeoff', undefined, { kind: 'pop', planted });
}

function doCatch(st: LabState, out: LabEvent[]): void {
  if (!st.feetOff && st.plant.state !== 'down') {
    emit(st, out, 'ignored', '足は背にあります', { action: 'catch' });
    return;
  }
  if (st.phase !== 'air') {
    if (st.plant.state === 'down' && st.phase === 'entry') {
      // 地上で前足を戻した（跳ばずにやめた）。
      st.plant = { state: 'none', untilUs: 0, contactUs: st.plant.contactUs };
      endContacts(st, 'foot:front');
      emit(st, out, 'catch', '跳ばずに前足を戻しました');
      return;
    }
    emit(st, out, 'ignored', '空中で足を戻します', { action: 'catch' });
    return;
  }
  const remain = catchRemaining(st);
  st.catchUs = st.timeUs;
  emit(st, out, 'catch', undefined, { remainDeg: Math.round(remain) });
  if (remain > ANGLE_TOL) {
    fail(st, out, 'wrongOrder', '犬が回りきる前に足を戻しました。回り終えてから「足を戻す」を押しましょう。');
    return;
  }
  st.feetOff = false;
  lockDogToRider(st);
  if (st.plant.state === 'down') {
    st.plant.state = 'none';
    endContacts(st, 'foot:front');
  }
}

function doLoad(st: LabState, out: LabEvent[], load: Load): void {
  if (isDone(st)) return;
  const prev = st.load;
  st.load = load;
  emit(st, out, 'load', undefined, { load, prev });
  if (prev === load) return;
  if (st.phase === 'entry' && LAB_FIXTURES[st.fixtureId].kind === 'line') {
    if (st.manual && load !== st.manual.load) endManual(st, out, true);
    if (!st.manual && load !== 'center') startManual(st, out, load);
    return;
  }
  if (st.phase === 'support' && st.support) {
    const sup = st.support;
    if (LAB_FIXTURES[st.fixtureId].kind === 'ramp') {
      // 端で止まる技は、反対側へ荷重を移すと曲面へ戻る。
      if (sup.part === 'tailEnd' && load === 'front') beginLeave(st, out, false);
      else if (sup.part === 'noseEnd' && load === 'back') beginLeave(st, out, false);
      else if (sup.part === 'center' && load === 'front' && sup.crossed.includes('rearPad')) beginLeave(st, out, false);
      return;
    }
    if (sup.angle === 'parallel') {
      const part: SupportPart = load === 'center' ? 'bothPads' : load === 'front' ? 'frontPad' : 'rearPad';
      switchSupport(st, out, part);
    } else beginLeave(st, out, true);
  }
}

function doExit(st: LabState, out: LabEvent[]): void {
  if (st.phase !== 'support' || !st.support || st.leaving) {
    emit(st, out, 'ignored', '縁に乗っている時に使います', { action: 'exit' });
    return;
  }
  emit(st, out, 'exit', undefined, { motion: st.setup.exitMotion });
  if (LAB_FIXTURES[st.fixtureId].kind === 'ramp' && st.support.part === 'tailEnd' && st.load !== 'front') {
    // 25: 荷重を前へ移さずに縁から外れると、勢いだけで落ちる。
    fail(st, out, 'unstableLanding', '前荷重にしないまま縁を離れました。「前」で荷重を移してから下りましょう。');
    return;
  }
  beginLeave(st, out, LAB_FIXTURES[st.fixtureId].kind === 'line');
}

// ------------------------------------------------------------------ 平地の荷重（マニュアル）

function startManual(st: LabState, out: LabEvent[], load: Load): void {
  st.manual = { load, onUs: st.timeUs, startS: st.s };
  const lifted = load === 'back' ? 'frontPaws' : 'rearPaws';
  endContacts(st, `paws:${lifted}`);
  contact(st, load === 'back' ? 'rearPaws' : 'frontPaws', 'ground', lineSurface(st, st.s)?.surfaceId ?? 'none', 'ground', true);
  emit(st, out, 'manualOn', undefined, { load });
}

function endManual(st: LabState, out: LabEvent[], touchdown: boolean): void {
  const m = st.manual!;
  const dur = st.timeUs - m.onUs;
  const dist = st.s - m.startS;
  st.manual = null;
  emit(st, out, 'manualOff', undefined, { durUs: dur, dist: Math.round(dist * 1000) / 1000, touchdown });
  if (!touchdown) return;
  const lesson = lessonById(st.lessonId);
  if (lesson.req.kind !== 'manual' || lesson.req.manual !== m.load) return;
  if (dur >= MANUAL_MIN_US && dist >= MANUAL_MIN_DIST - 1e-9) {
    st.manualDone = true;
    st.landed = { atUs: st.timeUs, s: st.s, q: st.q };
  } else {
    fail(st, out, 'wrongSupport', `${m.load === 'back' ? '前足組' : '後足組'}が早く着きました（${(dur / 1e6).toFixed(2)}秒・${dist.toFixed(2)} m）。0.50秒と1.00 m以上保ちましょう。`);
  }
}

// ------------------------------------------------------------------ 縁での支持

function beginSupport(st: LabState, out: LabEvent[], part: SupportPart, angle: AngleClass, crossed: PadId[], hang: SupportRec['hang'], obstacleId: string): void {
  const rec: SupportRec = { part, obstacleId, angle, crossed, hang, tilt: st.setup.tilt, onUs: st.timeUs, offUs: null, distance: 0, stillUs: 0, turnedDeg: 0 };
  st.support = rec;
  st.supports.push(rec);
  st.phase = 'support';
  st.vy = 0;
  contact(st, part, obstacleId, obstacleId, 'top', true);
  emit(st, out, 'supportOn', undefined, { part, angle, crossed: crossed.join(',') || null, hang: hang ? `${hang.end}:${hang.side}` : null });
}

function closeSupport(st: LabState, out: LabEvent[]): void {
  const sup = st.support;
  if (!sup) return;
  sup.offUs = st.timeUs;
  endContacts(st, sup.obstacleId);
  emit(st, out, 'supportOff', undefined, { part: sup.part, dist: Math.round(sup.distance * 1000) / 1000, stillUs: sup.stillUs });
  st.support = null;
}

function switchSupport(st: LabState, out: LabEvent[], part: SupportPart): void {
  const sup = st.support!;
  if (sup.part === part) return;
  const { angle, crossed, hang, obstacleId } = sup;
  closeSupport(st, out);
  beginSupport(st, out, part, angle, crossed, hang, obstacleId);
}

/** 縁を離れる。直線では軽く跳んで降り、ランプでは曲面へ戻る。準備した脱出の動きをここで始める。 */
function beginLeave(st: LabState, out: LabEvent[], hop: boolean): void {
  if (st.leaving) return;
  const motion = st.setup.exitMotion;
  const ramp = LAB_FIXTURES[st.fixtureId].kind === 'ramp';
  const sup = st.support!;
  let delayUs = 0;
  if (motion === 'revert') {
    const back = -wrap180(st.dogYaw);
    addRotation(st, 'dogYaw', back, REVERT_US);
    addRotation(st, 'riderYaw', -wrap180(st.riderYaw), REVERT_US);
  } else if (motion === 'bsHalf' || motion === 'fsHalf') {
    const target = motion === 'bsHalf' ? -180 : 180;
    const remain = target - st.dogYaw;
    addRotation(st, 'dogYaw', remain, HALF_TURN_US);
    addRotation(st, 'riderYaw', target - st.riderYaw, HALF_TURN_US);
    sup.turnedDeg = remain;
    // 支持が残っている間に回し始め、回し終えてから縁を離れる。
    if (ramp) delayUs = HALF_TURN_US + 40_000;
  }
  st.leaving = { atUs: st.timeUs + delayUs, descend: ramp };
  if (delayUs === 0) completeLeave(st, out, hop);
}

function completeLeave(st: LabState, out: LabEvent[], hop: boolean): void {
  const sup = st.support;
  const lesson = lessonById(st.lessonId);
  if (sup) checkSupportRequirement(st, out, lesson, sup);
  closeSupport(st, out);
  st.leaving = null;
  if (isDone(st)) return;
  if (LAB_FIXTURES[st.fixtureId].kind === 'ramp') {
    st.phase = 'entry';
    st.q = Math.min(st.q, RAMP_TOP_Q - 0.01);
    st.vq = -0.5;
    return;
  }
  st.phase = 'air';
  st.vy = hop ? 1.5 : 0.5;
  st.takeoffUs = st.timeUs;
  st.takeoffKind = 'edge';
  // 縁の途中で降りるときは、進入側へ降りる。
  if (st.edge && st.s < st.edge.s1) st.targetX = st.edge.x + st.entrySide * (st.edge.halfWidth + BODY_HALF_WIDTH + 0.45);
}

function checkSupportRequirement(st: LabState, out: LabEvent[], lesson: LabLesson, sup: SupportRec): void {
  const req = lesson.req;
  if (req.kind === 'edge') {
    const e = req.edge;
    if (sup.part !== e.support || sup.angle !== e.angle) {
      fail(st, out, 'wrongSupport', `${partName(sup.part)}（${angleName(sup.angle)}）で支えました。この技は${partName(e.support)}（${angleName(e.angle)}）で滑ります。`);
      return;
    }
    const wantCrossed = e.crossed ?? null;
    if ((wantCrossed && !sup.crossed.includes(wantCrossed)) || (!wantCrossed && sup.crossed.length > 0)) {
      fail(st, out, 'wrongOrder', wantCrossed ? `${partName(wantCrossed)}が縁の反対側へ越えていません。` : `${partName(sup.crossed[0])}が縁を越えてしまいました。`);
      return;
    }
    if (e.hang && (!sup.hang || sup.hang.end !== e.hang.end || sup.hang.side !== e.hang.side)) {
      fail(st, out, 'wrongSupport', `${e.hang.end === 'front' ? '前' : '後ろ'}側を${e.hang.side === 'entry' ? '進入側' : '反対側'}へ下げます。回す向きを確かめましょう。`);
      return;
    }
    if (e.tilt && sup.tilt !== e.tilt) {
      fail(st, out, 'wrongSupport', '先端を下げる準備（傾き：下）が必要です。');
      return;
    }
    if (sup.distance < SLIDE_MIN_DIST - 1e-9) {
      fail(st, out, 'wrongSupport', `縁に沿って${sup.distance.toFixed(2)} mで外れました。1.00 m以上続けましょう。`);
    }
    return;
  }
  if (req.kind === 'ramp') {
    const r = req.ramp;
    if (sup.part !== r.lock) {
      fail(st, out, 'wrongSupport', `${partName(sup.part)}で縁に掛かりました。この技は${partName(r.lock)}です。`);
      return;
    }
    const wantCrossed = r.crossed ?? null;
    if ((wantCrossed && !sup.crossed.includes(wantCrossed)) || (!wantCrossed && sup.crossed.length > 0)) {
      fail(st, out, 'wrongOrder', wantCrossed ? `${partName(wantCrossed)}が台の側へ越えていません。` : '縁を越えてしまいました。');
      return;
    }
    const need = r.minStillUs;
    if (sup.stillUs < need) {
      fail(st, out, 'wrongOrder', `縁で止まった時間が${(sup.stillUs / 1e6).toFixed(2)}秒でした。${(need / 1e6).toFixed(2)}秒以上止まってから戻りましょう。`);
    }
  }
}

/** 空中から縁の上面へ下りたときの支え方を決める。 */
function resolveEdgeContact(st: LabState, out: LabEvent[], edge: LabEdge): 'support' | 'miss' | 'collision' {
  const yaw = st.dogYaw + st.baseYaw;
  const cls = angleClass(yaw);
  const [, dx] = axisDir(st);
  const reach = edge.halfWidth + PAD_RADIUS;
  const lateral = st.x - edge.x;
  const span = Math.abs(dx) * 0.5 + reach;
  if (Math.abs(lateral) > span) {
    if (Math.abs(lateral) < edge.halfWidth + BODY_HALF_WIDTH + Math.abs(dx) * 0.5) return 'collision';
    return 'miss';
  }
  if (!cls) {
    contact(st, 'body', edge.id, edge.id, 'side', false);
    return 'collision';
  }
  let part: SupportPart;
  if (cls === 'parallel') {
    if (Math.abs(lateral) > reach) return 'collision';
    part = st.load === 'center' ? 'bothPads' : st.load === 'front' ? 'frontPad' : 'rearPad';
    st.x = edge.x;
  } else {
    const key: keyof typeof PART_OFFSET = cls === 'perpendicular'
      ? st.load === 'front' ? 'noseEnd' : st.load === 'back' ? 'tailEnd' : 'center'
      : st.load === 'front' ? 'frontPad' : st.load === 'back' ? 'rearPad' : 'center';
    part = key;
    // 荷重をかけた部位が縁の上に来る位置へ、犬が縁の上で落ち着く。
    st.x = edge.x - PART_OFFSET[key] * dx;
  }
  const crossed: PadId[] = [];
  for (const pad of ['frontPad', 'rearPad'] as const) {
    const [, px] = partPos(st, PART_OFFSET[pad]);
    if ((px - edge.x) * st.entrySide < -reach) crossed.push(pad);
  }
  let hang: SupportRec['hang'] = null;
  if (cls === 'diagonal' && (part === 'frontPad' || part === 'rearPad')) {
    const end = part === 'frontPad' ? 'rear' : 'front';
    const [, ex] = partPos(st, end === 'front' ? PART_OFFSET.noseEnd : PART_OFFSET.tailEnd);
    hang = { end, side: (ex - edge.x) * st.entrySide > 0 ? 'entry' : 'far' };
  }
  st.y = edge.top;
  st.targetX = st.x;
  beginSupport(st, out, part, cls, crossed, hang, edge.id);
  return 'support';
}

// ------------------------------------------------------------------ 着地と成否

function landingCheck(st: LabState, out: LabEvent[], lesson: LabLesson): void {
  freezeRotations(st);
  const req = lesson.req;
  emit(st, out, 'land', undefined, { s: Math.round(st.s * 1000) / 1000, dogYaw: Math.round(st.dogYaw), flip: Math.round(st.flip), riderYaw: Math.round(st.riderYaw) });
  if (st.hand.state === 'holding' || st.hand.state === 'reaching') {
    if (st.hand.state === 'reaching') {
      st.hand = { state: 'idle', untilUs: 0 };
      emit(st, out, 'grabMiss', '着地までに手が届きませんでした');
      if (req.kind === 'air' && req.grab) {
        fail(st, out, 'wrongOrder', '手が持ち手に届く前に着地しました。跳んだら早めに「つかむ」を押しましょう。');
        return;
      }
    } else {
      fail(st, out, 'wrongOrder', '持ったまま着地しました。着地の前に「はなす」を押しましょう。');
      return;
    }
  }
  if (st.feetOff) {
    fail(st, out, 'unstableLanding', '足が犬の背に戻らないまま着地しました。「足を戻す」を押しましょう。');
    return;
  }
  // 前後の犬足が同じ連続した路面へ着くか。
  if (LAB_FIXTURES[st.fixtureId].kind === 'line') {
    const [ds] = axisDir(st);
    const a = lineSurface(st, st.s + ds * PAW_OFFSET);
    const b = lineSurface(st, st.s - ds * PAW_OFFSET);
    if (!a || !b || a.surfaceId !== b.surfaceId) {
      fail(st, out, 'unstableLanding', '前後の足が別の高さに着きました。踏切の位置を変えて、平らな所へ着地しましょう。');
      return;
    }
  }
  // 犬と人の向きが進行方向（または逆向き）にそろっているか。
  const dogOff = Math.abs(wrap180(st.dogYaw));
  const riderOff = Math.abs(wrap180(st.riderYaw));
  const flipOff = Math.abs(wrap180(st.flip));
  if (Math.min(dogOff, 180 - dogOff) > LAND_AXIS_TOL || Math.min(riderOff, 180 - riderOff) > LAND_AXIS_TOL || flipOff > LAND_AXIS_TOL) {
    fail(st, out, 'wrongRotation', '回転が途中のまま着地しました。');
    return;
  }
  if (req.kind === 'air') {
    const want = { dogYaw: req.dogYaw ?? 0, flip: req.flip ?? 0, riderYaw: req.riderYaw ?? 0 };
    const got = { dogYaw: st.dogYaw, flip: st.flip, riderYaw: st.riderYaw };
    for (const axis of ['dogYaw', 'flip', 'riderYaw'] as const) {
      if (Math.abs(got[axis] - want[axis]) > ANGLE_TOL) {
        fail(st, out, 'wrongRotation', rotationHint(axis, want[axis], got[axis]));
        return;
      }
    }
  }
  st.phase = 'landed';
  st.landed = { atUs: st.timeUs, s: st.s, q: st.q };
  contact(st, 'allPaws', 'ground', lineSurface(st, st.s)?.surfaceId ?? 'ramp', 'ground', true);
}

function rotationHint(axis: 'dogYaw' | 'flip' | 'riderYaw', want: number, got: number): string {
  const name = axis === 'dogYaw' ? '犬の水平回転' : axis === 'flip' ? '犬の裏返り' : '人の水平回転';
  const fmt = (v: number) => {
    const r = Math.round(v);
    if (r === 0) return '0°';
    if (axis === 'flip') return `${r > 0 ? 'キック' : 'ヒール'}${Math.abs(r)}°`;
    return `${r > 0 ? 'FS' : 'BS'}${Math.abs(r)}°`;
  };
  return `${name}が${fmt(got)}でした。この技は${fmt(want)}です。`;
}

/** 安定して進めたら、技全体の条件を確かめて成否を閉じる。 */
function finalize(st: LabState, out: LabEvent[], lesson: LabLesson): void {
  const req = lesson.req;
  if (req.kind === 'air') {
    if (req.pop !== false && !st.popped && st.takeoffKind !== 'kicker') {
      fail(st, out, 'wrongOrder', '跳ばずに段差から落ちました。「跳ぶ」で踏み切りましょう。');
      return;
    }
    if (st.takeoffUs === null) {
      fail(st, out, 'timeout', 'まだ跳んでいません。');
      return;
    }
    const grabs = st.grabs.filter((g) => g.reachUs !== null);
    if (req.grab) {
      const g = grabs[grabs.length - 1];
      if (!g) {
        fail(st, out, 'wrongSupport', '手で持てていません。');
        return;
      }
      if (g.hand !== req.grab.hand || g.handle !== req.grab.handle) {
        fail(st, out, 'wrongSupport', `${handName(g.hand)}で${handleName(g.handle)}を持ちました。この技は${handName(req.grab.hand)}で${handleName(req.grab.handle)}です。`);
        return;
      }
      if (req.plant === 'boneless') {
        if (!checkBonelessOrder(st, out, g)) return;
      } else if (g.airHoldUs < MIN_GRAB_HOLD_US) {
        fail(st, out, 'earlyRelease', `空中で持った時間が${Math.round(g.airHoldUs / 1000)}ミリ秒でした。0.12秒以上持ってから離しましょう。`);
        return;
      }
    } else if (grabs.length) {
      fail(st, out, 'wrongSupport', 'この技は手で持ちません。');
      return;
    }
    if (req.plant && st.plant.contactUs === null) {
      fail(st, out, 'wrongOrder', '前足が地面に着いていません。跳ぶ前に「前足を着く」を押しましょう。');
      return;
    }
    if (req.plant === 'noComply' && st.plant.contactUs !== null && st.takeoffUs !== null && st.plant.contactUs > st.takeoffUs) {
      fail(st, out, 'wrongOrder', '前足を着いてから跳びましょう。');
      return;
    }
    if (!req.plant && st.plant.contactUs !== null) {
      fail(st, out, 'wrongOrder', 'この技では前足を地面に着けません。');
      return;
    }
  } else if (req.kind === 'manual') {
    if (!st.manualDone) {
      fail(st, out, 'timeout', '荷重の技がまだできていません。');
      return;
    }
  } else if (req.kind === 'edge') {
    const ok = st.supports.some((s) => s.part === req.edge.support && s.distance >= SLIDE_MIN_DIST - 1e-9);
    if (!ok) {
      fail(st, out, 'wrongSupport', '縁で滑れていません。');
      return;
    }
  } else if (req.kind === 'ramp') {
    if (!st.supports.length) {
      fail(st, out, 'wrongSupport', '縁に掛かっていません。');
      return;
    }
    const total = st.dogYaw + st.baseYaw;
    const forward = Math.cos((total * Math.PI) / 180) < 0;
    const want = req.ramp.descend;
    if ((want === 'forward') !== forward) {
      fail(st, out, 'wrongRotation', want === 'forward' ? '後ろ向きのまま下りました。前向きで下る技です。' : '前向きで下りました。体を回さず後ろ向きで下る技です。');
      return;
    }
    if (req.ramp.turn !== undefined && Math.abs(st.dogYaw - req.ramp.turn) > ANGLE_TOL) {
      fail(st, out, 'wrongRotation', rotationHint('dogYaw', req.ramp.turn, st.dogYaw));
      return;
    }
  }
  finish(st, out, { kind: 'success', atUs: st.timeUs, detail: lesson.successText ?? `${lesson.ja}が決まりました。` });
}

function checkBonelessOrder(st: LabState, out: LabEvent[], g: GrabRec): boolean {
  const order: [string, number | null][] = [
    ['手で持つ', g.reachUs],
    ['前足を地面に着く', st.plant.contactUs],
    ['跳ぶ', st.takeoffUs],
    ['足を戻す', st.catchUs],
    ['手を離す', g.releaseUs],
  ];
  for (let i = 0; i < order.length; i++) {
    if (order[i][1] === null) {
      fail(st, out, 'wrongOrder', `「${order[i][0]}」が抜けています。持つ→前足を着く→跳ぶ→足を戻す→離す の順です。`);
      return false;
    }
    if (i > 0 && order[i][1]! < order[i - 1][1]!) {
      fail(st, out, 'wrongOrder', `「${order[i][0]}」が「${order[i - 1][0]}」より先でした。持つ→前足を着く→跳ぶ→足を戻す→離す の順です。`);
      return false;
    }
  }
  return true;
}

export function partName(p: SupportPart | PadId): string {
  return { bothPads: '前後のパッド', frontPad: '前パッド', rearPad: '後パッド', noseEnd: '前端の裏', tailEnd: '後端の裏', center: '中央の裏' }[p];
}

function angleName(a: AngleClass): string {
  return { parallel: '縁と平行', perpendicular: '縁と直角', diagonal: '斜め' }[a];
}

export function handName(h: Hand): string {
  return h === 'front' ? '前の手' : '後ろの手';
}

export function handleName(h: Handle): string {
  return { nose: '前端', tail: '後端', toe: 'つま先側', heel: 'かかと側' }[h];
}

// ------------------------------------------------------------------ 1刻み

function stepLine(st: LabState, out: LabEvent[], lesson: LabLesson): void {
  const dt = TICK_US / 1e6;
  const t = st.timeUs;
  if (st.brakeUntilUs > t && st.vs > 0) st.vs = Math.max(0, st.vs - BRAKE_DECEL * dt);
  // 横の目標へ寄せる。
  const dxNeed = st.targetX - st.x;
  if (st.phase === 'entry' || st.phase === 'air' || st.phase === 'landed') {
    const step = Math.min(Math.abs(dxNeed), LATERAL_SPEED * dt);
    st.x += Math.sign(dxNeed) * step;
  }
  const edge = st.edge;
  if (st.phase === 'entry' || st.phase === 'landed') {
    const before = lineSurface(st, st.s);
    st.s += st.vs * dt;
    const surf = lineSurface(st, st.s);
    if (surf && surf.grade < 0) st.vs = Math.min(6, st.vs - surf.grade * 4 * dt);
    if (edge && st.supports.length === 0 && st.s >= edge.s0 - 0.5 && st.s <= edge.s1 && Math.abs(st.x - edge.x) < edge.halfWidth + BODY_HALF_WIDTH) {
      contact(st, 'body', edge.id, edge.id, 'side', false);
      fail(st, out, 'collision', '縁の側面にぶつかりました。跳んで上面へ乗りましょう。');
      return;
    }
    if (st.fixtureId === 'kicker' && before?.surfaceId === 'kicker' && surf?.surfaceId !== 'kicker' && st.phase === 'entry') {
      // 踏切台の上端から飛び出す。
      st.phase = 'air';
      st.y = KICKER.top;
      st.vy = KICKER_VY;
      st.takeoffUs = st.timeUs;
      st.takeoffKind = 'kicker';
      st.popped = true;
      if (st.manual) endManual(st, out, false);
      startAirRotations(st);
      endContacts(st, 'ground');
      emit(st, out, 'takeoff', undefined, { kind: 'kicker' });
      return;
    }
    if (!surf || (before && before.height - surf.height > 0.05)) {
      // 開口部や段から落ちる（跳ばずに落ちた）。
      if (st.phase === 'landed') {
        fail(st, out, 'unstableLanding', '着地のあとに段から落ちました。');
        return;
      }
      st.phase = 'air';
      st.vy = 0;
      st.takeoffUs = st.timeUs;
      st.takeoffKind = 'drop';
      if (st.manual) endManual(st, out, false);
      endContacts(st, 'ground');
      emit(st, out, 'takeoff', undefined, { kind: 'drop' });
      return;
    }
    st.y = surf.height;
    return;
  }
  if (st.phase === 'support' && st.support && edge) {
    st.vs = Math.max(0.3, st.vs - SLIDE_FRICTION * dt);
    st.s += st.vs * dt;
    if (!st.leaving) st.support.distance += st.vs * dt;
    if (st.s >= edge.s1 && !st.leaving) {
      beginLeave(st, out, false);
    }
    return;
  }
  if (st.phase === 'air') {
    const prevY = st.y;
    st.s += st.vs * dt;
    st.vy -= GRAVITY * dt;
    st.y += st.vy * dt;
    if (edge && st.supports.length === 0 && st.vy < 0 && prevY >= edge.top && st.y <= edge.top && st.s >= edge.s0 && st.s <= edge.s1) {
      const r = resolveEdgeContact(st, out, edge);
      if (r === 'collision') {
        fail(st, out, 'collision', '縁の角にぶつかりました。縁と平行・直角・斜めのどれかに合わせて乗りましょう。');
        return;
      }
      if (r === 'support') return;
    }
    if (edge && st.takeoffKind !== 'edge' && st.y < edge.top && st.s >= edge.s0 && st.s <= edge.s1 && Math.abs(st.x - edge.x) < edge.halfWidth + BODY_HALF_WIDTH) {
      contact(st, 'body', edge.id, edge.id, 'side', false);
      fail(st, out, 'collision', '縁の側面にぶつかりました。');
      return;
    }
    const surf = lineSurface(st, st.s);
    if (surf && st.y <= surf.height && st.vy < 0) {
      st.y = surf.height;
      st.vy = 0;
      landingCheck(st, out, lesson);
      return;
    }
    if (!surf && st.y < -0.6) {
      fail(st, out, 'collision', '開口部に落ちました。手前0.4 mから0.1 mの間で跳びましょう。');
    }
  }
}

function stepRamp(st: LabState, out: LabEvent[], lesson: LabLesson): void {
  const dt = TICK_US / 1e6;
  const t = st.timeUs;
  if (st.phase === 'air' && st.rampAirUntilUs !== null) {
    if (t >= st.rampAirUntilUs) {
      freezeRotations(st);
      st.rampAirUntilUs = null;
      st.q = RAMP_TOP_Q;
      const d = st.rampPopDist ?? 0;
      if (d > DISASTER_ZONE.far) {
        fail(st, out, 'wrongSupport', `縁まで${d.toFixed(2)} mの所で跳び、縁に届きませんでした。縁の手前${DISASTER_ZONE.near}〜${DISASTER_ZONE.far} mで跳びましょう。`);
        return;
      }
      if (d < DISASTER_ZONE.near) {
        fail(st, out, 'wrongSupport', `縁まで${d.toFixed(2)} mの所で跳び、縁を越えてしまいました。縁の手前${DISASTER_ZONE.near}〜${DISASTER_ZONE.far} mで跳びましょう。`);
        return;
      }
      const yaw = wrap180(st.dogYaw + st.baseYaw);
      const facingUp = Math.cos((yaw * Math.PI) / 180) > 0;
      if (Math.abs(Math.abs(yaw) - 90) < 60) {
        fail(st, out, 'collision', '回転が途中のまま縁に当たりました。回し終えてから縁へ下りましょう。');
        return;
      }
      // 台の側へ先に越えるのは、上を向いている端のパッド。
      const crossed: PadId[] = [facingUp ? 'frontPad' : 'rearPad'];
      st.vq = 0;
      beginSupport(st, out, 'center', 'parallel', crossed, null, 'coping');
      const want = lesson.req.kind === 'ramp' ? lesson.req.ramp.crossed : null;
      if (want && !crossed.includes(want)) {
        fail(st, out, 'wrongOrder', `回り終える前に${partName(crossed[0])}が縁を越えました。跳んだら回し終えてから縁へ下ります。`);
      }
    }
    return;
  }
  if (st.phase === 'entry' || st.phase === 'landed') {
    if (st.brakeUntilUs > t && st.vq !== 0) st.vq -= Math.sign(st.vq) * Math.min(Math.abs(st.vq), BRAKE_DECEL * dt);
    const a = st.q / RAMP_RADIUS;
    st.vq -= GRAVITY * Math.sin(Math.max(0, Math.min(a, Math.PI / 2))) * dt;
    st.q += st.vq * dt;
    if (st.q <= 0) {
      st.q = 0;
      if (st.vq < 0 && st.phase === 'entry' && st.supports.length === 0) {
        fail(st, out, 'wrongSupport', '縁に届かずに戻りました。「止める」は1回だけ、上り始めに押しましょう。');
        return;
      }
    }
    if (st.phase === 'entry' && st.supports.length === 0 && st.vq <= 0 && st.q < RAMP_TOP_Q && st.q > 0.1) {
      fail(st, out, 'wrongSupport', '縁に届く前に止まりました。「止める」を押しすぎないようにしましょう。');
      return;
    }
    if (st.phase === 'entry' && st.supports.length === 0 && st.vq > 0 && RAMP_TOP_Q - st.q <= DISASTER_ZONE.far && !st.events.some((e) => e.kind === 'zone')) {
      // 31で跳べる範囲に入った（画面の目印）。
      emit(st, out, 'zone', undefined, { dist: Math.round((RAMP_TOP_Q - st.q) * 1000) / 1000 });
    }
    if (st.phase === 'entry' && st.supports.length === 0 && st.q >= RAMP_TOP_Q) {
      arriveAtCoping(st, out);
      return;
    }
    if (st.supports.length > 0 && st.vq < 0 && !st.landed) {
      // 曲面へ戻った。前後の支えがそろって下り始めたところを着地後とする。
      st.phase = 'landed';
      st.landed = { atUs: st.timeUs, s: st.s, q: st.q };
      emit(st, out, 'land', undefined, { q: Math.round(st.q * 1000) / 1000 });
    }
    return;
  }
  if (st.phase === 'support' && st.support) {
    if (!st.leaving) st.support.stillUs += TICK_US;
    if (st.support.stillUs === STALL_MIN_US) emit(st, out, 'stall', undefined, { part: st.support.part });
  }
}

/** 上りで縁へ着いた。遅ければ荷重に応じて縁へ掛かり、速ければ飛び出す。 */
function arriveAtCoping(st: LabState, out: LabEvent[]): void {
  const v = st.vq;
  st.q = RAMP_TOP_Q;
  if (v > RAMP_LOCK_SPEED) {
    fail(st, out, 'wrongSupport', `縁に${v.toFixed(2)} m/sで着き、縁を飛び越えました。上り始めに「止める」を押して減速しましょう。`);
    return;
  }
  // 30: 準備した水平回転で縁に沿わせる。
  if (Math.abs(st.setup.dogYaw) === 90) {
    st.dogYaw += st.setup.dogYaw;
    st.riderYaw += st.setup.riderYaw;
    st.vq = 0;
    if (st.load !== 'center') {
      fail(st, out, 'wrongSupport', '片側のパッドだけで縁に掛かりました。荷重を「中」にして前後のパッドで止まりましょう。');
      return;
    }
    beginSupport(st, out, 'bothPads', 'parallel', [], null, 'coping');
    return;
  }
  const facingUp = Math.cos(((st.dogYaw + st.baseYaw) * Math.PI) / 180) > 0;
  const leading: Load = facingUp ? 'front' : 'back';
  st.vq = 0;
  if (st.load === leading) {
    beginSupport(st, out, facingUp ? 'noseEnd' : 'tailEnd', 'parallel', [], null, 'coping');
    return;
  }
  if (st.load === 'center') {
    beginSupport(st, out, 'center', 'parallel', [facingUp ? 'frontPad' : 'rearPad'], null, 'coping');
    return;
  }
  fail(st, out, 'wrongSupport', '進む側の端に荷重がかかっていないので、縁に掛かりませんでした。');
}

/** 1刻み進める。 */
function tick(st: LabState, out: LabEvent[], lesson: LabLesson): void {
  st.timeUs += TICK_US;
  if (st.phase === 'ready' || st.phase === 'done') return;
  updateRotations(st);
  // 手と前足の到達。
  if (st.hand.state === 'reaching' && st.timeUs >= st.hand.untilUs) {
    const g = lastGrab(st)!;
    if (reachable(st)) {
      st.hand = { state: 'holding', untilUs: 0 };
      g.reachUs = st.timeUs;
      contact(st, `hand:${g.hand}`, `hand:${g.handle}`, `handle:${g.handle}`, 'top', false);
      emit(st, out, 'grabReach', undefined, { hand: g.hand, handle: g.handle });
    } else {
      st.hand = { state: 'idle', untilUs: 0 };
      st.grabs.pop();
      emit(st, out, 'grabMiss', `${handName(g.hand)}が${handleName(g.handle)}に届きませんでした`);
    }
  }
  if (st.hand.state === 'holding' && st.phase === 'air') lastGrab(st)!.airHoldUs += TICK_US;
  if (st.plant.state === 'reaching' && st.timeUs >= st.plant.untilUs) {
    if (st.phase === 'entry') {
      st.plant = { state: 'down', untilUs: 0, contactUs: st.timeUs };
      contact(st, 'foot:front', 'foot:front', lineSurface(st, st.s)?.surfaceId ?? 'none', 'ground', true);
      emit(st, out, 'plantContact');
    } else st.plant.state = 'none';
  }
  if (st.plant.state === 'down' && st.phase === 'entry') st.vs = Math.max(1.5, st.vs - 1.5 * TICK_US / 1e6);
  if (st.leaving && st.timeUs >= st.leaving.atUs) completeLeave(st, out, false);
  if (isDone(st)) return;
  if (LAB_FIXTURES[st.fixtureId].kind === 'ramp') stepRamp(st, out, lesson);
  else stepLine(st, out, lesson);
  if (isDone(st)) return;
  // 安定して進めたか。
  if ((st.phase === 'landed' || (st.manualDone && st.phase === 'entry')) && st.landed) {
    const dist = LAB_FIXTURES[st.fixtureId].kind === 'ramp' ? Math.abs(st.q - st.landed.q) : st.s - st.landed.s;
    if (st.timeUs - st.landed.atUs >= STABLE_US && dist >= STABLE_DIST) finalize(st, out, lesson);
  }
  if (isDone(st)) return;
  if (st.startUs !== null && st.timeUs - st.startUs >= LAB_TIMEOUT_US) {
    fail(st, out, 'timeout', '8秒の間に技が終わりませんでした。');
    return;
  }
  if (LAB_FIXTURES[st.fixtureId].kind === 'line' && st.s > LAB_FIXTURES[st.fixtureId].length) {
    fail(st, out, 'timeout', '技が終わる前に練習地形の終わりに着きました。');
  }
}

/**
 * untilUs まで進める。入力は時刻と seq の順に、その時刻を含む刻みの終わりで適用する。
 * 別の試行の入力や、適用済みの組は捨てる。
 */
export function advanceLab(state: LabState, untilUs: number, inputs: readonly LabInput[] = []): LabUpdate {
  const out: LabEvent[] = [];
  const lesson = lessonById(state.lessonId);
  const pending = inputs
    .filter((i) => i.attemptId === state.attemptId && !state.appliedSeq.includes(i.seq))
    .slice()
    .sort((a, b) => a.atUs - b.atUs || a.seq - b.seq);
  let k = 0;
  const target = Math.floor(untilUs);
  // 現在時刻より前の入力は、次の刻みを待たずに今適用する。
  while (k < pending.length && pending[k].atUs <= state.timeUs) {
    state.appliedSeq.push(pending[k].seq);
    applyInput(state, out, pending[k++]);
  }
  while (state.timeUs + TICK_US <= target) {
    tick(state, out, lesson);
    while (k < pending.length && pending[k].atUs <= state.timeUs) {
      state.appliedSeq.push(pending[k].seq);
      applyInput(state, out, pending[k++]);
    }
  }
  return { state, events: out };
}

export function abortLab(state: LabState): void {
  if (state.outcome) return;
  state.outcome = { kind: 'abort', atUs: state.timeUs, detail: '中止しました。' };
  state.phase = 'done';
}

// ------------------------------------------------------------------ 姿勢

export interface LabPose {
  /** 地形上の位置（s, x, y）。 */
  pos: [number, number, number];
  /** 前後の傾き（ラジアン、前上がりが正）。ランプの曲面と荷重から。 */
  pitch: number;
  /** 進行方向に対する犬の水平の向き（度、FS正）。 */
  dogYaw: number;
  flip: number;
  riderYaw: number;
  crouch: number;
  frontFootOff: boolean;
  frontFootPlanted: boolean;
  hand: 'idle' | 'reaching' | 'holding';
  grabHand: Hand;
  grabHandle: Handle;
  toe: 1 | -1;
  load: Load;
  mode: LabPhase;
}

export function solveLabPose(st: LabState): LabPose {
  let pitch = 0;
  if (LAB_FIXTURES[st.fixtureId].kind === 'ramp') {
    const p = rampPoint(st.q);
    pitch = p.angle;
  } else if (st.phase === 'entry' || st.phase === 'landed') {
    const surf = sampleLabSurface(st.fixtureId, st.s);
    pitch = surf ? Math.atan(surf.grade) : 0;
  }
  if (st.manual) pitch += st.manual.load === 'back' ? 0.18 : -0.18;
  if (st.support) {
    if (st.support.part === 'rearPad' || st.support.part === 'tailEnd') pitch += 0.15;
    if (st.support.part === 'frontPad' || st.support.part === 'noseEnd') pitch -= 0.15;
    if (st.support.tilt === 'down') pitch -= 0.2;
  }
  const airT = st.phase === 'air' && st.takeoffUs !== null ? (st.timeUs - st.takeoffUs) / 1e6 : 0;
  const crouch = st.phase === 'air' ? Math.min(1, airT / 0.1) * 0.8 : st.plant.state !== 'none' || st.hand.state !== 'idle' ? 0.6 : 0.2;
  const ramp = LAB_FIXTURES[st.fixtureId].kind === 'ramp';
  const rp = ramp ? rampPoint(st.q) : null;
  return {
    pos: rp ? [rp.s, 0, rp.y] : [st.s, st.x, st.y],
    pitch,
    dogYaw: st.dogYaw + st.baseYaw,
    flip: st.flip,
    riderYaw: st.riderYaw + st.baseYaw,
    crouch,
    frontFootOff: st.feetOff || st.plant.state !== 'none',
    frontFootPlanted: st.plant.state === 'down',
    hand: st.hand.state,
    grabHand: st.setup.hand,
    grabHandle: st.setup.handle,
    toe: st.toe,
    load: st.load,
    mode: st.phase,
  };
}

/** 縁の上の判定に使う値（試験と描画の照合用）。 */
export const LAB_GEOMETRY = { PART_OFFSET, PAD_RADIUS, PAW_OFFSET, COPING_HALF_WIDTH, BODY_HALF_WIDTH } as const;

// ------------------------------------------------------------------ お手本

export interface LabScheduledInput extends LabInput {
  button: LabButtonId | null;
}

/**
 * お手本の試行。プレイヤーとは別の試行を作り、操作列を同じ入力の形で送る。
 * 「出来事から何ミリ秒後」の操作は、その出来事が起きた時点で時刻を決める。
 */
export class LabDemoRunner {
  readonly state: LabState;
  readonly inputs: LabScheduledInput[] = [];
  private waiting: LabDemoStep[];
  private seq = 0;

  constructor(opts: { attemptId: string; lessonId: string; fixtureId: LabFixtureId; stance: Stance; dogId: DogId }, steps?: LabDemoStep[]) {
    this.state = createLabAttempt(opts);
    this.waiting = (steps ?? labDemo(lessonById(opts.lessonId), opts.fixtureId)).slice();
    this.resolve();
  }

  private resolve(): void {
    const keep: LabDemoStep[] = [];
    for (const step of this.waiting) {
      let at: number | null = null;
      if (typeof step.at === 'number') at = step.at;
      else {
        const ref = step.at;
        const ev = this.state.events.find((e) => e.kind === ref.after);
        if (ev) at = ev.atUs + ref.delayUs;
      }
      if (at === null) keep.push(step);
      else this.inputs.push({ attemptId: this.state.attemptId, atUs: Math.max(at, this.state.timeUs), seq: ++this.seq, action: step.action, button: step.button });
    }
    this.waiting = keep;
  }

  get done(): boolean {
    return this.state.outcome !== null;
  }

  /** 刻みごとに進め、出来事に応じた操作を同じ刻みのうちに決める。 */
  advanceTo(untilUs: number): LabEvent[] {
    const out: LabEvent[] = [];
    while (this.state.timeUs + TICK_US <= untilUs && !this.done) {
      out.push(...advanceLab(this.state, this.state.timeUs + TICK_US, this.inputs).events);
      this.resolve();
    }
    return out;
  }

  /** 次に押すボタン（画面で強調する）。 */
  nextButton(windowUs = 400_000): LabButtonId | null {
    const next = this.inputs.find((i) => !this.state.appliedSeq.includes(i.seq) && i.button);
    if (!next || next.atUs - this.state.timeUs > windowUs) return null;
    return next.button;
  }
}
