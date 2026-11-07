import {
  BODY_CARDINAL_BASE,
  BODY_DIAGONAL_BASE,
  BODY_ROT_US,
  COMPOSITE_BONUS,
  DOG_BASE,
  DOG_SPIN_US,
  LANDING_OK_DEG,
  LANDING_PERFECT_DEG,
  MAX_SLOTS,
} from './rules';
import { angleBetweenDeg, quatAxisAngle, quatIdentity, quatMul, quatRotate, roundTo, DEG, type Quat, type Vec3 } from './math';

/**
 * 空中の技。1回のジャンプで使えるのは最大2枠。
 * 犬だけの回転（円）と、人と犬の体ごとの回転（直線）を、指の軌跡から作る。
 */

export type Candidate =
  | { kind: 'dog'; strokeId: number; establishedUs: number; vertical: boolean; clockwise: boolean }
  | { kind: 'body'; strokeId: number; establishedUs: number; dir8: number; afterCircle: boolean };

/** 1本の指の記録。upUs が null なら、まだ画面に触れている。 */
export interface StrokeInfo {
  strokeId: number;
  downUs: number;
  upUs: number | null;
  cancelled: boolean;
  candidates: Candidate[];
}

export interface Rotation {
  channel: 'dog' | 'body';
  strokeId: number;
  establishedUs: number;
  startUs: number;
  durUs: number;
  base: number;
  /** 犬の回転軸（縦=前後回り / 横=横転）と向き。 */
  dogAxis?: 'pitch' | 'roll';
  dogSign?: number;
  /** 体ごとの回転: 前宙(+1)/後宙(-1)、右ひねり(+1)/左ひねり(-1)。 */
  flip: number;
  twist: number;
  name: string;
}

export interface TrickResolution {
  rotations: Rotation[];
  /** 相方の成立を待っている候補。 */
  held: Candidate[];
  /** 3枠目などで使われなかった候補。 */
  rejected: Candidate[];
  composite: boolean;
}

export const DIR8_NAMES = ['前宙', '前宙＋右ひねり', '右ひねり', '後宙＋右ひねり', '後宙', '後宙＋左ひねり', '左ひねり', '前宙＋左ひねり'];

export function bodyComponents(dir8: number): { flip: number; twist: number } {
  const flip = dir8 === 0 || dir8 === 1 || dir8 === 7 ? 1 : dir8 === 3 || dir8 === 4 || dir8 === 5 ? -1 : 0;
  const twist = dir8 === 1 || dir8 === 2 || dir8 === 3 ? 1 : dir8 === 5 || dir8 === 6 || dir8 === 7 ? -1 : 0;
  return { flip, twist };
}

export function isDiagonal(dir8: number): boolean {
  return dir8 % 2 === 1;
}

export function dogTrickName(vertical: boolean, clockwise: boolean): string {
  return vertical ? (clockwise ? '犬・縦（前回り）' : '犬・縦（後ろ回り）') : clockwise ? '犬・横（右回り）' : '犬・横（左回り）';
}

function makeRotation(c: Candidate, startUs: number): Rotation {
  if (c.kind === 'dog') {
    return {
      channel: 'dog',
      strokeId: c.strokeId,
      establishedUs: c.establishedUs,
      startUs,
      durUs: DOG_SPIN_US,
      base: DOG_BASE,
      dogAxis: c.vertical ? 'pitch' : 'roll',
      dogSign: c.clockwise ? 1 : -1,
      flip: 0,
      twist: 0,
      name: dogTrickName(c.vertical, c.clockwise),
    };
  }
  const { flip, twist } = bodyComponents(c.dir8);
  return {
    channel: 'body',
    strokeId: c.strokeId,
    establishedUs: c.establishedUs,
    startUs,
    durUs: BODY_ROT_US,
    base: isDiagonal(c.dir8) ? BODY_DIAGONAL_BASE : BODY_CARDINAL_BASE,
    flip,
    twist,
    name: DIR8_NAMES[c.dir8],
  };
}

interface TimelineEvent {
  t: number;
  order: number;
  strokeId: number;
  candidate?: Candidate;
  end?: true;
}

/**
 * 指の記録から、時刻 atUs までに始まる回転を決める。入力の到着順にはよらず、時刻の順で決まる。
 * - 2本の指が重なっている間は、先に成立した側を仮置きし、相方が成立した瞬間に両方を同時に回す。
 * - 相方が取り消された・未成立のまま離れた場合は、仮置きの単独技をその時に一度だけ始める。
 * - landingUs より後に成立した候補や、始められなかった仮置きは捨てる。
 */
export function resolveTricks(strokes: StrokeInfo[], atUs: number, landingUs: number = Infinity): TrickResolution {
  const limit = Math.min(atUs, landingUs);
  const timeline: TimelineEvent[] = [];
  for (const st of strokes) {
    st.candidates.forEach((c, i) => {
      if (c.establishedUs <= limit && c.establishedUs < landingUs) timeline.push({ t: c.establishedUs, order: 0, strokeId: st.strokeId * 64 + i, candidate: c });
    });
    if (st.upUs !== null && st.upUs <= limit) timeline.push({ t: st.upUs, order: 1, strokeId: st.strokeId * 64 + 63, end: true });
  }
  timeline.sort((a, b) => a.t - b.t || a.order - b.order || a.strokeId - b.strokeId);

  const rotations: Rotation[] = [];
  const rejected: Candidate[] = [];
  const holds: { c: Candidate; partner: number }[] = [];
  const establishedBy = new Map<number, number>(); // strokeId -> first established time
  const channelEnd = { dog: -Infinity, body: -Infinity };

  const start = (c: Candidate, t: number) => {
    if (t >= landingUs) return;
    const ch = c.kind === 'dog' ? 'dog' : 'body';
    const s = Math.max(t, channelEnd[ch]);
    const r = makeRotation(c, s);
    channelEnd[ch] = s + r.durUs;
    rotations.push(r);
  };

  for (const ev of timeline) {
    if (ev.candidate) {
      const c = ev.candidate;
      const sid = c.strokeId;
      if (!establishedBy.has(sid)) establishedBy.set(sid, c.establishedUs);
      if (rotations.length + holds.length >= MAX_SLOTS) {
        rejected.push(c);
        continue;
      }
      const waiting = holds.findIndex((h) => h.partner === sid);
      if (waiting >= 0) {
        const h = holds.splice(waiting, 1)[0];
        // 先に成立していた側から順に、同じ時刻で始める。
        start(h.c, ev.t);
        start(c, ev.t);
        continue;
      }
      const partner = strokes.find((o) => {
        if (o.strokeId === sid) return false;
        if (o.downUs > ev.t) return false;
        if (o.upUs !== null && o.upUs <= ev.t) return false;
        if (establishedBy.has(o.strokeId)) return false;
        if (holds.some((h) => h.partner === o.strokeId)) return false;
        return true;
      });
      if (partner) holds.push({ c, partner: partner.strokeId });
      else start(c, ev.t);
    } else if (ev.end) {
      const sid = Math.floor(ev.strokeId / 64);
      for (let i = holds.length - 1; i >= 0; i--) {
        if (holds[i].partner === sid) {
          const h = holds.splice(i, 1)[0];
          start(h.c, ev.t);
        }
      }
    }
  }

  let composite = false;
  for (const a of rotations) {
    if (a.channel !== 'dog') continue;
    for (const b of rotations) {
      if (b.channel !== 'body') continue;
      if (a.startUs < b.startUs + b.durUs && b.startUs < a.startUs + a.durUs) composite = true;
    }
  }
  return { rotations, held: holds.map((h) => h.c), rejected, composite };
}

/** 回転の進んだ角度（度）。累積で測るので、回し始めの 0 度を1周の終わりと見なさない。 */
export function rotationDoneDeg(r: Rotation, tUs: number): number {
  if (tUs <= r.startUs) return 0;
  const f = Math.min(1, (tUs - r.startUs) / r.durUs);
  return f * 360;
}

export function maxResidualDeg(rotations: Rotation[], tUs: number): number {
  let worst = 0;
  for (const r of rotations) worst = Math.max(worst, 360 - rotationDoneDeg(r, tUs));
  return worst;
}

/** 体の回転（宙返り＋ひねり）。座標は X=前、Y=上、Z=右。 */
export function bodyQuat(rotations: Rotation[], tUs: number): Quat {
  let q = quatIdentity();
  for (const r of rotations) {
    if (r.channel !== 'body') continue;
    const a = rotationDoneDeg(r, tUs) * DEG;
    if (a <= 0 || a >= 2 * Math.PI) continue;
    const twist = quatAxisAngle([0, 1, 0], -r.twist * a);
    const flip = quatAxisAngle([0, 0, 1], -r.flip * a);
    q = quatMul(q, quatMul(twist, flip));
  }
  return q;
}

/** 犬だけの回転（人に対する犬の回転）。 */
export function dogQuat(rotations: Rotation[], tUs: number): Quat {
  let q = quatIdentity();
  for (const r of rotations) {
    if (r.channel !== 'dog') continue;
    const a = rotationDoneDeg(r, tUs) * DEG;
    if (a <= 0 || a >= 2 * Math.PI) continue;
    const sign = r.dogSign ?? 1;
    const part = r.dogAxis === 'pitch' ? quatAxisAngle([0, 0, 1], -sign * a) : quatAxisAngle([1, 0, 0], sign * a);
    q = quatMul(q, part);
  }
  return q;
}

/** 犬の足が着地面に対して傾いている角度（度）。basePitch は空中の基本姿勢、surfacePitch は面の傾き。 */
export function footTiltDeg(rotations: Rotation[], tUs: number, basePitch: number, surfacePitch: number): number {
  const base = quatAxisAngle([0, 0, 1], basePitch);
  const q = quatMul(base, quatMul(bodyQuat(rotations, tUs), dogQuat(rotations, tUs)));
  const up = quatRotate(q, [0, 1, 0]);
  const n: Vec3 = [-Math.sin(surfacePitch), Math.cos(surfacePitch), 0];
  return angleBetweenDeg(up, n);
}

/** 着地の倍率（10倍の整数）: 12=「ぴたり」1.2倍、10=1倍、0=失敗。 */
export function landingTenths(residualDeg: number, tiltDeg: number): 12 | 10 | 0 {
  const worst = roundTo(Math.max(residualDeg, tiltDeg), 6);
  if (worst <= LANDING_PERFECT_DEG) return 12;
  if (worst <= LANDING_OK_DEG) return 10;
  return 0;
}

export interface JumpScore {
  base: number;
  composite: boolean;
  tenths: 12 | 10 | 0;
  points: number;
  names: string[];
  residualDeg: number;
  tiltDeg: number;
}

/** ジャンプの技の小計を計算する。複合の 100 点は1回だけ足し、着地の倍率を掛ける。 */
export function scoreJump(res: TrickResolution, tUs: number, basePitch: number, surfacePitch: number): JumpScore {
  const residualDeg = maxResidualDeg(res.rotations, tUs);
  const tiltDeg = footTiltDeg(res.rotations, tUs, basePitch, surfacePitch);
  const tenths = landingTenths(residualDeg, tiltDeg);
  const base = res.rotations.reduce((a, r) => a + r.base, 0);
  const sum = base + (res.composite ? COMPOSITE_BONUS : 0);
  const points = Math.round((sum * tenths) / 10);
  // 技名は描き方（片手・2本指、認識の順）によらず、犬の回転 → 体の回転の順にそろえる。
  const names = [...res.rotations]
    .sort((a, b) => (a.channel === b.channel ? a.startUs - b.startUs : a.channel === 'dog' ? -1 : 1))
    .map((r) => r.name);
  return { base, composite: res.composite, tenths, points, names, residualDeg, tiltDeg };
}

export function trickLabel(names: string[], composite: boolean): string {
  if (names.length === 0) return '';
  return composite ? `複合 ${names.join('＋')}` : names.join('・');
}
