import { describe, expect, test } from 'vitest';
import { GestureRecognizer, classifyStroke, dir8FromAngle, dir8FromVector, lineSamples, type Sample } from '../src/input/gestures';
import { advanceRun } from '../src/game/run';
import { newRun, runTo, testCourse, jumpFacts } from './helpers';
import type { GestureFact } from '../src/game/types';

/** 画面の短辺を 1 とした座標で、時刻 tClose にちょうど閉じる楕円（7/8 周まで描き、最後に始点へ戻る）。 */
export function circleClosingAt(cx: number, cy: number, rx: number, ry: number, t0: number, tClose: number, clockwise = true): Sample[] {
  const pts: Sample[] = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const f = (i / 32) * 1;
    const ang = Math.PI / 2 + (clockwise ? 1 : -1) * f * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang), tUs: Math.round(t0 + ((tClose - t0) * i) / (n + 1)) });
  }
  pts.push({ x: cx + rx * Math.cos(Math.PI / 2), y: cy + ry * Math.sin(Math.PI / 2), tUs: tClose });
  return pts;
}

function facts(samples: Sample[], strokeId = 1): GestureFact[] {
  return classifyStroke(samples, {}, strokeId);
}

describe('V05 地上と空中の区別、形の判定', () => {
  test('前払いを離さずに曲げても、ジャンプは1回で、踏み切った指から技は出ない', () => {
    const course = testCourse();
    const run = newRun(course);
    runTo(run, 2_000_000);
    const rec = new GestureRecognizer();
    rec.setViewport(400, 700);
    const out: GestureFact[] = [];
    const t0 = run.simUs;
    out.push(...rec.pointerDown(1, 200, 600, t0));
    // 上へ払い（ここで跳ぶ）、そのまま離さずに円を描く。
    for (let i = 1; i <= 6; i++) out.push(...rec.pointerMove(1, 200, 600 - i * 10, t0 + i * 10_000));
    const circle = circleClosingAt(200 / 400, 540 / 400, 0.15, 0.15, t0 + 70_000, t0 + 300_000);
    for (const p of circle) out.push(...rec.pointerMove(1, p.x * 400, p.y * 400, p.tUs));
    out.push(...rec.pointerUp(1, 200, 540 + 60, t0 + 320_000));
    expect(out.filter((f) => f.kind === 'forward').length).toBe(1);
    expect(out.some((f) => f.kind === 'circle')).toBe(true);
    let t = run.simUs;
    advanceRun(run, (t += 5_000), out);
    while (t < 3_500_000) advanceRun(run, (t += 5_000));
    expect(run.events.filter((e) => e.kind === 'jump').length).toBe(1);
    expect(run.events.filter((e) => e.kind === 'trickStart').length).toBe(0);
  });

  test('空中の新しい指: 閉じない円・短い点は未成立、縦横比 1.249 は横転、1.250 は縦回り', () => {
    // 閉じない曲線（半周）
    const open: Sample[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI / 2 + (i / 16) * Math.PI;
      open.push({ x: 0.5 + 0.12 * Math.cos(a), y: 0.5 + 0.12 * Math.sin(a), tUs: i * 10_000 });
    }
    const fo = facts(open);
    expect(fo.some((f) => f.kind === 'circle' || f.kind === 'line')).toBe(false);
    expect(fo.find((f) => f.kind === 'reject')).toMatchObject({ reason: 'open' });
    // 短い点
    const dot = facts([
      { x: 0.5, y: 0.5, tUs: 0 },
      { x: 0.505, y: 0.502, tUs: 20_000 },
      { x: 0.506, y: 0.503, tUs: 40_000 },
    ]);
    expect(dot.find((f) => f.kind === 'reject')).toMatchObject({ reason: 'short' });
    // 縦横比の境界
    const c1249 = facts(circleClosingAt(0.5, 0.5, 0.1, 0.1249, 0, 300_000));
    const c1250 = facts(circleClosingAt(0.5, 0.5, 0.1, 0.125, 0, 300_000));
    expect(c1249.find((f) => f.kind === 'circle')).toMatchObject({ vertical: false });
    expect(c1250.find((f) => f.kind === 'circle')).toMatchObject({ vertical: true });
    // 真円は横転
    expect(facts(circleClosingAt(0.5, 0.5, 0.1, 0.1, 0, 300_000)).find((f) => f.kind === 'circle')).toMatchObject({ vertical: false });
  });

  test('円は閉じた時刻で切り出し、描きかけの円の一部を直線として先取りしない', () => {
    const c = circleClosingAt(0.5, 0.5, 0.1, 0.1, 0, 180_000);
    // 描いている途中（指を離す前）は、円の一部を線として扱わない。
    const r = new GestureRecognizer();
    r.setViewport(1, 1);
    const during: GestureFact[] = [...r.pointerDown(1, c[0].x, c[0].y, 0)];
    for (const p of c.slice(1, -1)) during.push(...r.pointerMove(1, p.x, p.y, p.tUs));
    expect(during.some((f) => f.kind === 'line' || f.kind === 'circle')).toBe(false);
    const full = facts(c);
    const circ = full.find((f) => f.kind === 'circle')!;
    expect(circ.atUs).toBe(180_000);
  });

  test('判定の距離は画面の短辺に対する比率で決まり、描画解像度によらない', () => {
    const run = (w: number, h: number) => {
      const r = new GestureRecognizer();
      r.setViewport(w, h);
      const unit = Math.min(w, h);
      const out: GestureFact[] = [];
      out.push(...r.pointerDown(1, 0.5 * unit, 0.8 * unit, 0));
      out.push(...r.pointerMove(1, 0.5 * unit, 0.74 * unit, 10_000));
      out.push(...r.pointerMove(1, 0.5 * unit, 0.72 * unit, 20_000));
      return out.filter((f) => f.kind === 'forward').length;
    };
    expect(run(402, 700)).toBe(1);
    expect(run(804, 1400)).toBe(1);
    expect(run(700, 402)).toBe(1);
  });

  test('地上の下払いには操作を割り当てない（横の目標も前進も変えない）', () => {
    const course = testCourse();
    const a = newRun(course);
    const b = newRun(course);
    runTo(a, 2_000_000);
    runTo(b, 2_000_000);
    const rec = new GestureRecognizer();
    rec.setViewport(400, 700);
    const f: GestureFact[] = [...rec.pointerDown(1, 200, 300, 2_000_000)];
    for (let i = 1; i <= 8; i++) f.push(...rec.pointerMove(1, 200 + (i % 2), 300 + i * 25, 2_000_000 + i * 10_000));
    f.push(...rec.pointerUp(1, 200, 500, 2_100_000));
    runTo(a, 4_000_000, f);
    runTo(b, 4_000_000);
    expect(a.s).toBe(b.s);
    expect(a.targetX).toBe(b.targetX);
    expect(a.score.jumpPoints).toBe(b.score.jumpPoints);
  });

  test('横払い: 長く払うほど遠い目標へ移り、同じ幅なら犬種によらず同じ位置を狙う', () => {
    const course = testCourse();
    const finalX = (dog: 'shiba' | 'corgi' | 'whippet', px: number) => {
      const run = newRun(course, dog);
      runTo(run, 2_000_000);
      const rec = new GestureRecognizer();
      rec.setViewport(400, 700);
      const f: GestureFact[] = [...rec.pointerDown(1, 100, 400, 2_000_000)];
      for (let i = 1; i <= 10; i++) f.push(...rec.pointerMove(1, 100 + (px * i) / 10, 400, 2_000_000 + i * 8_000));
      f.push(...rec.pointerUp(1, 100 + px, 400, 2_090_000));
      runTo(run, 2_000_000 + 5_000);
      advanceRun(run, 2_100_000, f);
      let reachUs = 0;
      let t = run.simUs;
      while (t < 5_000_000) {
        advanceRun(run, (t += 5_000));
        if (!reachUs && Math.abs(run.x - run.targetX) < 1e-9) reachUs = t;
      }
      return { x: run.x, reachUs };
    };
    const short = finalX('shiba', 60);
    const long = finalX('shiba', 120);
    expect(long.x).toBeGreaterThan(short.x);
    const corgi = finalX('corgi', 120);
    const whippet = finalX('whippet', 120);
    expect(corgi.x).toBeCloseTo(long.x, 9);
    expect(whippet.x).toBeCloseTo(long.x, 9);
    expect(corgi.reachUs).toBeLessThan(long.reachUs);
    expect(long.reachUs).toBeLessThan(whippet.reachUs);
  });

  test('踏み切りの指の残りの動きは次の技に入らない（地上で始めた指の線は技にならない）', () => {
    const course = testCourse();
    const run = newRun(course);
    runTo(run, 2_000_000);
    const t = run.simUs;
    const f: GestureFact[] = [
      { kind: 'down', atUs: t, strokeId: 77 },
      { kind: 'forward', atUs: t + 20_000, strokeId: 77 },
      { kind: 'line', atUs: t + 200_000, strokeId: 77, dir8: 0, afterCircle: false },
      { kind: 'up', atUs: t + 200_000, strokeId: 77, cancelled: false },
    ];
    runTo(run, 3_500_000, f);
    expect(run.events.filter((e) => e.kind === 'jump').length).toBe(1);
    expect(run.events.filter((e) => e.kind === 'trickStart').length).toBe(0);
    void jumpFacts;
  });
});

describe('V06 方向と回転の向き（指の判定）', () => {
  test('画面の上を 0 度とした時計回りで、各方向は中心－22.5 度を含み中心＋22.5 度を含まない', () => {
    for (let k = 0; k < 8; k++) {
      const center = k * 45;
      expect(dir8FromAngle(center)).toBe(k);
      expect(dir8FromAngle(center - 22.5)).toBe(k);
      expect(dir8FromAngle(center + 22.49)).toBe(k);
      expect(dir8FromAngle(center + 22.5)).toBe((k + 1) % 8);
    }
    expect(dir8FromAngle(22.49)).toBe(0);
    expect(dir8FromAngle(22.5)).toBe(1);
    // 線の軌跡からも同じ境界になる。
    const lineDir = (deg: number) => facts(lineSamples(0.5, 0.5, deg, 0.2, 0, 100_000)).find((f) => f.kind === 'line');
    expect(lineDir(22.49)).toMatchObject({ dir8: 0 });
    expect(lineDir(22.5)).toMatchObject({ dir8: 1 });
    expect(lineDir(180)).toMatchObject({ dir8: 4 });
    expect(lineDir(270)).toMatchObject({ dir8: 6 });
    expect(dir8FromVector(1, 0)).toBe(2);
    expect(dir8FromVector(0, 1)).toBe(4);
  });

  test('同じ形の円を時計回り・反時計回りに描くと、同じ軸で向きだけが逆になる', () => {
    const cw = facts(circleClosingAt(0.5, 0.5, 0.1, 0.1, 0, 300_000, true)).find((f) => f.kind === 'circle')!;
    const ccw = facts(circleClosingAt(0.5, 0.5, 0.1, 0.1, 0, 300_000, false)).find((f) => f.kind === 'circle')!;
    expect(cw).toMatchObject({ clockwise: true, vertical: false });
    expect(ccw).toMatchObject({ clockwise: false, vertical: false });
  });

  test('1本で閉じた円に線が続く場合、線の始点は円の終点（片手の円→線）', () => {
    const c = circleClosingAt(0.5, 0.5, 0.1, 0.1, 0, 200_000);
    const end = c[c.length - 1];
    const line = lineSamples(end.x, end.y, 90, 0.2, 210_000, 80_000).slice(1);
    const f = facts([...c, ...line]);
    expect(f.find((x) => x.kind === 'circle')).toBeTruthy();
    expect(f.find((x) => x.kind === 'line')).toMatchObject({ dir8: 2, afterCircle: true });
  });

  test('取り消しの通知では、その指の未確定部分（離すと決まる線）を消す', () => {
    const r = new GestureRecognizer();
    r.setViewport(1, 1);
    const out: GestureFact[] = [];
    const pts = lineSamples(0.5, 0.5, 0, 0.2, 0, 100_000);
    out.push(...r.pointerDown(1, pts[0].x, pts[0].y, 0));
    for (const p of pts.slice(1)) out.push(...r.pointerMove(1, p.x, p.y, p.tUs));
    out.push(...r.pointerCancel(1, 110_000));
    expect(out.some((f) => f.kind === 'line')).toBe(false);
    expect(out[out.length - 1]).toMatchObject({ kind: 'up', cancelled: true });
  });
});
