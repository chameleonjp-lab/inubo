import type { Candidate } from '../game/tricks';
import type { GestureFact } from '../game/types';
import { roundTo } from '../game/math';

/**
 * 指ごとの軌跡を読み取り、走行計算に渡す入力（GestureFact）を作る。
 * 地上か空中かの区別は走行計算の側が「指を置いた時刻」の状態で決める。ここでは形だけを読む。
 * 距離は画面の短辺を 1 とした比率で測る（描画解像度とは無関係）。画面の上が常に「前」。
 */

export interface GestureConfig {
  /** 前払いでジャンプになる上向きの距離。 */
  jumpDist: number;
  /** 横払いとして扱い始める横の距離。 */
  steerDead: number;
  /** これより短い軌跡は短いタップ。 */
  tapMax: number;
  /** 閉じた円として認める最小の周の長さ。 */
  circleMinPerimeter: number;
  /** 閉じた円として認める最小の大きさ（外接する四角の長い辺）。 */
  circleMinSize: number;
  /** 始点へ戻ったとみなす距離（円の大きさに対する比率と最小値）。 */
  closeRatio: number;
  closeMin: number;
  /** 直線として認める最小の長さと、まっすぐさ（弦÷道のり）。 */
  lineMin: number;
  lineStraightness: number;
  /** 縦長の円とみなす「高さ÷幅」。 */
  verticalAspect: number;
}

export const DEFAULT_GESTURE: GestureConfig = {
  jumpDist: 0.07,
  steerDead: 0.02,
  tapMax: 0.03,
  circleMinPerimeter: 0.3,
  circleMinSize: 0.08,
  closeRatio: 0.28,
  closeMin: 0.035,
  lineMin: 0.08,
  lineStraightness: 0.9,
  verticalAspect: 1.25,
};

export interface Sample {
  x: number;
  y: number;
  tUs: number;
}

/**
 * 角度を 8 方向へ分ける。画面の上を 0 度として時計回り。
 * 各方向は「中心－22.5度を含み、中心＋22.5度を含まない」。0=上 1=右上 2=右 … 7=左上。
 */
export function dir8FromVector(dx: number, dyDown: number): number {
  const deg = (Math.atan2(dx, -dyDown) * 180) / Math.PI;
  const a = roundTo((deg + 360) % 360, 6);
  return Math.floor((a + 22.5) / 45) % 8;
}

export function dir8FromAngle(deg: number): number {
  const a = roundTo(((deg % 360) + 360) % 360, 6);
  return Math.floor((a + 22.5) / 45) % 8;
}

interface Stroke {
  strokeId: number;
  pointerId: number;
  samples: Sample[];
  segStart: number;
  circles: number;
  steering: boolean;
  forwardSent: boolean;
  pathLen: number;
  done: boolean;
}

export interface TrailView {
  strokeId: number;
  points: { x: number; y: number }[];
  /** 円として切り出した部分の終わりの番号。 */
  circleEnds: number[];
  ended: boolean;
  endedAtMs: number;
  label: string;
}

function bbox(pts: Sample[]): { w: number; h: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { w: x1 - x0, h: y1 - y0 };
}

/** 画面座標（y は下向き）で、時計回りなら正の面積。 */
function signedArea(pts: Sample[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function polyLength(pts: Sample[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

export class GestureRecognizer {
  private cfg: GestureConfig;
  private unit = 1;
  private strokes = new Map<number, Stroke>();
  private dead = new Set<number>();
  private nextId = 1;
  private trails: TrailView[] = [];
  /** 試験時だけ見る、入力の長さ・判定名。 */
  debugLog: string[] = [];

  constructor(cfg: Partial<GestureConfig> = {}, firstStrokeId = 1) {
    this.cfg = { ...DEFAULT_GESTURE, ...cfg };
    this.nextId = firstStrokeId;
  }

  /** 画面の大きさ（CSS ピクセル）。短辺を 1 として距離を測る。 */
  setViewport(width: number, height: number): void {
    this.unit = Math.max(1, Math.min(width, height));
  }

  get activeCount(): number {
    return this.strokes.size;
  }

  pointerDown(pointerId: number, px: number, py: number, atUs: number, nowMs = 0): GestureFact[] {
    this.dead.delete(pointerId);
    const st: Stroke = {
      strokeId: this.nextId++,
      pointerId,
      samples: [{ x: px / this.unit, y: py / this.unit, tUs: atUs }],
      segStart: 0,
      circles: 0,
      steering: false,
      forwardSent: false,
      pathLen: 0,
      done: false,
    };
    this.strokes.set(pointerId, st);
    this.trails.push({ strokeId: st.strokeId, points: [{ x: px, y: py }], circleEnds: [], ended: false, endedAtMs: nowMs, label: '' });
    if (this.trails.length > 12) this.trails.shift();
    return [{ kind: 'down', atUs, strokeId: st.strokeId }];
  }

  pointerMove(pointerId: number, px: number, py: number, atUs: number): GestureFact[] {
    if (this.dead.has(pointerId)) return [];
    const st = this.strokes.get(pointerId);
    if (!st) return [];
    const out: GestureFact[] = [];
    const last = st.samples[st.samples.length - 1];
    const p: Sample = { x: px / this.unit, y: py / this.unit, tUs: Math.max(atUs, last.tUs) };
    st.pathLen += Math.hypot(p.x - last.x, p.y - last.y);
    st.samples.push(p);
    const tr = this.trails.find((t) => t.strokeId === st.strokeId);
    tr?.points.push({ x: px, y: py });
    const s0 = st.samples[0];
    const dx = p.x - s0.x;
    const dy = p.y - s0.y;

    if (!st.forwardSent && -dy >= this.cfg.jumpDist && -dy >= Math.abs(dx)) {
      st.forwardSent = true;
      out.push({ kind: 'forward', atUs: p.tUs, strokeId: st.strokeId });
    }
    if (!st.steering && Math.abs(dx) >= this.cfg.steerDead && Math.abs(dx) >= 0.75 * Math.abs(dy)) st.steering = true;
    if (st.steering) out.push({ kind: 'steer', atUs: p.tUs, strokeId: st.strokeId, dx });

    const circle = this.detectCircle(st);
    if (circle) {
      out.push(circle);
      if (tr) {
        tr.circleEnds.push(tr.points.length - 1);
        tr.label = circle.kind === 'circle' ? (circle.vertical ? '犬・縦' : '犬・横') : tr.label;
      }
    }
    return out;
  }

  private detectCircle(st: Stroke): GestureFact | null {
    const seg = st.samples.slice(st.segStart);
    if (seg.length < 6) return null;
    const len = polyLength(seg);
    if (len < this.cfg.circleMinPerimeter) return null;
    const { w, h } = bbox(seg);
    const size = Math.max(w, h);
    if (size < this.cfg.circleMinSize) return null;
    const a = seg[0];
    const b = seg[seg.length - 1];
    const tol = Math.max(this.cfg.closeMin, this.cfg.closeRatio * size);
    if (Math.hypot(b.x - a.x, b.y - a.y) > tol) return null;
    const area = signedArea(seg);
    // 行って戻っただけの線を円としない: 外接する楕円の面積の 45% 以上を囲む。
    if (Math.abs(area) < 0.45 * (Math.PI / 4) * w * h || w <= 0 || h <= 0) return null;
    const aspect = roundTo(h / w, 6);
    const vertical = aspect >= this.cfg.verticalAspect;
    st.segStart = st.samples.length - 1;
    st.circles += 1;
    this.debugLog.push(`円 ${vertical ? '縦' : '横'} 縦横比${aspect.toFixed(3)} 周${len.toFixed(2)}`);
    return { kind: 'circle', atUs: b.tUs, strokeId: st.strokeId, vertical, clockwise: area > 0, aspect };
  }

  pointerUp(pointerId: number, px: number, py: number, atUs: number, nowMs = 0): GestureFact[] {
    if (this.dead.has(pointerId)) {
      this.dead.delete(pointerId);
      return [];
    }
    const st = this.strokes.get(pointerId);
    if (!st) return [];
    const out = this.pointerMove(pointerId, px, py, atUs);
    const tEnd = st.samples[st.samples.length - 1].tUs;
    const seg = st.samples.slice(st.segStart);
    const a = seg[0];
    const b = seg[seg.length - 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const segLen = polyLength(seg);
    const tr = this.trails.find((t) => t.strokeId === st.strokeId);
    if (chord >= this.cfg.lineMin && segLen > 0 && chord / segLen >= this.cfg.lineStraightness) {
      const dir8 = dir8FromVector(b.x - a.x, b.y - a.y);
      out.push({ kind: 'line', atUs: tEnd, strokeId: st.strokeId, dir8, afterCircle: st.circles > 0 });
      this.debugLog.push(`線 方向${dir8} 長さ${chord.toFixed(2)}${st.circles > 0 ? '（円の後）' : ''}`);
      if (tr) tr.label = tr.label ? `${tr.label}＋線` : '線';
    } else if (st.circles === 0) {
      const reason = st.pathLen < this.cfg.tapMax ? 'short' : bbox(st.samples).w + bbox(st.samples).h < this.cfg.circleMinSize ? 'small' : 'open';
      out.push({ kind: 'reject', atUs: tEnd, strokeId: st.strokeId, reason });
      this.debugLog.push(`未成立 ${reason} 長さ${st.pathLen.toFixed(2)}`);
    }
    out.push({ kind: 'up', atUs: tEnd, strokeId: st.strokeId, cancelled: false });
    this.strokes.delete(pointerId);
    if (tr) {
      tr.ended = true;
      tr.endedAtMs = nowMs;
    }
    return out;
  }

  /** ブラウザに操作が引き取られたとき。その指の未確定の部分（離した時に決まる線）を消す。 */
  pointerCancel(pointerId: number, atUs: number, nowMs = 0): GestureFact[] {
    const st = this.strokes.get(pointerId);
    this.dead.delete(pointerId);
    if (!st) return [];
    this.strokes.delete(pointerId);
    const tr = this.trails.find((t) => t.strokeId === st.strokeId);
    if (tr) {
      tr.ended = true;
      tr.endedAtMs = nowMs;
    }
    return [{ kind: 'up', atUs: Math.max(atUs, st.samples[st.samples.length - 1].tUs), strokeId: st.strokeId, cancelled: true }];
  }

  /** 一時停止したとき。触れている指をすべて取り消し、その指が離れるまで無視する。 */
  suspend(atUs: number, nowMs = 0): GestureFact[] {
    const out: GestureFact[] = [];
    for (const pid of [...this.strokes.keys()]) {
      out.push(...this.pointerCancel(pid, atUs, nowMs));
      this.dead.add(pid);
    }
    return out;
  }

  /** 画面にまだ残っている指を、離れるまで無視する（再開の指など）。 */
  ignorePointer(pointerId: number): void {
    this.dead.add(pointerId);
    this.strokes.delete(pointerId);
  }

  trailViews(): TrailView[] {
    return this.trails;
  }

  pruneTrails(nowMs: number, keepMs: number): void {
    this.trails = this.trails.filter((t) => !t.ended || nowMs - t.endedAtMs < keepMs);
  }
}

/** 1本の指の軌跡全体（指を置いてから離すまで）から、入力の並びを作る。試験と手本に使う。 */
export function classifyStroke(samples: Sample[], cfg: Partial<GestureConfig> = {}, strokeId = 1, pointerId = 1): GestureFact[] {
  const r = new GestureRecognizer(cfg, strokeId);
  r.setViewport(1, 1);
  const out: GestureFact[] = [];
  out.push(...r.pointerDown(pointerId, samples[0].x, samples[0].y, samples[0].tUs));
  for (let i = 1; i < samples.length - 1; i++) out.push(...r.pointerMove(pointerId, samples[i].x, samples[i].y, samples[i].tUs));
  const last = samples[samples.length - 1];
  out.push(...r.pointerUp(pointerId, last.x, last.y, last.tUs));
  return out;
}

/** 空中の1本の軌跡から技の候補を作る（指番号・成立時刻を持つ）。 */
export function classifyAirStroke(samples: Sample[], jumpId: number, strokeId = 1, cfg: Partial<GestureConfig> = {}): (Candidate & { jumpId: number })[] {
  const out: (Candidate & { jumpId: number })[] = [];
  for (const f of classifyStroke(samples, cfg, strokeId)) {
    if (f.kind === 'circle') out.push({ kind: 'dog', strokeId, establishedUs: f.atUs, vertical: f.vertical, clockwise: f.clockwise, jumpId });
    if (f.kind === 'line') out.push({ kind: 'body', strokeId, establishedUs: f.atUs, dir8: f.dir8, afterCircle: f.afterCircle, jumpId });
  }
  return out;
}

/** 試験と手本用: 楕円の軌跡を作る（始点は下、時計回りなら clockwise）。 */
export function ellipseSamples(cx: number, cy: number, rx: number, ry: number, t0: number, durUs: number, clockwise: boolean, n = 32): Sample[] {
  const pts: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    // 画面座標（y 下向き）で時計回りは角度を増やす向き。下（90度）から始める。
    const ang = Math.PI / 2 + (clockwise ? 1 : -1) * f * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang), tUs: Math.round(t0 + f * durUs) });
  }
  return pts;
}

/** 試験と手本用: 直線の軌跡を作る（角度は画面の上を 0 度として時計回り）。 */
export function lineSamples(x: number, y: number, deg: number, len: number, t0: number, durUs: number, n = 8): Sample[] {
  const pts: Sample[] = [];
  const dx = Math.sin((deg * Math.PI) / 180);
  const dy = -Math.cos((deg * Math.PI) / 180);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push({ x: x + dx * len * f, y: y + dy * len * f, tUs: Math.round(t0 + f * durUs) });
  }
  return pts;
}
