import { ANCHOR_KEYS, anchorBody, fxProgram, type AnchorKey, type BodyAnchorKey, type FxProgram, type FxStep } from './trick-fx-81';
import type { FxBody, FxDrawContext, FxDrawerTable } from './trick-fx-context';
import { FX_RGB, PointRing, clamp01, copyV, lenV, normV, rotateV, setV, vec, type Quat, type Rgb, type Vec } from './trick-fx-math';
import { AIR_DRAWERS } from './trick-fx-ops-air';
import { LAND_DRAWERS } from './trick-fx-ops-land';
import { FxPen, type FxSink } from './trick-fx-pen';
import type { FxVisualEvent } from './trick-fx-timeline';

/**
 * 81種類の演出を、出来事（F・A・L・C・X）に合わせて始め、身体の計測点から毎フレーム描く。
 * Three.js には依存しない。描画の受け口（FxSink）と身体の読み口（FxBodySource）を差し替えて使う。
 */

export type { FxSink } from './trick-fx-pen';

/** 身体の計測点と姿勢を読む口。競技の立体模型と、操作確認版の球模型で別々に用意する。 */
export interface FxBodySource {
  anchor(key: BodyAnchorKey, out: Vec): boolean;
  quat(body: FxBody, out: Quat): boolean;
  /** 身体の足元の基準点（世界座標）。着地の計測点を接地点へ合わせるときに使う。無ければ計測点をそのまま使う。 */
  origin?(out: Vec): boolean;
}

/**
 * ゲームが計算した実際の回転（描画専用の読み取り）。角速度は世界座標のラジアン/秒、
 * accum はこのジャンプでその身体が回った角度の合計（ラジアン）。描画の前後の姿勢差からは求めない。
 */
export interface FxBodySpin { omega: Vec; accum: number }
export interface FxSpinSample { dog: FxBodySpin; rider: FxBodySpin }

/** 着地の出来事に添える情報。contact は接地点、yaw は進行方向、grade は接地面の傾き（前へ1m進むと上がる高さ）。 */
export interface FxApplyContext {
  contact?: Vec;
  yaw?: number;
  grade?: number;
  switchCount?: number;
  /** 出来事から何ms経っているか（再生が遅れて始まったときに、途中から描く）。 */
  ageMs?: number;
  /** 着地の計測点を読む身体と、そのときの進行方向（省略時は直前のフレームのもの）。 */
  source?: FxBodySource;
  sourceHeading?: number;
}

export interface FxFrameFlags {
  reduced: boolean;
  weak: boolean;
  paused: boolean;
  /** 全体の濃さ（半透明の再生では下げる）。 */
  alpha: number;
  /** 進行方向（ラジアン）。 */
  heading: number;
  /** 床の高さ（空中で床を使う部品の目安）。 */
  groundY: number;
  /** ゲームが計算した実際の回転。あればこちらを優先する（無い記録や操作確認版では姿勢差から推定）。 */
  spin?: FxSpinSample | null;
}

const DRAWERS: FxDrawerTable = { ...AIR_DRAWERS, ...LAND_DRAWERS };
const N = ANCHOR_KEYS.length;
const INDEX = new Map<AnchorKey, number>(ANCHOR_KEYS.map((key, i) => [key, i]));

interface Instance {
  prog: FxProgram;
  jumpId: number;
  startMs: number;
  fadeStartMs: number | null;
  fadeMs: number;
  /** 計測点ごとの履歴。着地では直前の空中の軌跡を受け継ぐ。 */
  hist: (PointRing | null)[];
  contact: Vec | null;
  yaw: number;
  comboMs: number | null;
  comboLanding: boolean;
  /** 着地の瞬間に固定した計測点の位置。着地の演出はこれだけを読み、着地後に走る身体を追わない。 */
  snapshot: Float64Array | null;
  snapValid: Uint8Array | null;
  grade: number;
  fired: number;
  memo: Record<string, number>;
}

export class FxEngine {
  /** 描画専用の時計（ms）。停止中は進まない。 */
  clockMs = 0;
  private list: Instance[] = [];
  private pool: PointRing[] = [];
  private pos = new Float64Array(N * 3);
  private valid = new Uint8Array(N);
  private needed = new Uint8Array(N);
  private quats: Record<FxBody, Quat> = { dog: { x: 0, y: 0, z: 0, w: 1 }, rider: { x: 0, y: 0, z: 0, w: 1 } };
  private prev: Record<FxBody, Quat | null> = { dog: null, rider: null };
  private hasQuat: Record<FxBody, boolean> = { dog: false, rider: false };
  private omega: Record<FxBody, Vec> = { dog: vec(), rider: vec() };
  private turned: Record<FxBody, number> = { dog: 0, rider: 0 };
  private flags: FxFrameFlags = { reduced: false, weak: false, paused: false, alpha: 1, heading: 0, groundY: 0 };
  private pen = new FxPen();
  private ctx = new Ctx(this);
  private scratch = vec();
  private comboAtMs = -1e9;
  /** 前のフレームの回転の支点（空中の軌跡を身体と一緒に動かすため）。 */
  private lastPivot = vec();
  private hasPivot = false;
  /** いま描いている空中のジャンプ。新しいジャンプでは回転の累積・角速度・姿勢差を0から始める。 */
  private currentJumpId: number | null = null;
  private lastSource: FxBodySource | null = null;

  /** いま出ている（消えかけを除く）演出のID。 */
  activeIds(): string[] {
    return this.list.filter(i => i.fadeStartMs === null).map(i => i.prog.id);
  }
  get instanceCount(): number { return this.list.length; }
  /** 直近に連携が実際に成立した時刻（描画の時計）。 */
  get lastComboMs(): number { return this.comboAtMs; }

  clear(): void {
    for (const inst of this.list) this.release(inst);
    this.list = [];
    this.prev.dog = this.prev.rider = null;
    this.comboAtMs = -1e9;
    this.hasPivot = false;
    this.currentJumpId = null;
    this.resetSpin();
  }

  /** 回転の累積・角速度・直前の姿勢を初期化する（着地の演出は残す）。 */
  private resetSpin(): void {
    for (const body of ['dog', 'rider'] as const) {
      this.turned[body] = 0;
      setV(this.omega[body], 0, 0, 0);
      this.prev[body] = null;
    }
  }

  /** 出来事を受け取る。L の contact は接地点（世界座標）、yaw は進行方向。 */
  apply(ev: FxVisualEvent, ctx: FxApplyContext = {}): void {
    const yaw = ctx.yaw ?? this.flags.heading;
    if (ev.kind === 'F' || ev.kind === 'A') {
      if (!ev.id) return;
      if (this.currentJumpId !== ev.jumpId) {
        // 新しいジャンプ：前のジャンプの回転を持ち越さない。前の空中演出は短く消し、床の着地演出は寿命まで残す。
        this.currentJumpId = ev.jumpId;
        this.resetSpin();
        this.comboAtMs = -1e9;
        for (const inst of this.list) if (inst.prog.kind !== 'L' && inst.fadeStartMs === null) this.fade(inst, 200);
      }
      const current = this.list.find(i => i.prog.kind === ev.kind && i.fadeStartMs === null);
      if (current && current.prog.id === ev.id && current.jumpId === ev.jumpId) return;
      // 段階が上がったら古い演出を約0.2秒、対象を切り替えたら約0.3秒で薄く消す。
      if (current) this.fade(current, current.prog.target !== ev.target ? 320 : 200);
      this.list.push(this.create(fxProgram(ev.id), ev.jumpId, null, yaw));
      return;
    }
    if (ev.kind === 'C') {
      this.comboAtMs = this.clockMs;
      for (const inst of this.list) if (inst.fadeStartMs === null && inst.prog.kind === 'F') inst.comboMs = this.clockMs;
      return;
    }
    let airTrail: Instance | undefined;
    for (const inst of this.list) {
      if (inst.prog.kind === 'L' || inst.fadeStartMs !== null) continue;
      if (inst.prog.kind === 'A') airTrail = inst;
      this.fade(inst, ev.kind === 'L' ? 260 : 300);
    }
    if (ev.kind !== 'L' || !ev.id) return;
    const inst = this.create(fxProgram(ev.id), ev.jumpId, ctx.contact ?? { x: 0, y: this.flags.groundY, z: 0 }, yaw);
    inst.comboLanding = (ctx.switchCount ?? 0) > 0;
    inst.grade = Number.isFinite(ctx.grade) ? ctx.grade! : 0;
    inst.startMs = this.clockMs - Math.max(0, Math.min(inst.prog.lifetimeMs, ctx.ageMs ?? 0));
    this.freeze(inst, yaw, ctx.source ?? this.lastSource, ctx.sourceHeading ?? this.flags.heading);
    // 空中の軌跡を着地点へ回収する演出のために、直前の線を受け継ぐ。
    airTrail?.hist.forEach((ring, k) => {
      if (!ring || !ring.count) return;
      const copy = this.ring();
      copy.copyFrom(ring);
      inst.hist[k] = copy;
    });
    this.list.push(inst);
  }

  /** 1フレーム分を描く。停止中は時計も履歴も進めず、同じ形を描く。 */
  frame(dtMs: number, src: FxBodySource, sink: FxSink, flags: FxFrameFlags): void {
    this.flags = flags;
    this.lastSource = src;
    const dt = flags.paused ? 0 : Math.max(0, Math.min(100, Number.isFinite(dtMs) ? dtMs : 0));
    this.clockMs += dt;
    this.readBodies(src, dt);
    this.readAnchors(src);
    this.followPivot();
    if (dt > 0) this.sample();
    this.list = this.list.filter(inst => {
      const age = this.clockMs - inst.startMs;
      const dead = (inst.fadeStartMs !== null && this.clockMs - inst.fadeStartMs >= inst.fadeMs) ||
        (inst.prog.lifetimeMs > 0 && age >= inst.prog.lifetimeMs);
      if (dead) this.release(inst);
      return !dead;
    });
    this.pen.sink = sink;
    for (const inst of this.list) this.draw(inst);
    this.pen.sink = null;
  }

  // ------------------------------------------------------------ 状態の管理

  private ring(): PointRing {
    const r = this.pool.pop() ?? new PointRing();
    r.clear();
    return r;
  }
  private release(inst: Instance): void {
    for (const r of inst.hist) if (r) this.pool.push(r);
    inst.hist.fill(null);
  }
  private create(prog: FxProgram, jumpId: number, contact: Vec | null, yaw: number): Instance {
    const hist: (PointRing | null)[] = Array(N).fill(null);
    if (prog.kind !== 'L') {
      for (const step of prog.recipe) for (const key of step.at) {
        const k = INDEX.get(key)!;
        if (key !== 'contact' && !hist[k]) hist[k] = this.ring();
      }
    }
    return { prog, jumpId, startMs: this.clockMs, fadeStartMs: null, fadeMs: 0, hist, contact: contact ? { ...contact } : null,
      yaw, comboMs: null, comboLanding: false, fired: 0, memo: {}, snapshot: null, snapValid: null, grade: 0 };
  }
  /**
   * 着地の瞬間の計測点を一度だけ読み、接地点に合わせて固定する（F02）。
   * 描画の時点の身体がまだ空中や先へ進んでいても、足元の基準点からの位置を接地点へ移して使う。
   * 読めなかった計測点は固定せず、その部品は描かない（原点などへ推測で置かない）。
   */
  private freeze(inst: Instance, yaw: number, src: FxBodySource | null, heading: number): void {
    const contact = inst.contact!;
    const snap = new Float64Array(N * 3), ok = new Uint8Array(N);
    const origin = vec(), p = vec();
    const hasOrigin = !!src?.origin?.(origin);
    // 描画の時点の向きと接地の向きの差だけ、足元を中心に回す。
    const turn = yaw - heading;
    const c = Math.cos(turn), s = Math.sin(turn);
    const keys = new Set<AnchorKey>();
    for (const step of inst.prog.recipe) for (const key of step.at) keys.add(key);
    for (const key of [...keys, 'riderHead', 'riderWaist', 'dogBack', 'dogBelly'] as AnchorKey[]) {
      if (key === 'contact' || !src) continue;
      const k = INDEX.get(key)!;
      if (!src.anchor(key as BodyAnchorKey, p)) continue;
      if (hasOrigin) {
        const dx = p.x - origin.x, dz = p.z - origin.z;
        setV(p, contact.x + dx * c - dz * s, contact.y + (p.y - origin.y), contact.z + dx * s + dz * c);
      }
      snap[k * 3] = p.x; snap[k * 3 + 1] = p.y; snap[k * 3 + 2] = p.z;
      ok[k] = 1;
    }
    inst.snapshot = snap;
    inst.snapValid = ok;
  }

  private fade(inst: Instance, ms: number): void {
    inst.fadeStartMs = this.clockMs;
    inst.fadeMs = ms;
  }

  /** 前のフレームとの姿勢の差から、身体の回転の速さと軸を推定する。 */
  private readBodies(src: FxBodySource, dt: number): void {
    for (const body of ['dog', 'rider'] as const) {
      const q = this.quats[body];
      this.hasQuat[body] = src.quat(body, q);
      if (!this.hasQuat[body]) { this.prev[body] = null; continue; }
      const p = this.prev[body];
      const spin = this.flags.spin?.[body];
      if (spin) {
        // ゲームが計算した実際の角速度と累積角を使う（1フレームで180度を超えても向きを取り違えない）。
        copyV(this.omega[body], spin.omega);
        this.turned[body] = spin.accum;
      } else if (p && dt > 0) {
        // 差の回転 d = q × p⁻¹
        let dx = p.w * q.x - p.x * q.w - p.y * q.z + p.z * q.y;
        let dy = p.w * q.y - p.y * q.w - p.z * q.x + p.x * q.z;
        let dz = p.w * q.z - p.z * q.w - p.x * q.y + p.y * q.x;
        let dw = p.w * q.w + p.x * q.x + p.y * q.y + p.z * q.z;
        if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; dw = -dw; }
        const s = Math.hypot(dx, dy, dz);
        const angle = 2 * Math.atan2(s, dw);
        const rate = angle / (dt / 1000);
        const o = this.omega[body];
        const k = Math.min(1, dt / 60);
        if (s > 1e-7) setV(o, o.x + (dx / s * rate - o.x) * k, o.y + (dy / s * rate - o.y) * k, o.z + (dz / s * rate - o.z) * k);
        else setV(o, o.x * (1 - k), o.y * (1 - k), o.z * (1 - k));
        this.turned[body] += angle;
      }
      if (!p) this.prev[body] = { x: q.x, y: q.y, z: q.z, w: q.w };
      else { p.x = q.x; p.y = q.y; p.z = q.z; p.w = q.w; }
    }
  }

  /** 使う計測点だけを読む（読み出しの回数を減らす）。 */
  private readAnchors(src: FxBodySource): void {
    this.valid.fill(0);
    this.needed.fill(0);
    for (const inst of this.list) for (const step of inst.prog.recipe) for (const key of step.at) this.needed[INDEX.get(key)!] = 1;
    for (const key of ['dogBack', 'dogBelly', 'riderWaist', 'riderHead', 'pivot'] as const) this.needed[INDEX.get(key)!] = 1;
    const out = this.scratch;
    for (let k = 0; k < N; k++) {
      const key = ANCHOR_KEYS[k];
      if (!this.needed[k] || key === 'contact') continue;
      if (!src.anchor(key as BodyAnchorKey, out)) continue;
      this.pos[k * 3] = out.x; this.pos[k * 3 + 1] = out.y; this.pos[k * 3 + 2] = out.z;
      this.valid[k] = 1;
    }
  }

  /**
   * 空中の軌跡は「身体のまわりの回転」を見せるものなので、走って前へ進んだ分は履歴ごと一緒に動かす。
   * こうしないと、走った道すじが長い線として空中に残ってしまう。着地の演出は床に残すので動かさない。
   */
  private followPivot(): void {
    const k = INDEX.get('pivot')!;
    if (!this.valid[k]) { this.hasPivot = false; return; }
    const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
    if (this.hasPivot) {
      const dx = x - this.lastPivot.x, dy = y - this.lastPivot.y, dz = z - this.lastPivot.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        for (const inst of this.list) {
          if (inst.prog.kind === 'L') continue;
          for (const ring of inst.hist) {
            if (!ring) continue;
            for (let i = 0; i < ring.count; i++) {
              const j = ring.index(i);
              ring.data[j] += dx; ring.data[j + 1] += dy; ring.data[j + 2] += dz;
            }
          }
        }
      }
    }
    setV(this.lastPivot, x, y, z);
    this.hasPivot = true;
  }

  /** 空中の演出の履歴へ今の位置を足す。軌跡は、実際に回っている身体の部位だけ。 */
  private sample(): void {
    for (const inst of this.list) {
      if (inst.prog.kind === 'L' || inst.fadeStartMs !== null) continue;
      inst.hist.forEach((ring, k) => {
        if (!ring || !this.valid[k]) return;
        const body = anchorBody(ANCHOR_KEYS[k]);
        if (inst.prog.kind === 'A' && body && lenV(this.omega[body]) < 0.6) return;
        ring.push(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2], this.clockMs);
      });
    }
  }

  private draw(inst: Instance): void {
    const age = this.clockMs - inst.startMs;
    const fade = inst.fadeStartMs === null ? 1 : 1 - clamp01((this.clockMs - inst.fadeStartMs) / Math.max(1, inst.fadeMs));
    const intro = inst.prog.kind === 'L' ? 1 : Math.min(1, age / 120);
    const alpha = inst.prog.opacityMax * fade * intro * this.flags.alpha * (this.flags.weak ? 0.45 : 1);
    if (alpha <= 0.003) return;
    this.ctx.bind(inst);
    inst.prog.recipe.forEach((step, index) => {
      if (step.combo && !this.comboOn(inst, step)) return;
      const t = age - step.t0;
      if (t < 0 || (step.dur > 0 && t > step.dur)) return;
      DRAWERS[step.op]?.(this.ctx, step, index, t, alpha);
    });
  }

  private comboOn(inst: Instance, step: FxStep): boolean {
    if (inst.prog.kind === 'L') return inst.comboLanding;
    return inst.comboMs !== null && this.clockMs - inst.comboMs <= Math.max(600, step.dur);
  }

  // ------------------------------------------------------------ 部品から読む情報（Ctx 経由）

  /** @internal */ readPos(inst: Instance, key: AnchorKey, out: Vec): boolean {
    if (key === 'contact') {
      if (!inst.contact) return false;
      copyV(out, inst.contact);
      return true;
    }
    const k = INDEX.get(key)!;
    if (inst.prog.kind === 'L') {
      // 着地の演出は、着地の瞬間に固定した位置だけを使う（今の身体を追わない）。
      if (!inst.snapshot || !inst.snapValid![k]) return false;
      setV(out, inst.snapshot[k * 3], inst.snapshot[k * 3 + 1], inst.snapshot[k * 3 + 2]);
      return true;
    }
    if (this.valid[k]) { setV(out, this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]); return true; }
    const ring = inst.hist[k];
    if (ring && ring.count) { ring.read(0, out); return true; }
    return false;
  }
  /** @internal */ histOf(inst: Instance, key: AnchorKey): PointRing | null {
    return key === 'contact' ? null : inst.hist[INDEX.get(key)!];
  }
  /** @internal */ axisOf(body: FxBody | null, out: Vec): Vec {
    if (!body) return setV(out, 0, 1, 0);
    const o = this.omega[body];
    if (lenV(o) > 0.3) return normV(copyV(out, o));
    if (this.hasQuat[body]) return rotateV(out, this.quats[body], 0, 0, 1);
    return setV(out, 0, 0, 1);
  }
  /** @internal */ speedOf(body: FxBody): number { return lenV(this.omega[body]); }
  /** @internal */ turnedOf(body: FxBody): number { return this.turned[body]; }
  /** @internal */ quatOf(body: FxBody): Quat | null { return this.hasQuat[body] ? this.quats[body] : null; }
  /** @internal */ centerOf(body: FxBody, out: Vec): boolean {
    const [a, b, wa] = body === 'dog' ? ['dogBack', 'dogBelly', 0.5] as const : ['riderWaist', 'riderHead', 0.6] as const;
    const ka = INDEX.get(a)!, kb = INDEX.get(b)!;
    if (!this.valid[ka] || !this.valid[kb]) return false;
    setV(out, this.pos[ka * 3] * wa + this.pos[kb * 3] * (1 - wa), this.pos[ka * 3 + 1] * wa + this.pos[kb * 3 + 1] * (1 - wa),
      this.pos[ka * 3 + 2] * wa + this.pos[kb * 3 + 2] * (1 - wa));
    return true;
  }
  /** @internal */ get frameFlags(): FxFrameFlags { return this.flags; }
  /** @internal */ get penRef(): FxPen { return this.pen; }
  /** @internal */ comboAge(inst: Instance): number | null {
    return inst.comboMs === null ? null : this.clockMs - inst.comboMs;
  }
}

/** 1件の演出を描く間だけ使う、部品向けの読み口。 */
class Ctx implements FxDrawContext {
  private inst!: Instance;
  readonly ringPoints = new Float32Array(48 * 3);
  ringCount = 0;
  constructor(private engine: FxEngine) {}
  bind(inst: Instance): void {
    this.inst = inst;
    this.ringCount = 0;
    this.engine.penRef.plane = inst.contact && inst.grade ? { x: inst.contact.x, y: inst.contact.y, z: inst.contact.z, yaw: inst.yaw, grade: inst.grade } : null;
  }
  get pen(): FxPen { return this.engine.penRef; }
  get clockMs(): number { return this.engine.clockMs; }
  get reduced(): boolean { return this.engine.frameFlags.reduced; }
  get weak(): boolean { return this.engine.frameFlags.weak; }
  get yaw(): number { return this.inst.yaw; }
  get contact(): Vec | null { return this.inst.contact; }
  get groundY(): number { return this.inst.contact ? this.inst.contact.y : this.engine.frameFlags.groundY; }
  /** 接地面の高さ。斜面では前後の位置に合わせて上下させ、浮いたり埋まったりしないようにする。 */
  groundAt(x: number, z: number): number {
    const c = this.inst.contact;
    if (!c) return this.engine.frameFlags.groundY;
    return c.y + ((x - c.x) * Math.cos(this.inst.yaw) + (z - c.z) * Math.sin(this.inst.yaw)) * this.inst.grade;
  }
  get grade(): number { return this.inst.grade; }
  get fading(): boolean { return this.inst.fadeStartMs !== null; }
  get comboAgeMs(): number | null { return this.engine.comboAge(this.inst); }
  get comboLanding(): boolean { return this.inst.comboLanding; }
  get memo(): Record<string, number> { return this.inst.memo; }
  pos(key: AnchorKey, out: Vec): boolean { return this.engine.readPos(this.inst, key, out); }
  hist(key: AnchorKey): PointRing | null { return this.engine.histOf(this.inst, key); }
  past(key: AnchorKey, agoMs: number, out: Vec): boolean {
    const ring = this.hist(key);
    return !!ring && ring.before(this.engine.clockMs - agoMs, out);
  }
  axis(body: FxBody | null, out: Vec): Vec { return this.engine.axisOf(body, out); }
  speed(body: FxBody): number { return this.engine.speedOf(body); }
  angle(body: FxBody): number { return this.engine.turnedOf(body); }
  quat(body: FxBody): Quat | null { return this.engine.quatOf(body); }
  center(body: FxBody, out: Vec): boolean { return this.engine.centerOf(body, out); }
  color(step: FxStep, key: AnchorKey | null): Rgb {
    if (step.color !== 'body') return FX_RGB[step.color];
    return key && anchorBody(key) === 'rider' ? FX_RGB.rider : FX_RGB.dog;
  }
  once(index: number): boolean {
    const bit = 1 << index;
    if (this.inst.fired & bit) return false;
    this.inst.fired |= bit;
    return true;
  }
}
