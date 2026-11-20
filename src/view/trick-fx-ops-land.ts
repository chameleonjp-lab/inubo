import { anchorBody, type AnchorKey, type FxStep } from './trick-fx-81';
import type { FxDrawContext, FxDrawerTable } from './trick-fx-context';
import { FX_RGB, addScaled, clamp01, copyV, distV, easeOut, envelope, lerpV, setV, vec, type Rgb, type Vec } from './trick-fx-math';
import type { DecalShape } from './trick-fx-pen';

const A = vec(), B = vec(), C = vec(), D = vec(), F = vec(), R = vec(), S = vec(), T = vec();
const TAU = Math.PI * 2;

/** 着地の部品の共通値：進み具合 u（0〜1）、明るさ env、床の高さ、前と右の向き。 */
function frameOf(ctx: FxDrawContext, step: FxStep, t: number) {
  const dur = Math.max(1, step.dur);
  const u = ctx.reduced ? 0.7 : clamp01(t / dur);
  const env = envelope(t, dur, step.p?.rise ?? Math.min(120, dur * 0.2), step.p?.fall ?? dur * 0.45);
  const y = ctx.groundY + 0.03;
  setV(F, Math.cos(ctx.yaw), 0, Math.sin(ctx.yaw));
  setV(R, -Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
  return { u, env, y };
}

/** 計測点を床へ下ろした位置。contact はそのまま。 */
function onGround(ctx: FxDrawContext, key: AnchorKey, _y: number, out: Vec): boolean {
  if (!ctx.pos(key, out)) return false;
  out.y = ctx.groundAt(out.x, out.z) + 0.03;
  return true;
}

/** 接地点から前後左右にずらした位置を、斜面の高さへ合わせる。 */
function lift(ctx: FxDrawContext, out: Vec): Vec {
  out.y = ctx.groundAt(out.x, out.z) + 0.03;
  return out;
}

function contactOf(ctx: FxDrawContext, y: number, out: Vec): Vec {
  if (ctx.contact) copyV(out, ctx.contact);
  else if (!ctx.pos('pivot', out)) setV(out, 0, y, 0);
  out.y = y;
  return out;
}

const shapeOf = (key: AnchorKey, override?: number): DecalShape =>
  (override !== undefined ? override : anchorBody(key) === 'rider' ? 1 : 0) as DecalShape;

/** 床の上の線分を、中心からの角度と距離で描く。 */
function ray(ctx: FxDrawContext, o: Vec, angle: number, r0: number, r1: number, c: Rgb, alpha: number): void {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  setV(S, o.x + cs * r0, o.y, o.z + sn * r0);
  setV(T, o.x + cs * r1, o.y, o.z + sn * r1);
  ctx.pen.line(S, T, c, alpha);
}

export const LAND_DRAWERS: FxDrawerTable = {
  /** 足や靴の真下に小さな点。 */
  groundDot(ctx, step, _i, t, alpha) {
    const { env, y } = frameOf(ctx, step, t);
    for (const key of step.at) if (onGround(ctx, key, y, A)) ctx.pen.dot(A, step.size, ctx.color(step, key), alpha * env);
  },

  /** 接地点から広がる輪。half=後ろ半分、ellipse=左右に伸びた楕円、n=重ねる数、twoCenters=左右二つの中心。 */
  ring(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { y } = frameOf(ctx, step, t);
    const rings = step.n ?? 1, gap = p.gap ?? 150;
    const centers: [Vec, Rgb][] = [];
    if (p.twoCenters) {
      contactOf(ctx, y, C);
      centers.push([addScaled(A, C, R, -p.twoCenters), FX_RGB.dog], [addScaled(B, C, R, p.twoCenters), FX_RGB.rider]);
    } else {
      step.at.forEach((key, i) => {
        const out = [A, B, C, D][i];
        if (!out) return;
        if (key === 'contact') contactOf(ctx, y, out);
        else if (!onGround(ctx, key, y, out)) return;
        centers.push([out, ctx.color(step, key)]);
      });
    }
    for (let k = 0; k < rings; k++) {
      const local = t - k * gap;
      const dur = Math.max(1, step.dur - k * gap);
      if (local < 0 || local > dur) continue;
      const u = ctx.reduced ? 0.7 : clamp01(local / dur);
      const r = Math.min(p.max ?? Infinity, step.size * (0.15 + 0.85 * easeOut(u)));
      const k01 = (1 - u) * (p.thin ? 0.6 : 1) * Math.min(1, local / 80);
      for (const [o, c] of centers) {
        if (p.half) ctx.pen.groundArc(o, r, c, alpha * k01, ctx.yaw + Math.PI / 2, ctx.yaw + Math.PI * 1.5, ctx.yaw);
        else ctx.pen.groundArc(o, r, c, alpha * k01, 0, TAU, ctx.yaw + Math.PI / 2, p.ellipse ?? 1);
      }
    }
  },

  /** 床の印（肉球・靴底・手のひら）。alternate は左右へ一組ずつ順に押す。 */
  prints(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { env, y } = frameOf(ctx, step, t);
    const pop = ctx.reduced ? 1 : Math.min(1, t / 120);
    step.at.forEach((key, i) => {
      if (p.alternate) {
        // 犬の肉球と人の靴底を、左右へ交互に一組ずつ。
        for (let pair = 0; pair < 2; pair++) {
          const appear = (pair * 2 + i) * p.alternate;
          if (t < appear) continue;
          contactOf(ctx, y, A);
          addScaled(A, A, R, i === 0 ? -0.26 : 0.26);
          addScaled(A, A, F, pair * 0.42 - 0.2);
          lift(ctx, A);
          ctx.pen.decal(A, ctx.yaw, shapeOf(key), step.size, ctx.color(step, key), alpha * env);
        }
        return;
      }
      if (p.side) {
        contactOf(ctx, y, A);
        addScaled(A, A, R, (i === 0 ? -1 : 1) * p.side);
        lift(ctx, A);
      } else if (key === 'contact') contactOf(ctx, y, A);
      else if (!onGround(ctx, key, y, A)) return;
      ctx.pen.decal(A, ctx.yaw, shapeOf(key, p.shape), step.size * pop, ctx.color(step, key), alpha * env);
    });
  },

  /** 着地の左右へ低い粒を扇形に散らす（一度だけ）。両方は左が橙、右が青。 */
  spray(ctx, step, index, t, alpha) {
    if (ctx.reduced || !ctx.once(index)) return;
    const p = step.p ?? {};
    const { y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const n = (step.n ?? 30) * (ctx.weak ? 0.35 : 1) * Math.min(1, alpha / 0.6);
    const both = step.color === 'body';
    const fan = p.fan ?? 1;
    ctx.pen.burst(n / 2, C, both ? FX_RGB.dog : ctx.color(step, null), 2.4, p.up ?? 0.6, 0.7, -R.x, -R.z, fan);
    ctx.pen.burst(n / 2, C, both ? FX_RGB.rider : ctx.color(step, null), 2.4, p.up ?? 0.6, 0.7, R.x, R.z, fan);
  },

  /** 二つの波紋。highlight は重なる所を白く、merge は中央へ寄って一つになる。 */
  ripples(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { u, y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const apart = (p.apart ?? 0.5) * (p.merge ? 1 - easeOut(Math.min(1, u / 0.6)) : 1);
    lift(ctx, addScaled(A, C, R, -apart));
    lift(ctx, addScaled(B, C, R, apart));
    const r = step.size * (0.2 + 0.8 * easeOut(u));
    const k = (1 - u) * Math.min(1, t / 80);
    ctx.pen.groundArc(A, r, FX_RGB.dog, alpha * k);
    ctx.pen.groundArc(B, r, FX_RGB.rider, alpha * k);
    if (p.merge && u > 0.6) ctx.pen.groundArc(C, r * 1.1, FX_RGB.white, alpha * k);
    const d = distV(A, B);
    if (p.highlight && d < 2 * r && d > 1e-3) {
      // 二つの円が交わる点だけを白く光らせる。
      const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
      for (const sgn of [-1, 1]) {
        addScaled(S, C, F, sgn * h);
        ctx.pen.dot(S, 0.09, FX_RGB.white, alpha * k);
      }
    }
  },

  /** 放射の短い光線。alternate は起点ごとに時間差で交互に出す。回転の向きで角度をずらす。 */
  rays(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { u, env, y } = frameOf(ctx, step, t);
    const lines = step.n ?? 6;
    ctx.axis(anchorBody(step.at[0]), T);
    const twist = T.y >= 0 ? 0.25 : -0.25;
    step.at.forEach((key, i) => {
      if (!onGround(ctx, key, y, A)) return;
      const k = p.alternate && !ctx.reduced ? 0.4 + 0.6 * Math.max(0, Math.sin((t / 160 + i * 0.5) * Math.PI)) : 1;
      const c = ctx.color(step, key);
      for (let j = 0; j < lines; j++) {
        const angle = ctx.yaw + (j + (p.alternate ? i * 0.5 : 0)) / lines * TAU + twist;
        ray(ctx, A, angle, 0.08, 0.08 + step.size * easeOut(u), c, alpha * env * k);
      }
    });
  },

  /** 二人の後ろの冠形の弧。腰から上で止め、技名には重ねない。 */
  crown(ctx, step, _i, t, alpha) {
    const { env } = frameOf(ctx, step, t);
    const layers = step.n ?? 2;
    step.at.forEach((key) => {
      if (!ctx.pos(key, A)) return;
      const c = ctx.color(step, key);
      addScaled(A, A, F, -0.35);
      for (let layer = 0; layer < layers; layer++) {
        const w = 0.35 + layer * 0.12, h = step.size * (0.6 + layer * 0.4);
        const rise = ctx.reduced ? 1 : easeOut(t / 300);
        for (let k = 0; k < 6; k++) {
          const x0 = -w + (2 * w) * k / 6, x1 = -w + (2 * w) * (k + 1) / 6;
          addScaled(S, A, R, x0); S.y += (k % 2 ? h : h * 0.45) * rise;
          addScaled(T, A, R, x1); T.y += ((k + 1) % 2 ? h : h * 0.45) * rise;
          ctx.pen.line(S, T, c, alpha * env * (1 - layer * 0.3));
        }
      }
    });
  },

  /** 空中に残った線を着地点へ集め、輪にして広げる。sparks は輪が閉じた瞬間に四方へ光点。 */
  collect(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { u, env, y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const gather = Math.min(1, u / 0.45);
    for (const key of step.at) {
      const ring = ctx.hist(key);
      const c = ctx.color(step, key);
      if (ring && ring.count > 1 && gather < 1) {
        let has = false;
        for (let k = 0; k < ring.count; k++) {
          ring.read(k, A);
          lerpV(B, A, C, easeOut(gather));
          if (has) ctx.pen.line(D, B, c, alpha * (1 - gather * 0.5));
          copyV(D, B);
          has = true;
        }
      } else if (!ring && ctx.pos(key, A) && gather < 1) {
        lerpV(B, A, C, easeOut(gather));
        ctx.pen.line(A, B, c, alpha * (1 - gather));
      }
    }
    if (u < 0.45) return;
    const spreadU = (u - 0.45) / 0.55;
    const rings = step.n ?? 1;
    for (let k = 0; k < rings; k++) {
      const key = step.at[Math.min(k, step.at.length - 1)];
      ctx.pen.groundArc(C, step.size * (0.3 + 0.7 * easeOut(spreadU)) * (1 + k * 0.18), ctx.color(step, key), alpha * env);
    }
    if (p.sparks && !ctx.reduced) {
      for (let k = 0; k < p.sparks; k++) {
        const a = ctx.yaw + k / p.sparks * TAU;
        setV(S, C.x + Math.cos(a) * (0.3 + spreadU), y + 0.05, C.z + Math.sin(a) * (0.3 + spreadU));
        ctx.pen.dot(S, 0.07, FX_RGB.ice, alpha * env * (1 - spreadU));
      }
    }
  },

  /** 肩のまわりの粒が床へ降りて、着地点へ集まる。顔の前には置かない。 */
  fall(ctx, step, _i, t, alpha) {
    const { u, env, y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const count = Math.round((step.n ?? 8) * (ctx.weak ? 0.5 : 1));
    for (let k = 0; k < count; k++) {
      const key = step.at[k % step.at.length];
      if (!ctx.pos(key, A)) continue;
      // 肩の外側（左右）から出す。
      addScaled(A, A, R, (k % step.at.length === 0 ? -1 : 1) * (0.08 + (k % 3) * 0.05));
      const a = k / count * TAU;
      setV(B, C.x + Math.cos(a) * 0.25, y, C.z + Math.sin(a) * 0.25);
      lerpV(S, A, B, easeOut(Math.min(1, u * 1.4 + (k % 4) * 0.04)));
      ctx.pen.dot(S, step.size, ctx.color(step, key), alpha * env);
    }
  },

  /** 乗り手だけの細い人型を、背中の側へ短く出す。 */
  silhouette(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const hold = p.hold ?? 500;
    const k = (ctx.reduced ? 1 : Math.min(1, t / 100)) * (t > hold ? Math.max(0, 1 - (t - hold) / 150) : 1);
    const pts: Partial<Record<AnchorKey, Vec>> = {};
    const pool = [vec(), vec(), vec(), vec(), vec(), vec(), vec(), vec()];
    step.at.forEach((key, i) => {
      if (ctx.pos(key, pool[i])) pts[key] = addScaled(pool[i], pool[i], F, -(p.back ?? 0.45));
    });
    const c = ctx.color(step, step.at[0]);
    const bones: [AnchorKey, AnchorKey][] = [
      ['riderHead', 'riderShoulderL'], ['riderHead', 'riderShoulderR'], ['riderShoulderL', 'riderHandL'], ['riderShoulderR', 'riderHandR'],
      ['riderShoulderL', 'riderWaist'], ['riderShoulderR', 'riderWaist'], ['riderWaist', 'riderShoeL'], ['riderWaist', 'riderShoeR'],
    ];
    for (const [a, b] of bones) if (pts[a] && pts[b]) ctx.pen.line(pts[a]!, pts[b]!, c, alpha * k);
    if (pts.riderHead) ctx.pen.dot(pts.riderHead, 0.1, c, alpha * k);
  },

  /** しっぽの側から始まる小さな渦。足元へ向かって巻きながら縮む。 */
  swirl(ctx, step, _i, t, alpha) {
    const { u, env, y } = frameOf(ctx, step, t);
    if (!onGround(ctx, step.at[0], y, A)) return;
    contactOf(ctx, y, C);
    const start = Math.atan2(A.z - C.z, A.x - C.x);
    const r0 = Math.max(step.size, distV(A, C));
    const upto = Math.max(2, Math.round(32 * (ctx.reduced ? 1 : Math.min(1, u * 1.5))));
    for (let i = 0; i <= upto; i++) {
      const s = i / 32;
      const r = r0 * (1 - s * 0.9);
      setV(T, C.x + Math.cos(start + s * TAU * 1.2) * r, y, C.z + Math.sin(start + s * TAU * 1.2) * r);
      if (i > 0) ctx.pen.line(S, T, ctx.color(step, step.at[0]), alpha * env);
      copyV(S, T);
    }
  },

  /** 床から肉球の粒が少しだけ跳ね、下へ落ちて印になる。 */
  bounce(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const { u, env, y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const count = step.n ?? 6;
    const c = ctx.color(step, null);
    for (let k = 0; k < count; k++) {
      const a = ctx.yaw + k / count * TAU;
      const r = 0.3 + (k % 2) * 0.15;
      const hop = ctx.reduced ? 0 : Math.abs(Math.sin(u * 2 * Math.PI)) * (p.height ?? 0.5) * (1 - u);
      setV(A, C.x + Math.cos(a) * r * (0.5 + u), y + hop, C.z + Math.sin(a) * r * (0.5 + u));
      ctx.pen.dot(A, step.size * 0.5, c, alpha * env);
      if (hop < 0.04) { lift(ctx, A); ctx.pen.decal(A, ctx.yaw, 0, step.size, c, alpha * env * 0.6); }
    }
  },

  /** しっぽの弧から、着地点のまわりに花びら形の線を順に描く。 */
  petals(ctx, step, _i, t, alpha) {
    const { env, y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const base = onGround(ctx, step.at[0], y, A) ? Math.atan2(A.z - C.z, A.x - C.x) : ctx.yaw + Math.PI;
    const count = step.n ?? 4;
    const c = ctx.color(step, step.at[0]);
    for (let k = 0; k < count; k++) {
      const appear = k * 120;
      if (!ctx.reduced && t < appear) continue;
      const grow = ctx.reduced ? 1 : easeOut((t - appear) / 300);
      const a = base + k / count * TAU;
      for (let i = 0; i <= 16; i++) {
        const s = i / 16;
        // 花びら：外へ出て戻る細い輪。
        const r = step.size * Math.sin(s * Math.PI) * grow;
        const w = (s - 0.5) * 0.7;
        setV(T, C.x + Math.cos(a + w) * r, y, C.z + Math.sin(a + w) * r);
        if (i > 0) ctx.pen.line(S, T, c, alpha * env);
        copyV(S, T);
      }
    }
  },

  /** 着地点から進行方向へ、肉球の印を連続して置き、後ろから消す。 */
  pawBand(ctx, step, _i, t, alpha) {
    const { y } = frameOf(ctx, step, t);
    contactOf(ctx, y, C);
    const count = step.n ?? 6;
    const c = ctx.color(step, null);
    for (let k = 0; k < count; k++) {
      const appear = ctx.reduced ? 0 : k * 60;
      const gone = 400 + k * 80;
      if (t < appear || t > Math.min(step.dur, gone + 200)) continue;
      const k01 = Math.min(1, (t - appear) / 80) * (t > gone ? 1 - (t - gone) / 200 : 1);
      addScaled(A, C, F, 0.2 + k * 0.3);
      lift(ctx, addScaled(A, A, R, k % 2 ? 0.1 : -0.1));
      ctx.pen.decal(A, ctx.yaw, 0, step.size, c, alpha * k01);
    }
  },

  /** 紋章。1=肉球と輪、2=肉球と星、3=連携の印（二つの輪と星）、4=空中で二人の間に出る連携の印。 */
  emblem(ctx, step, _i, t, alpha) {
    const p = step.p ?? {};
    const shape = p.shape ?? 1;
    const pop = ctx.reduced ? 1 : easeOut(t / 220);
    const k = step.dur > 0 ? envelope(t, step.dur, 120, step.dur * 0.4) : 1;
    const size = step.size * pop;
    const c = ctx.color(step, null);
    if (shape === 4) {
      if (!ctx.pos('pivot', C)) return;
      setV(A, C.x - size * 0.25, C.y, C.z);
      setV(B, C.x + size * 0.25, C.y, C.z);
      setV(S, Math.cos(ctx.yaw), 0, Math.sin(ctx.yaw));
      setV(T, 0, 1, 0);
      ctx.pen.arc(A, S, T, size * 0.4, size * 0.4, 0, TAU, 24, FX_RGB.dog, alpha * k);
      ctx.pen.arc(B, S, T, size * 0.4, size * 0.4, 0, TAU, 24, FX_RGB.rider, alpha * k);
      ctx.pen.star(C, size * 0.25, c, alpha * k);
      return;
    }
    const y = ctx.groundY + 0.04;
    contactOf(ctx, y, C);
    if (shape === 3) {
      addScaled(A, C, R, -size * 0.3);
      addScaled(B, C, R, size * 0.3);
      ctx.pen.groundArc(A, size * 0.45, FX_RGB.dog, alpha * k);
      ctx.pen.groundArc(B, size * 0.45, FX_RGB.rider, alpha * k);
      ctx.pen.decal(C, ctx.yaw, 3, size * 0.5, c, alpha * k);
      return;
    }
    ctx.pen.decal(C, ctx.yaw, 0, size * 0.8, shape === 2 ? FX_RGB.dog : c, alpha * k);
    if (shape === 2) {
      addScaled(A, C, F, size * 0.55);
      ctx.pen.decal(A, ctx.yaw, 3, size * 0.55, FX_RGB.rider, alpha * k);
    }
    ctx.pen.groundArc(C, size * 0.75, c, alpha * k * 0.8);
  },

  /** 空中の光の輪が腰の高さから床へ下り、靴底で細い輪になる。 */
  descend(ctx, step, _i, t, alpha) {
    const { u, env, y } = frameOf(ctx, step, t);
    if (!ctx.pos(step.at[0], A)) return;
    contactOf(ctx, y, C);
    const rings = step.n ?? 2;
    const down = easeOut(Math.min(1, u / 0.6));
    const c = ctx.color(step, step.at[0]);
    for (let k = 0; k < rings; k++) {
      const top = A.y + k * 0.18;
      setV(S, C.x, top + (y - top) * down, C.z);
      const r = step.size * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4 * 0.45) * (1 - k * 0.15);
      ctx.pen.groundArc(S, r, c, alpha * env * (u < 0.6 ? 1 : 0.7));
    }
  },
};
