import { anchorBody, type AnchorKey, type FxStep } from './trick-fx-81';
import type { FxDrawContext, FxDrawerTable } from './trick-fx-context';
import {
  addScaled, clamp01, copyV, crossV, distV, envelope, lenV, lerpV, normV, planeBasis, rotateV, setV, subV, vec, type Vec,
} from './trick-fx-math';

// 使い回しの入れ物（描画は1本の流れで行うので共有してよい）。
const A = vec(), B = vec(), C = vec(), D = vec(), U = vec(), W = vec(), T = vec(), S = vec();
const UP: Vec = { x: 0, y: 1, z: 0 };
const TAU = Math.PI * 2;

const stepEnv = (step: FxStep, t: number): number =>
  step.dur > 0 ? envelope(t, step.dur, step.p?.rise ?? Math.min(140, step.dur * 0.3), step.p?.fall ?? step.dur * 0.5) : 1;

/** 履歴の中で windowMs だけ前の位置と今の位置。動いていなければ false。 */
function motion(ctx: FxDrawContext, key: AnchorKey, windowMs: number, now: Vec, then: Vec): boolean {
  return ctx.pos(key, now) && ctx.past(key, windowMs, then) && distV(now, then) > 0.03;
}

export const AIR_DRAWERS: FxDrawerTable = {
  /** 計測点の小さな光。一度だけ／交互／ゆっくり明暗、動いた向きへ短く伸ばす。 */
  glow(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const env = stepEnv(step, t);
    step.at.forEach((key, i) => {
      if (!ctx.pos(key, A)) return;
      let k = env;
      if (p.alternate) k *= Math.floor(ctx.clockMs / p.alternate) % step.at.length === i ? 1 : 0.25;
      if (p.breathe && !ctx.reduced) k *= 0.7 + 0.3 * Math.sin(ctx.clockMs / p.breathe * TAU + i);
      const c = ctx.color(step, key);
      ctx.pen.dot(A, step.size * (0.75 + 0.35 * k), c, alpha * k);
      if (p.stretch && !ctx.reduced && ctx.past(key, p.stretch, B) && distV(A, B) > 0.02) ctx.pen.line(A, B, c, alpha * k * 0.7);
    });
  },

  /** 身体の向きに合わせた細い輪郭（楕円）。回転が遅くなると淡くなる。 */
  outline(ctx, step, _i, _t, alpha) {
    const body = anchorBody(step.at[0]);
    const q = body && ctx.quat(body);
    if (!body || !q || !ctx.center(body, A)) return;
    rotateV(U, q, 1, 0, 0);
    rotateV(W, q, 0, 1, 0);
    const k = step.p?.speedFade ? Math.max(0.15, Math.min(1, ctx.speed(body) / 4)) : 1;
    const [rx, ry] = body === 'dog' ? [0.62, 0.3] : [0.24, 0.62];
    ctx.pen.arc(A, U, W, rx * step.size, ry * step.size, 0, TAU, 32, ctx.color(step, step.at[0]), alpha * k);
  },

  /** 肩や前足の外側に添える短い縁の光。 */
  rim(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    for (const key of step.at) {
      const body = anchorBody(key);
      if (!body || !ctx.pos(key, A) || !ctx.center(body, B)) continue;
      normV(subV(C, A, B));
      planeBasis(ctx.axis(body, D), C, U, W);
      const k = p.speedFade ? Math.max(0.2, Math.min(1, ctx.speed(body) / 4)) : 1;
      const span = p.full ? Math.PI : 0.85;
      ctx.pen.arc(A, U, W, step.size, step.size, -span, span, p.full ? 18 : 10, ctx.color(step, key), alpha * k);
    }
  },

  /** 光が計測点を順に伝わる。一巡だけ、またはなめらかに回り続ける。 */
  relay(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const keys = step.at;
    let total = 0;
    const lengths: number[] = [];
    for (let i = 1; i < keys.length; i++) {
      if (!ctx.pos(keys[i - 1], A) || !ctx.pos(keys[i], B)) return;
      lengths.push(distV(A, B));
      total += lengths[i - 1];
    }
    if (total <= 0) return;
    const pointAt = (frac: number, out: Vec) => {
      let need = clamp01(frac) * total;
      for (let i = 1; i < keys.length; i++) {
        if (need <= lengths[i - 1] || i === keys.length - 1) {
          ctx.pos(keys[i - 1], S); ctx.pos(keys[i], T);
          return lerpV(out, S, T, lengths[i - 1] > 0 ? Math.min(1, need / lengths[i - 1]) : 0);
        }
        need -= lengths[i - 1];
      }
      return out;
    };
    const count = step.n ?? 1, gap = p.gap ?? 0;
    for (let n = 0; n < count; n++) {
      const local = p.loop ? (((t - n * gap) % p.loop) + p.loop) % p.loop / p.loop
        : (t - n * gap) / Math.max(1, step.dur - (count - 1) * gap);
      const s = ctx.reduced ? (n + 0.5) / count : local;
      if (s < 0 || s > 1) continue;
      pointAt(s, C);
      pointAt(s - 0.1, D);
      const c = ctx.color(step, s < 0.5 ? keys[0] : keys[keys.length - 1]);
      ctx.pen.dot(C, step.size, c, alpha);
      ctx.pen.line(C, D, c, alpha * 0.6);
    }
  },

  /** 回転の向きに伸びる円弧。床の上（ground）では着地の大きな弧になる。 */
  arc(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    for (const key of step.at) {
      const body = anchorBody(key);
      if (!ctx.pos(key, A)) continue;
      const c = ctx.color(step, key);
      if (p.ground) {
        copyV(B, ctx.contact ?? A);
        B.y = ctx.groundY + 0.03;
        const start = Math.atan2(A.z - B.z, A.x - B.x);
        const grow = ctx.reduced ? 1 : clamp01(t / Math.max(1, step.dur * 0.6));
        ctx.pen.groundArc(B, step.size, c, alpha * stepEnv(step, t), start, start + (p.sweep ?? 2) * grow);
        continue;
      }
      if (p.upper && ctx.pos('riderHead', B)) lerpV(A, A, B, 0.45);
      const hasCenter = !!body && ctx.center(body, B);
      if (p.follow && ctx.pos('dogBack', B)) subV(C, A, B);
      else if (hasCenter) subV(C, A, B);
      else copyV(C, UP);
      planeBasis(ctx.axis(body, D), C, U, W);
      const sweep = (p.sweep ?? 1.5) * (body ? Math.max(0.3, Math.min(1, ctx.speed(body) / 5)) : 1);
      const turn = ctx.reduced || !body ? 0 : ctx.angle(body) * 0.15;
      const dir = p.side === -1 ? -1 : 1;
      const start = turn + (p.side === -1 ? Math.PI : 0);
      const center = p.follow || !hasCenter ? A : B;
      ctx.pen.arc(center, U, W, step.size, step.size, start, start + sweep * dir, 16, c, alpha, true);
    }
  },

  /** 帯。cross＝体の後ろで交差する二色の帯、around＝胴を巻く帯、それ以外＝回転の後ろへ広がる帯。 */
  band(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const lines = step.n ?? 3;
    if (p.cross) {
      if (!ctx.pos(step.at[0], A) || !ctx.pos(step.at[1], B)) return;
      setV(C, Math.cos(ctx.yaw), 0, Math.sin(ctx.yaw));
      setV(D, -Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
      addScaled(A, A, C, -(p.behind ?? 0.4));
      addScaled(B, B, C, -(p.behind ?? 0.4));
      const reach = 0.38;
      for (let k = 0; k < lines; k++) {
        const off = (k - (lines - 1) / 2) * step.size * 0.5;
        addScaled(S, A, D, -reach); S.y += off; addScaled(T, B, D, reach); T.y += off;
        ctx.pen.line(S, T, ctx.tone('dog'), alpha * 0.8);
        addScaled(S, A, D, reach); S.y += off; addScaled(T, B, D, -reach); T.y += off;
        ctx.pen.line(S, T, ctx.tone('rider'), alpha * 0.8);
      }
      lerpV(S, A, B, 0.5);
      ctx.pen.dot(S, 0.09, ctx.tone('white'), alpha * 0.8);
      return;
    }
    if (p.around) {
      const q = ctx.quat('dog');
      if (!q || !ctx.pos(step.at[0], A) || !ctx.pos(step.at[1], B)) return;
      lerpV(C, A, B, 0.5);
      rotateV(U, q, 0, 1, 0);
      rotateV(W, q, 0, 0, 1);
      rotateV(D, q, 1, 0, 0);
      const ry = Math.max(0.12, distV(A, B) / 2 + 0.04), rz = 0.24;
      const c = ctx.color(step, step.at[0]);
      for (let k = 0; k < lines; k++) {
        addScaled(S, C, D, (k - (lines - 1) / 2) * step.size);
        ctx.pen.arc(S, U, W, ry, rz, 0, TAU, 24, c, alpha * (k === (lines - 1) / 2 ? 1 : 0.55));
      }
      // 帯を一周する光で「巻いている」ことが分かるようにする。
      const s = ctx.reduced ? 0 : (ctx.clockMs % 900) / 900 * TAU;
      setV(T, C.x + U.x * Math.cos(s) * ry + W.x * Math.sin(s) * rz, C.y + U.y * Math.cos(s) * ry + W.y * Math.sin(s) * rz,
        C.z + U.z * Math.cos(s) * ry + W.z * Math.sin(s) * rz);
      ctx.pen.dot(T, 0.06, ctx.tone('amber'), alpha);
      return;
    }
    const body = anchorBody(step.at[0]);
    if (!body || !ctx.pos(step.at[0], A)) return;
    planeBasis(ctx.axis(body, D), UP, U, W);
    const end = ctx.reduced ? 0 : ctx.angle(body) * 0.2;
    const c = ctx.color(step, step.at[0]);
    for (let k = 0; k < lines; k++) {
      const r = step.size * (0.8 + 0.1 * k);
      ctx.pen.arc(A, U, W, r, r, end - (p.sweep ?? 2), end, 14, c, alpha * (0.85 - k * 0.12), true);
    }
  },

  /** 頭から腰を結ぶ回転の軸。ゆっくり明るくなって戻る（点滅させない）。 */
  axis(ctx, step, _i, _t, alpha) {
    if (!ctx.pos(step.at[0], A) || !ctx.pos(step.at[1], B)) return;
    const period = step.p?.period ?? 1400;
    const k = ctx.reduced ? 0.7 : 0.35 + 0.65 * Math.max(0, Math.sin(ctx.clockMs / period * TAU));
    subV(C, A, B);
    addScaled(S, A, C, step.size);
    addScaled(T, B, C, -step.size);
    const c = ctx.color(step, step.at[0]);
    ctx.pen.line(S, T, c, alpha * k);
    ctx.pen.dot(S, 0.05, c, alpha * k);
    ctx.pen.dot(T, 0.05, c, alpha * k);
  },

  /** 連携が実際に成立した瞬間だけ、二つの光が中央へ寄って解ける。下に小さな連携の印。 */
  pulse(ctx, step, _i, _t, alpha) {
    if (ctx.comboAgeMs === null || !ctx.pos(step.at[0], A) || !ctx.pos(step.at[1], B)) return;
    const s = ctx.reduced ? 0.5 : clamp01(ctx.comboAgeMs / Math.max(1, step.dur));
    lerpV(C, A, B, 0.5);
    const gather = s < 0.5 ? s * 2 : 1;
    const spread = s < 0.5 ? 0 : (s - 0.5) * 2;
    const k = 1 - spread;
    for (const [key, from] of [[step.at[0], A], [step.at[1], B]] as const) {
      lerpV(S, from, C, gather);
      if (spread > 0) addScaled(S, S, subV(T, from, C), -spread * 0.6);
      ctx.pen.dot(S, step.size, ctx.color(step, key), alpha * k);
    }
    // 連携の印：犬と人の色の小さな輪を二つ重ねる。
    setV(S, C.x, Math.min(A.y, B.y) - 0.55, C.z);
    setV(U, Math.cos(ctx.yaw), 0, Math.sin(ctx.yaw));
    setV(W, 0, 1, 0);
    addScaled(T, S, U, -0.1);
    ctx.pen.arc(T, U, W, 0.12, 0.12, 0, TAU, 16, ctx.tone('dog'), alpha * k);
    addScaled(T, S, U, 0.1);
    ctx.pen.arc(T, U, W, 0.12, 0.12, 0, TAU, 16, ctx.tone('rider'), alpha * k);
  },

  /** 少し前の姿勢を薄く残す残像。動いた部位だけ。paw は肉球形、frozen は着地後に空中の姿を短く残す。 */
  ghost(ctx, step, _i, t, alpha) {
    if (ctx.reduced) return;
    const p = step.p ?? {};
    const copies = step.n ?? 2, lag = p.lag ?? 120, life = p.life ?? 400;
    const env = stepEnv(step, t);
    for (let k = 1; k <= copies; k++) {
      if (lag * k > life) break;
      const ago = p.frozen ? lag * k + t : lag * k;
      const k01 = (1 - k / (copies + 1)) * env;
      let has = false;
      for (const key of step.at) {
        if (!ctx.past(key, ago, B)) { has = false; continue; }
        if (!p.frozen && ctx.pos(key, C) && distV(B, C) < 0.03) { has = false; continue; }
        const c = ctx.color(step, key);
        if (p.paw) {
          ctx.pen.dot(B, step.size, c, alpha * k01);
          for (let toe = -1; toe <= 1; toe++) {
            setV(S, B.x + toe * step.size * 0.7, B.y + step.size * 0.9, B.z);
            ctx.pen.dot(S, step.size * 0.4, c, alpha * k01);
          }
        } else if (has) ctx.pen.line(A, B, c, alpha * k01 * 0.8);
        copyV(A, B);
        has = true;
      }
    }
  },

  /** 身体を包む光の輪。輪ごとに傾きを変え、回転軸に合わせてゆっくり回す。 */
  orbit(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const first = step.at[0];
    const body = anchorBody(first);
    const c = ctx.color(step, first);
    if (p.enclose) {
      // 鼻・背中・しっぽを包む楕円。
      const q = ctx.quat('dog');
      if (!q || !ctx.pos('dogNose', A) || !ctx.pos('dogBack', B) || !ctx.pos('dogTail', C)) return;
      subV(U, A, C);
      const major = lenV(U) / 2 + 0.14;
      normV(U);
      rotateV(W, q, 0, 1, 0);
      const spin = ctx.reduced ? 0 : ctx.clockMs / 1000 * (p.spin ?? 0.8);
      crossV(T, U, W);
      setV(S, W.x * Math.cos(spin) + T.x * Math.sin(spin), W.y * Math.cos(spin) + T.y * Math.sin(spin), W.z * Math.cos(spin) + T.z * Math.sin(spin));
      lerpV(D, A, C, 0.5);
      ctx.pen.arc(D, U, S, major, step.size * 0.5, 0, TAU, 32, c, alpha);
      return;
    }
    const rings = step.n ?? 1;
    const grow = p.assemble ? (ctx.reduced ? 1 : clamp01(t / p.assemble)) : 1;
    for (let k = 0; k < rings; k++) {
      const key = p.perAnchor ? step.at[Math.min(k, step.at.length - 1)] : first;
      const placed = p.perAnchor ? ctx.pos(key, D) : (!!body && ctx.center(body, D)) || ctx.pos(key, D);
      if (!placed) continue;
      if (p.stagger && t < k * p.stagger) continue;
      ctx.axis(anchorBody(key), A);
      planeBasis(A, UP, U, W);
      // 輪ごとに軸を傾け、さらに軸のまわりへゆっくり回す。
      const tilt = (p.tilt ?? 0.4) * (k + 1);
      const spin = (ctx.reduced ? 0 : ctx.clockMs / 1000 * (p.spin ?? 1)) + k * 2.1;
      setV(B, A.x * Math.cos(tilt) + (U.x * Math.cos(spin) + W.x * Math.sin(spin)) * Math.sin(tilt),
        A.y * Math.cos(tilt) + (U.y * Math.cos(spin) + W.y * Math.sin(spin)) * Math.sin(tilt),
        A.z * Math.cos(tilt) + (U.z * Math.cos(spin) + W.z * Math.sin(spin)) * Math.sin(tilt));
      normV(B);
      planeBasis(B, UP, U, W);
      const r = step.size * grow * (p.layers ? 1 + 0.16 * k : p.perAnchor ? 0.6 + 0.15 * k : 1 - 0.1 * k);
      ctx.pen.arc(D, U, W, r, r, 0, TAU, 32, c, alpha * (p.layers ? 1 - 0.15 * k : 1));
      if (p.pair) markRing(ctx, D, U, W, r, p.pair, alpha);
    }
  },

  /** 2つの軌跡が近づいた瞬間だけ、交点に星を置く。 */
  crossStar(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const ra = ctx.hist(step.at[0]), rb = ctx.hist(step.at[1]);
    const memo = ctx.memo;
    if (ra && rb) {
      let best = Infinity;
      for (let i = 0; i < Math.min(ra.count, 16); i++) {
        ra.read(i, A);
        for (let j = 0; j < Math.min(rb.count, 16); j++) {
          rb.read(j, B);
          const d = distV(A, B);
          if (d < best) { best = d; lerpV(C, A, B, 0.5); }
        }
      }
      if (best < (p.near ?? 0.3)) { memo.starX = C.x; memo.starY = C.y; memo.starZ = C.z; memo.starAt = ctx.clockMs; }
    }
    if (memo.starAt === undefined) return;
    const age = ctx.clockMs - memo.starAt, hold = p.hold ?? 240;
    if (age > hold) return;
    setV(S, memo.starX, memo.starY, memo.starZ);
    const k = 1 - age / hold;
    if (p.x) {
      for (const sgn of [-1, 1]) {
        setV(A, S.x - step.size, S.y + sgn * step.size, S.z);
        setV(B, S.x + step.size, S.y - sgn * step.size, S.z);
        ctx.pen.line(A, B, ctx.color(step, null), alpha * k);
      }
    } else ctx.pen.star(S, step.size, ctx.color(step, null), alpha * k);
  },

  /** 計測点が通った道の線。部位ごとに1本、時間差や前後の色分けもできる。 */
  trail(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    step.at.forEach((key, i) => {
      const ring = ctx.hist(key);
      if (!ring) return;
      const body = anchorBody(key);
      let windowMs = p.window ?? 300;
      if (ctx.reduced) windowMs *= 0.3;
      if (p.speedLength && body) windowMs *= Math.max(0.3, Math.min(1, ctx.speed(body) / 6));
      let c = ctx.color(step, key);
      if (p.frontBack && key.includes('PawB')) c = ctx.tone('amber');
      ctx.pen.trail(ring, ctx.clockMs - (p.delay ?? 0) * i, windowMs, c, alpha, p.style ?? 0, step.size);
    });
  },

  /** 少し前の位置と今の位置を結ぶ半円。犬は下、人は上にふくらむ。 */
  halfArc(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    for (const key of step.at) {
      if (!motion(ctx, key, p.window ?? 300, A, B)) continue;
      subV(C, A, B);
      const r = lenV(C) / 2;
      lerpV(D, A, B, 0.5);
      normV(C);
      setV(T, 0, p.bulge ?? 1, 0);
      planeBasis(C, T, W, S);
      ctx.pen.arc(D, C, W, r, r * 0.9, Math.PI, 0, 16, ctx.color(step, key), alpha);
    }
  },

  /** らせん。通った道に沿って巻く、または腰のまわりに回転軸に沿って縦長に巻く。 */
  helix(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const turns = p.turns ?? 2;
    for (const key of step.at) {
      const body = anchorBody(key);
      const c = ctx.color(step, key);
      const phase = ctx.reduced || !body ? 0 : ctx.angle(body);
      if (p.axisAligned) {
        if (!body || !ctx.pos(key, A)) continue;
        ctx.axis(body, D);
        planeBasis(D, UP, U, W);
        for (let i = 0; i <= 36; i++) {
          const h = (i / 36 - 0.5) * 1.0, a = i / 36 * turns * TAU + phase;
          setV(T, A.x + D.x * h + (U.x * Math.cos(a) + W.x * Math.sin(a)) * step.size,
            A.y + D.y * h + (U.y * Math.cos(a) + W.y * Math.sin(a)) * step.size,
            A.z + D.z * h + (U.z * Math.cos(a) + W.z * Math.sin(a)) * step.size);
          if (i > 0) ctx.pen.line(S, T, c, alpha * (0.4 + 0.6 * i / 36));
          copyV(S, T);
        }
        continue;
      }
      const ring = ctx.hist(key);
      if (!ring || ring.count < 3) continue;
      const windowMs = p.window ?? 500;
      let has = false;
      for (let k = 1; k < ring.count - 1; k++) {
        const age = ctx.clockMs - ring.time(k);
        if (age > windowMs) break;
        ring.read(k - 1, A); ring.read(k + 1, B); ring.read(k, D);
        normV(subV(C, A, B));
        planeBasis(C, UP, U, W);
        const a = k / 12 * turns * TAU + phase * 0.3;
        const r = step.size * (body ? Math.max(0.5, Math.min(1.2, ctx.speed(body) / 6)) : 1);
        setV(T, D.x + (U.x * Math.cos(a) + W.x * Math.sin(a)) * r, D.y + (U.y * Math.cos(a) + W.y * Math.sin(a)) * r,
          D.z + (U.z * Math.cos(a) + W.z * Math.sin(a)) * r);
        if (has) ctx.pen.line(S, T, c, alpha * (1 - age / windowMs));
        copyV(S, T);
        has = true;
      }
    }
  },

  /** 8の字。二つの輪が上下に並び、片方しか回っていなければ輪は一つ。 */
  eight(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const [k0, k1] = step.at;
    if (!ctx.pos(k0, A) || !ctx.pos(k1, B)) return;
    const b0 = anchorBody(k0), b1 = anchorBody(k1);
    let two: boolean;
    if (p.axisChange) {
      // 人型：回転の軸が実際に変わったときだけ二つ目の輪を描く。
      ctx.axis('rider', D);
      const memo = ctx.memo;
      if (memo.ax === undefined) { memo.ax = D.x; memo.ay = D.y; memo.az = D.z; }
      if (D.x * memo.ax + D.y * memo.ay + D.z * memo.az < Math.cos(0.6)) memo.changed = 1;
      two = memo.changed === 1;
    } else {
      two = !!b0 && !!b1 && ctx.speed(b0) > 0.6 && ctx.speed(b1) > 0.6;
    }
    lerpV(C, A, B, 0.5);
    const loops = two ? [[k0, 1], [k1, -1]] as const : [[ctx.speed(b0 ?? 'dog') >= ctx.speed(b1 ?? 'rider') ? k0 : k1, 0]] as const;
    for (const [key, side] of loops) {
      const body = anchorBody(key);
      ctx.axis(body, D);
      planeBasis(D, UP, U, W);
      setV(T, C.x, C.y + side * step.size * 0.6, C.z);
      if (p.axisChange) ctx.pos(key, T);
      const c = ctx.color(step, key);
      ctx.pen.arc(T, U, W, step.size * 0.55, step.size * 0.55, 0, TAU, 24, c, alpha);
      const s = ctx.reduced ? 0 : ctx.clockMs / 400;
      setV(S, T.x + (U.x * Math.cos(s) + W.x * Math.sin(s)) * step.size * 0.55, T.y + (U.y * Math.cos(s) + W.y * Math.sin(s)) * step.size * 0.55,
        T.z + (U.z * Math.cos(s) + W.z * Math.sin(s)) * step.size * 0.55);
      ctx.pen.dot(S, 0.06, c, alpha);
    }
  },

  /** 楕円を二つ。両方：犬と人の回転軸に沿う輪。犬：鼻と尾の輪で、縦回転なら縦長、横回転なら横長。 */
  ellipses(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    for (const key of step.at) {
      if (!ctx.pos(key, A)) continue;
      const body = anchorBody(key);
      const c = ctx.color(step, key);
      ctx.axis(body, D);
      if (p.aspect) {
        const spinFlat = Math.abs(D.y) > 0.7;
        setV(U, Math.cos(ctx.yaw), 0, Math.sin(ctx.yaw));
        if (spinFlat) setV(W, -Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
        else setV(W, 0, 1, 0);
        const [ru, rw] = spinFlat ? [step.size * 1.3, step.size * 0.8] : [step.size * 0.7, step.size * 1.3];
        ctx.pen.arc(A, U, W, ru, rw, 0, TAU, 28, c, alpha);
        continue;
      }
      if (body) ctx.center(body, A);
      planeBasis(D, UP, U, W);
      const minor = step.size * (0.45 + 0.5 * Math.abs(D.y));
      ctx.pen.arc(A, U, W, step.size, minor, 0, TAU, 28, c, alpha);
      if (p.history) {
        // 少し前の傾きの輪も薄く残して、二つの軌道の履歴を見せる。
        const memo = ctx.memo;
        const tag = body === 'dog' ? 'd' : 'r';
        if (memo[`${tag}x`] === undefined || ctx.clockMs - (memo[`${tag}t`] ?? 0) > 350) {
          memo[`${tag}px`] = memo[`${tag}x`] ?? D.x; memo[`${tag}py`] = memo[`${tag}y`] ?? D.y; memo[`${tag}pz`] = memo[`${tag}z`] ?? D.z;
          memo[`${tag}x`] = D.x; memo[`${tag}y`] = D.y; memo[`${tag}z`] = D.z; memo[`${tag}t`] = ctx.clockMs;
        }
        setV(T, memo[`${tag}px`], memo[`${tag}py`], memo[`${tag}pz`]);
        normV(T);
        planeBasis(T, UP, U, W);
        ctx.pen.arc(A, U, W, step.size * 1.08, minor * 1.08, 0, TAU, 28, c, alpha * 0.35);
      }
    }
  },

  /** 犬と人の線を互い違いに揺らして重ね、編み紐に見せる。先頭の光が後ろから追いつく。 */
  braid(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const windowMs = (p.window ?? 600) * (ctx.reduced ? 0.3 : 1);
    const waves = p.waves ?? 5;
    step.at.forEach((key, side) => {
      const ring = ctx.hist(key);
      if (!ring || ring.count < 3) return;
      const c = ctx.color(step, key);
      let has = false;
      let n = 0;
      for (let k = 0; k < ring.count; k++) if (ctx.clockMs - ring.time(k) <= windowMs) n = k;
      for (let k = 1; k < n; k++) {
        ring.read(k - 1, A); ring.read(k + 1, B); ring.read(k, D);
        normV(subV(C, A, B));
        planeBasis(C, UP, U, W);
        const off = Math.sin(k / Math.max(1, n) * waves * TAU + (side ? Math.PI : 0)) * step.size;
        addScaled(T, D, U, off);
        if (has) ctx.pen.line(S, T, c, alpha * (1 - k / n));
        copyV(S, T);
        has = true;
      }
      if (!ctx.reduced && n > 2) {
        const head = Math.floor((1 - (ctx.clockMs % 700) / 700) * (n - 1));
        ring.read(head, T);
        ctx.pen.dot(T, 0.06, ctx.tone('white'), alpha * 0.7);
      }
    });
  },

  /** 手首の三日月。動く向きの後ろへ開き、回転が逆になると向きも逆になる。 */
  crescent(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    ctx.axis('rider', D);
    const flip = D.y < 0 ? -1 : 1;
    for (const key of step.at) {
      if (!motion(ctx, key, p.window ?? 260, A, B)) continue;
      normV(subV(C, A, B));
      planeBasis(C, UP, U, W);
      const c = ctx.color(step, key);
      const r = step.size;
      addScaled(T, A, C, -r * 0.5);
      ctx.pen.arc(T, C, U, r, r * flip, -Math.PI / 2, Math.PI / 2, 14, c, alpha);
      addScaled(T, A, C, -r * 0.3);
      ctx.pen.arc(T, C, U, r * 0.7, r * 0.8 * flip, -Math.PI / 2, Math.PI / 2, 12, c, alpha * 0.6);
    }
  },

  /** 肩と手の道を結び、向きが変わった所に角、先に矢印を付ける。 */
  arrow(ctx, step, _i, _t, alpha) {
    const p = step.p ?? {};
    const windowMs = (p.window ?? 500) * (ctx.reduced ? 0.3 : 1);
    const [guide, tipKey] = step.at;
    const guideRing = ctx.hist(guide);
    if (guideRing) ctx.pen.trail(guideRing, ctx.clockMs, windowMs, ctx.color(step, guide), alpha * 0.35, 2);
    const ring = ctx.hist(tipKey);
    if (!ring || ring.count < 3) return;
    const c = ctx.color(step, tipKey);
    ctx.pen.trail(ring, ctx.clockMs, windowMs, c, alpha, 0);
    for (let k = 1; k < ring.count - 1; k++) {
      if (ctx.clockMs - ring.time(k + 1) > windowMs) break;
      ring.read(k - 1, A); ring.read(k, B); ring.read(k + 1, C);
      subV(S, A, B); subV(T, B, C);
      const l1 = lenV(S), l2 = lenV(T);
      if (l1 < 0.02 || l2 < 0.02) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, (S.x * T.x + S.y * T.y + S.z * T.z) / (l1 * l2))));
      if (turn > (p.corner ?? 0.7)) ctx.pen.dot(B, 0.05, ctx.tone('white'), alpha * 0.8);
    }
    ring.read(0, A); ring.read(2, B);
    subV(C, A, B);
    if (lenV(C) < 0.02) return;
    normV(C);
    planeBasis(C, UP, U, W);
    for (const sgn of [-1, 1]) {
      setV(T, A.x - C.x * step.size + U.x * sgn * step.size * 0.6, A.y - C.y * step.size + U.y * sgn * step.size * 0.6,
        A.z - C.z * step.size + U.z * sgn * step.size * 0.6);
      ctx.pen.line(A, T, c, alpha);
    }
  },

  /** 四足と鼻先を結ぶ星座。着地に向かうとき（消えかけ）は線が細くほどける。 */
  constellation(ctx, step, _i, _t, alpha) {
    const keys = step.at;
    const untie = ctx.fading ? 0.35 : 1;
    for (let i = 0; i < keys.length; i++) {
      const a = keys[i], b = keys[(i + 1) % keys.length];
      if (!ctx.pos(a, A) || !ctx.pos(b, B)) continue;
      const c = ctx.color(step, a);
      ctx.pen.dot(A, step.size, c, alpha);
      lerpV(C, A, B, 0.5);
      lerpV(S, C, A, untie);
      lerpV(T, C, B, untie);
      ctx.pen.line(S, T, c, alpha * 0.7);
      const ring = ctx.hist(a);
      if (ring) ctx.pen.trail(ring, ctx.clockMs, (step.p?.window ?? 260) * (ctx.reduced ? 0.3 : 1), c, alpha * 0.5, 0);
    }
  },

  /** 扇形の光。空中は動く向き（または後ろ）へ、着地は肩から左右へ広げる。 */
  fan(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const lines = step.n ?? 5;
    const env = stepEnv(step, t);
    step.at.forEach((key, i) => {
      if (!ctx.pos(key, A)) return;
      const body = anchorBody(key);
      const c = ctx.color(step, key);
      if (p.sides) {
        setV(C, -Math.sin(ctx.yaw) * (i === 0 ? -1 : 1), 0, Math.cos(ctx.yaw) * (i === 0 ? -1 : 1));
        copyV(D, UP);
      } else {
        if (!ctx.past(key, 120, B) || distV(A, B) < 0.02) return;
        subV(C, A, B);
        normV(C);
        if ((p.velocity ?? 1) < 0) setV(C, -C.x, -C.y, -C.z);
        crossV(D, ctx.axis(body, T), C);
        if (lenV(D) < 1e-3) copyV(D, UP);
        normV(D);
      }
      const grow = p.sides ? (ctx.reduced ? 1 : clamp01(t / Math.max(1, step.dur * 0.5))) : 1;
      let spread = p.spread ?? 0.8;
      if (p.speedSpread && body) spread *= Math.max(0.4, Math.min(1.6, ctx.speed(body) / 5));
      for (let k = 0; k < lines; k++) {
        const a = (k / Math.max(1, lines - 1) - 0.5) * spread;
        setV(S, C.x * Math.cos(a) + D.x * Math.sin(a), C.y * Math.cos(a) + D.y * Math.sin(a), C.z * Math.cos(a) + D.z * Math.sin(a));
        addScaled(T, A, S, step.size * grow);
        ctx.pen.line(A, T, c, alpha * env * (1 - Math.abs(a) / Math.max(0.01, spread)));
      }
    });
  },
};

/** 二つの輪の交点を明るくする（1つ目の輪の点を覚え、2つ目の輪で近い所を探す）。 */
function markRing(ctx: FxDrawContext, o: Vec, u: Vec, w: Vec, r: number, pair: number, alpha: number): void {
  const pts = ctx.ringPoints;
  const segs = 24;
  if (pair === 1) {
    for (let i = 0; i < segs; i++) {
      const a = i / segs * TAU;
      pts[i * 3] = o.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r;
      pts[i * 3 + 1] = o.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r;
      pts[i * 3 + 2] = o.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r;
    }
    ctx.ringCount = segs;
    return;
  }
  for (let i = 0; i < segs; i++) {
    const a = i / segs * TAU;
    setV(S, o.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, o.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r,
      o.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r);
    for (let j = 0; j < ctx.ringCount; j++) {
      setV(T, pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
      if (distV(S, T) < 0.12) { ctx.pen.dot(S, 0.08, ctx.tone('white'), alpha); break; }
    }
  }
}
