import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DOG_EFFECT_COLORS, type DogEffectColors } from '../src/content/dog-effects';
import { advanceRun } from '../src/game/run';
import { advanceFreeMotion, createFreeMotion, FREE_RULES_VERSION, type FreeMotionInput, type FreeTarget } from '../src/game/free-motion';
import { scoreFreeMotion } from '../src/game/free-score';
import type { Vec3 } from '../src/game/math';
import type { GestureFact } from '../src/game/types';
import {
  FX_A_THRESHOLDS, FX_FL_THRESHOLDS, chooseAirFx, chooseLandingFx, emphasisLevel, landingLevel, landingSoundName, trailLevel,
  visualDifficultyPoints,
} from '../src/view/trick-fx';
import { FX_LEVEL_COUNT, TRICK_FX_81, fxProgram, type FxId, type FxProgram } from '../src/view/trick-fx-81';
import { FxEngine, type FxBodySource, type FxFrameFlags } from '../src/view/trick-fx-engine';
import { AIR_DRAWERS } from '../src/view/trick-fx-ops-air';
import { LAND_DRAWERS } from '../src/view/trick-fx-ops-land';
import { FxTimeline, FX_AIR_TICK_US, type FxFlightView, type FxVisualEvent } from '../src/view/trick-fx-timeline';
import { trickLandingText } from '../src/view/trick-landing';
import { ReplayRecorder, replayPoseAt } from '../src/view/replay';
import { SoundScheduler, synthNames } from '../src/audio/sound';
import { cueForEvent } from '../src/view/effects';
import { DEFAULT_SETTINGS } from '../src/storage/records';
import { jumpFacts, newRun, testCourse } from './helpers';

const spec = readFileSync(new URL('../docs/2026-11-20-81-trick-visual-spec.md', import.meta.url), 'utf8');
const specRows = [...spec.matchAll(/^\| ([BHD]-[FAL]\d{2}) \| (\d+) \| ([^|]+?) \|/gm)].map(m => ({ id: m[1], level: Number(m[2]), name: m[3].trim() }));

// ---------------------------------------------------------------- 検査用の身体と描画の受け口

const LOCAL: Record<string, [number, number, number]> = {
  dogNose: [0.6, 0.6, 0], dogEarL: [0.45, 0.8, -0.1], dogEarR: [0.45, 0.8, 0.1], dogTail: [-0.55, 0.6, 0],
  dogPawFL: [0.35, 0.05, -0.14], dogPawFR: [0.35, 0.05, 0.14], dogPawBL: [-0.35, 0.05, -0.14], dogPawBR: [-0.35, 0.05, 0.14],
  dogBack: [0, 0.65, 0], dogBelly: [0, 0.4, 0], riderHead: [0, 1.9, 0], riderHelmet: [0, 2.0, 0],
  riderShoulderL: [0, 1.6, -0.2], riderShoulderR: [0, 1.6, 0.2], riderHandL: [0.1, 1.2, -0.3], riderHandR: [0.1, 1.2, 0.3],
  riderWaist: [0, 1.2, 0], riderShoeL: [0, 0.75, -0.1], riderShoeR: [0, 0.75, 0.1], pivot: [0, 0.75, 0],
};

/** 犬と人がそれぞれ別の角度で回る、検査用の身体。 */
function spinningBody(spin: { dog: number; rider: number }) {
  const angle = { dog: 0, rider: 0 };
  const src: FxBodySource = {
    anchor(key, out) {
      const [x, y, z] = LOCAL[key];
      const a = key.startsWith('dog') ? angle.dog : key.startsWith('rider') ? angle.rider : 0;
      const c = Math.cos(a), s = Math.sin(a);
      out.x = x * c - (y - 0.75) * s; out.y = x * s + (y - 0.75) * c + 2; out.z = z;
      return true;
    },
    quat(body, q) {
      const a = angle[body];
      q.x = 0; q.y = 0; q.z = Math.sin(a / 2); q.w = Math.cos(a / 2);
      return true;
    },
  };
  return { src, step: () => { angle.dog += spin.dog; angle.rider += spin.rider; } };
}

interface Cmd { kind: 'line' | 'dot' | 'decal' | 'burst'; v: number[] }
function recorder() {
  const cmds: Cmd[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    cmds,
    sink: {
      line: (...v: number[]) => cmds.push({ kind: 'line', v: v.map(r) }),
      dot: (...v: number[]) => cmds.push({ kind: 'dot', v: v.map(r) }),
      decal: (...v: number[]) => cmds.push({ kind: 'decal', v: v.map(r) }),
      burst: (...v: number[]) => cmds.push({ kind: 'burst', v: v.map(r) }),
    },
  };
}
const FLAGS: FxFrameFlags = { reduced: false, weak: false, paused: false, alpha: 1, heading: 0, groundY: 0 };

/** 1件の演出を実際に動かし、描いた命令を集める。着地は直前に空中の軌跡を出しておく。 */
function render(prog: FxProgram, flags: Partial<FxFrameFlags> = {}, spin = { dog: 0.15, rider: 0.15 }, frames = 30, colors?: DogEffectColors): Cmd[] {
  const engine = new FxEngine();
  if (colors) engine.setColors(colors);
  const body = spinningBody(spin);
  const warm = recorder();
  const f = { ...FLAGS, ...flags };
  const ev = (kind: FxVisualEvent['kind'], id: FxId | null, level = 1): FxVisualEvent => ({ tUs: 0, jumpId: 1, kind, target: prog.target, level, id });
  if (prog.kind === 'L') {
    engine.apply(ev('A', `${prog.target}-A07` as FxId, 7));
    for (let i = 0; i < 20; i++) { body.step(); engine.frame(16, body.src, warm.sink, f); }
    engine.apply(ev('L', prog.id, prog.level), { contact: { x: 1, y: 0, z: 0 }, yaw: 0, switchCount: 1 });
  } else {
    for (let i = 0; i < 5; i++) { body.step(); engine.frame(16, body.src, warm.sink, f); }
    engine.apply(ev(prog.kind, prog.id, prog.level));
    engine.apply(ev('C', null));
  }
  const out = recorder();
  for (let i = 0; i < frames; i++) { body.step(); engine.frame(16, body.src, out.sink, f); }
  return out.cmds;
}

test('81種類すべてで犬種の色だけが変わり、描く位置・形・透明度・粒の数は同じ', () => {
  const colorIndex: Record<Cmd['kind'], number> = { line: 6, dot: 4, decal: 6, burst: 4 };
  for (const prog of TRICK_FX_81) {
    const [shiba, corgi, whippet] = Object.values(DOG_EFFECT_COLORS).map(colors =>
      render(prog, {}, { dog: 0.15, rider: 0.15 }, 36, colors));
    expect(shiba.length, prog.id).toBeGreaterThan(0);
    const geometry = (commands: Cmd[]) => commands.map(({ kind, v }) => {
      const first = colorIndex[kind];
      return [kind, ...v.slice(0, first), ...v.slice(first + 3)];
    });
    const sameGeometry = (commands: Cmd[]) => JSON.stringify(geometry(commands)) === JSON.stringify(geometry(shiba));
    expect(sameGeometry(corgi) && sameGeometry(whippet), prog.id).toBe(true);
    const palette = (commands: Cmd[]) => new Set(commands.map(({ kind, v }) =>
      v.slice(colorIndex[kind], colorIndex[kind] + 3).join(',')));
    const shibaColors = palette(shiba), corgiColors = palette(corgi), whippetColors = palette(whippet);
    expect([...shibaColors].every(color => !corgiColors.has(color) && !whippetColors.has(color)), prog.id).toBe(true);
    expect([...corgiColors].every(color => !whippetColors.has(color)), prog.id).toBe(true);
  }
});

// ---------------------------------------------------------------- 81件の定義

describe('81種類の定義', () => {
  test('B/H/D × 派手さF10・軌跡A7・着地L10 の81件。IDと名前が正本と一致し、重複・欠番がない', () => {
    expect(specRows).toHaveLength(81);
    expect(TRICK_FX_81).toHaveLength(81);
    expect(new Set(TRICK_FX_81.map(p => p.id)).size).toBe(81);
    expect(TRICK_FX_81.map(p => [p.id, p.level, p.name])).toEqual(specRows.map(r => [r.id, r.level, r.name]));
    for (const target of ['B', 'H', 'D'] as const) {
      for (const kind of ['F', 'A', 'L'] as const) {
        expect(TRICK_FX_81.filter(p => p.target === target && p.kind === kind).map(p => p.level))
          .toEqual(Array.from({ length: FX_LEVEL_COUNT[kind] }, (_, i) => i + 1));
      }
    }
  });

  test('全件に起点・手順・時間があり、手順の部品にはすべて描き方がある', () => {
    const drawers = { ...AIR_DRAWERS, ...LAND_DRAWERS };
    for (const p of TRICK_FX_81) {
      expect(p.anchors.length, p.id).toBeGreaterThan(0);
      expect(p.recipe.length, p.id).toBeGreaterThan(0);
      expect(p.opacityMax, p.id).toBeLessThanOrEqual(0.92);
      if (p.kind === 'L') expect(p.lifetimeMs, p.id).toBeGreaterThan(0);
      if (p.kind === 'L') expect(p.lifetimeMs, p.id).toBeLessThanOrEqual(2000);
      if (p.kind === 'L') expect(p.anchors, p.id).toContain('contact');
      for (const step of p.recipe) {
        expect(drawers[step.op], `${p.id} ${step.op}`).toBeTypeOf('function');
        expect(step.at.length, `${p.id} ${step.op}`).toBeGreaterThan(0);
      }
    }
  });

  test('同じ対象・同じ種類の段階どうしは、部品と起点の組み合わせが違う（色違いだけの重複がない）', () => {
    const shape = (p: FxProgram) => p.recipe.map(s => `${s.op}@${s.at.join('+')}`).sort().join('|');
    for (const target of ['B', 'H', 'D'] as const) {
      for (const kind of ['F', 'A', 'L'] as const) {
        const group = TRICK_FX_81.filter(p => p.target === target && p.kind === kind);
        expect(new Set(group.map(shape)).size, `${target}-${kind}`).toBe(group.length);
      }
    }
    const full = (p: FxProgram) => JSON.stringify(p.recipe.map(({ color: _c, ...rest }) => rest));
    expect(new Set(TRICK_FX_81.map(full)).size).toBe(81);
  });

  test('実際に動かすと81件すべてが描かれ、描いた命令の並びも81件で別々', () => {
    const signatures = new Map<string, string>();
    for (const p of TRICK_FX_81) {
      const cmds = render(p);
      expect(cmds.length, p.id).toBeGreaterThan(0);
      const sig = JSON.stringify(cmds.slice(-400));
      expect(signatures.has(sig), `${p.id} と ${signatures.get(sig)} が同じ絵`).toBe(false);
      signatures.set(sig, p.id);
    }
  });

  test('犬だけ・人だけの演出は、もう一方の身体の色の線を引かない', () => {
    const orange = (c: Cmd) => c.kind !== 'burst' && c.v[c.v.length - 4] === 1 && c.v[c.v.length - 3] === 0.58;
    const blue = (c: Cmd) => c.kind !== 'burst' && c.v[c.v.length - 4] === 0.3 && c.v[c.v.length - 3] === 0.62;
    for (const p of TRICK_FX_81.filter(p => p.kind !== 'L')) {
      const cmds = render(p);
      if (p.target === 'H') expect(cmds.some(orange), p.id).toBe(false);
      if (p.target === 'D') expect(cmds.some(blue), p.id).toBe(false);
    }
  });

  test('走って前へ進んでも、空中の軌跡は身体のまわりに残り、走った道すじの長い線にならない', () => {
    const engine = new FxEngine();
    const body = spinningBody({ dog: 0.2, rider: 0.2 });
    let forward = 0;
    const moving: FxBodySource = {
      anchor(key, out) { const ok = body.src.anchor(key, out); out.x += forward; return ok; },
      quat: body.src.quat,
    };
    engine.apply({ tUs: 0, jumpId: 1, kind: 'A', target: 'B', level: 7, id: 'B-A07' });
    const rec = recorder();
    for (let i = 0; i < 40; i++) {
      body.step();
      forward += 0.16; // 1フレームで約16cm（秒速10m）
      rec.cmds.length = 0;
      engine.frame(16, moving, rec.sink, FLAGS);
    }
    const xs = rec.cmds.filter(c => c.kind === 'line').flatMap(c => [c.v[0], c.v[3]]);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs.map(x => Math.abs(x - forward)))).toBeLessThan(1.5);
  });

  test('両方の軌跡でも、回っていない身体には新しい線を引かない', () => {
    const blue = (c: Cmd) => c.kind === 'line' && c.v[6] === 0.3 && c.v[7] === 0.62;
    const prog = fxProgram('B-A01');
    expect(render(prog, {}, { dog: 0.15, rider: 0.15 }).some(blue)).toBe(true);
    expect(render(prog, {}, { dog: 0.15, rider: 0 }).some(blue)).toBe(false);
  });
});

// ---------------------------------------------------------------- 段階と難度

describe('段階の選び方', () => {
  test.each([
    ...FX_FL_THRESHOLDS.flatMap((min, i) => [[min - 1, i], [min, i + 1], [min + 1, i + 1]] as const),
  ])('派手さ・着地：%d点は段階%d', (points, level) => {
    expect(emphasisLevel(points)).toBe(level);
    expect(landingLevel(points)).toBe(level);
  });

  test.each(FX_A_THRESHOLDS.flatMap((min, i) => [[min - 1, i], [min, i + 1], [min + 1, i + 1]] as const))('軌跡：%d点は段階%d', (points, level) => {
    expect(trailLevel(points)).toBe(level);
  });

  test('0点・NaN・負の値は段階なし、2050点以上でも最高段階で止まる', () => {
    for (const bad of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(emphasisLevel(bad)).toBe(0);
      expect(trailLevel(bad)).toBe(0);
    }
    expect(emphasisLevel(2050)).toBe(10);
    expect(trailLevel(99_999)).toBe(7);
    expect(visualDifficultyPoints(Number.NaN, 5000)).toBe(2050);
    expect(visualDifficultyPoints(-3, -3)).toBe(0);
  });

  test('見た目の難度：犬だけ・人だけでも基礎点満点なら最高段階、連携の高い実得点も届く', () => {
    expect(visualDifficultyPoints(1000, 1000)).toBe(1650);
    for (const target of ['B', 'H', 'D'] as const) {
      expect(chooseLandingFx(target, 1000, 1000)!.landing.id).toBe(`${target}-L10`);
      expect(chooseLandingFx(target, 999, 999)!.landing.level).toBe(9);
      expect(chooseLandingFx(target, 400, 1650)!.landing.level).toBe(10);
    }
  });

  test('B/H/D それぞれ、着地L01〜L10 のすべてに届く基礎点がある', () => {
    for (const target of ['B', 'H', 'D'] as const) {
      const reached = new Set<number>();
      for (let base = 1; base <= 1000; base++) reached.add(chooseLandingFx(target, base, base)!.landing.level);
      expect([...reached].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  test('技が成立していない着地（0点・対象なし）は着地Lを出さない', () => {
    expect(chooseLandingFx('B', 0, 0)).toBeNull();
    expect(chooseLandingFx(null, 1000, 1000)).toBeNull();
  });

  test('空中：踏切直後はF01、軌跡は実際に回り始めてから', () => {
    expect(chooseAirFx('D', 0, false)).toEqual({ emphasis: 'D-F01', trail: null });
    expect(chooseAirFx('H', 700, true)).toEqual({ emphasis: 'H-F07', trail: 'H-A04' });
  });
});

describe('着地の文字', () => {
  test('切替ボーナスを別の行に、回転満点は基礎点1000のときだけ', () => {
    const combo = trickLandingText('連続技', 1200, 1200, false, { basePoints: 650, switchBonus: 550, switchCount: 2, fxTarget: 'B' });
    expect(combo).toMatchObject({ name: '連続技', score: '＋1,200', full: false, switchBonus: 550, switchCount: 2, fxTarget: 'B', landingId: 'B-L08' });
    const full = trickLandingText('技', 1500, 1500, false, { basePoints: 1000, switchBonus: 500, switchCount: 1, fxTarget: 'D' });
    expect(full).toMatchObject({ full: true, landingId: 'D-L10', durationMs: 2000 });
  });

  test('区間採点済みでも演出の段階は技の難しさで決め、点は「区間採点済み」と出す', () => {
    const used = trickLandingText('技', 0, 1000, true, { basePoints: 1000, fxTarget: 'H' });
    expect(used).toMatchObject({ score: '区間採点済み', landingId: 'H-L10', landingLevel: 10 });
  });

  test('実回転の対象が無い古い記録は、81種類の表示を付けない', () => {
    expect(trickLandingText('技', 500, 500, false, { basePoints: 500 })).toMatchObject({ fxTarget: null, landingId: null, durationMs: null });
  });
});

// ---------------------------------------------------------------- 時間割（空中・切替・着地）

function spinFlight(inputs: FreeMotionInput[], untilUs: number, airUs = 900_000): FxFlightView {
  const motion = createFreeMotion();
  advanceFreeMotion(motion, untilUs, inputs, undefined, true);
  return { jumpId: 1, takeoffUs: 0, predictedAirUs: airUs, heading: 0, motionTimeUs: motion.timeUs, history: motion.history, inputs: motion.seen.values() };
}
const input = (seq: number, atUs: number, target: FreeTarget, rotation: Vec3): FreeMotionInput => ({ seq, atUs, target, rotation });

describe('演出の時間割', () => {
  test('踏切直後に強く回しても、序盤に最高段階へ跳ねない（途中の満点扱いを使わない）', () => {
    const inputs = [input(1, 1_000, 'common', [0, 0, 2])];
    const motion = createFreeMotion();
    advanceFreeMotion(motion, 100_000, inputs, undefined, true);
    // 比べるため：経過時間を分母にした途中の採点は、序盤から高い点になる。
    expect(scoreFreeMotion(motion.history, 100_000, 0, inputs).basePoints).toBeGreaterThan(200);
    const timeline = new FxTimeline();
    const events = timeline.observe(100_000, spinFlight(inputs, 100_000), 'common');
    const top = Math.max(...events.filter(e => e.kind === 'F').map(e => e.level));
    expect(top).toBeLessThan(5);
  });

  test('長く回し続けると、同じジャンプの中で段階が上がり、下がらない', () => {
    // 100msごとに払い続け、最高の速さで回し続ける。
    const inputs = Array.from({ length: 9 }, (_, i) => input(i + 1, 1_000 + i * 100_000, 'dog', [0, 0, 4]));
    const timeline = new FxTimeline();
    const events: FxVisualEvent[] = [];
    for (let t = 0; t <= 900_000; t += 30_000) events.push(...timeline.observe(t, spinFlight(inputs.filter(i => i.atUs <= t), t), 'common'));
    const levels = events.filter(e => e.kind === 'F').map(e => e.level);
    expect(levels[0]).toBe(1);
    expect(levels.at(-1)).toBeGreaterThanOrEqual(7);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(events.every(e => e.target === (e.kind === 'F' && e.tUs === 0 ? 'B' : 'D'))).toBe(true);
  });

  test('描画の間隔が違っても、同じ入力なら同じ演出の出来事になる（30/60/120fps）', () => {
    const inputs = [input(1, 5_000, 'rider', [0.3, 0, 1]), input(2, 300_000, 'dog', [0, 0, 1.5])];
    const run = (stepUs: number) => {
      const timeline = new FxTimeline();
      const out: FxVisualEvent[] = [];
      for (let t = 0; t <= 800_000; t += stepUs) out.push(...timeline.observe(t, spinFlight(inputs.filter(i => i.atUs <= t), t), 'common'));
      out.push(...timeline.observe(800_000, spinFlight(inputs, 800_000), 'common'));
      return out.sort((a, b) => a.tUs - b.tUs || a.kind.localeCompare(b.kind));
    };
    const a = run(33_333), b = run(16_667), c = run(8_333);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.every(e => e.kind === 'C' || e.tUs === 0 || e.tUs % FX_AIR_TICK_US === 0 || inputs.some(i => i.atUs === e.tUs))).toBe(true);
  });

  test('対象の切替は次に受理した回転から。人→犬の順に、軌跡の対象も移る', () => {
    const inputs = [input(1, 10_000, 'rider', [0, 0, 1]), input(2, 200_000, 'dog', [0, 0, 1])];
    const timeline = new FxTimeline();
    const events = timeline.observe(300_000, spinFlight(inputs, 300_000), 'common');
    const trails = events.filter(e => e.kind === 'A');
    expect(trails[0]).toMatchObject({ tUs: 10_000, target: 'H', id: 'H-A01' });
    expect(trails.find(e => e.tUs === 200_000)).toMatchObject({ target: 'D' });
    expect(events.find(e => e.kind === 'F' && e.tUs === 200_000)).toMatchObject({ target: 'D' });
  });

  test('連携の印は、実際に回した切替が成立したときだけ。素早い切替の連打では出ない', () => {
    const tapping = Array.from({ length: 10 }, (_, i) => input(i + 1, 10_000 + i * 8_000, i % 2 ? 'dog' : 'rider', [0, 0, 0.002]));
    const timeline = new FxTimeline();
    expect(timeline.observe(500_000, spinFlight(tapping, 500_000), 'common').some(e => e.kind === 'C')).toBe(false);
    const real = [input(1, 10_000, 'rider', [0, 0, 1]), input(2, 250_000, 'dog', [0, 0, 1])];
    const t2 = new FxTimeline();
    expect(t2.observe(600_000, spinFlight(real, 600_000), 'common').filter(e => e.kind === 'C')).toHaveLength(1);
  });

  test('同じジャンプの着地は1回だけ。技が成立しない着地は普通の着地（X）', () => {
    const timeline = new FxTimeline();
    const first = timeline.land(500_000, 3, { fxTarget: 'D', trickBase: 1000, trickPoints: 1000 });
    expect(first).toMatchObject([{ kind: 'L', id: 'D-L10' }]);
    expect(timeline.land(500_000, 3, { fxTarget: 'D', trickBase: 1000, trickPoints: 1000 })).toEqual([]);
    expect(timeline.land(900_000, 4, {})).toMatchObject([{ kind: 'X', id: null }]);
  });
});

// ---------------------------------------------------------------- 描画の時計

describe('描画の時計と設定', () => {
  test('停止中は時計を進めず、粒を新しく出さない。再開しても止まっていた分をまとめて出さない', () => {
    const engine = new FxEngine();
    const body = spinningBody({ dog: 0.1, rider: 0.1 });
    engine.apply({ tUs: 0, jumpId: 1, kind: 'L', target: 'B', level: 10, id: 'B-L10' }, { contact: { x: 0, y: 0, z: 0 } });
    const rec = recorder();
    engine.frame(16, body.src, rec.sink, { ...FLAGS, paused: true });
    const clock = engine.clockMs;
    for (let i = 0; i < 50; i++) engine.frame(16, body.src, rec.sink, { ...FLAGS, paused: true });
    expect(engine.clockMs).toBe(clock);
    engine.frame(60_000, body.src, rec.sink, FLAGS);
    expect(engine.clockMs - clock).toBeLessThanOrEqual(100);
    expect(rec.cmds.filter(c => c.kind === 'burst').length).toBeLessThanOrEqual(2);
  });

  test('動きを減らす設定では粒を出さず、残像も描かない。形は短い静止形で残す', () => {
    for (const id of ['B-L04', 'B-L10', 'H-F07', 'D-F08'] as FxId[]) {
      const cmds = render(fxProgram(id), { reduced: true });
      expect(cmds.some(c => c.kind === 'burst'), id).toBe(false);
      if (id.includes('L')) expect(cmds.length, id).toBeGreaterThan(0);
    }
    expect(render(fxProgram('B-L10'), { weak: true }).length).toBeGreaterThan(0);
  });

  test('段階が上がるか着地すると前の演出は消え、同時に出るのはF・A・Lが1件ずつ', () => {
    const engine = new FxEngine();
    const body = spinningBody({ dog: 0.1, rider: 0.1 });
    const rec = recorder();
    const apply = (kind: FxVisualEvent['kind'], id: FxId | null) => engine.apply({ tUs: 0, jumpId: 1, kind, target: 'B', level: 1, id });
    apply('F', 'B-F01'); apply('A', 'B-A01'); apply('F', 'B-F05'); apply('A', 'B-A04');
    expect(engine.activeIds().sort()).toEqual(['B-A04', 'B-F05']);
    apply('L', 'B-L03');
    expect(engine.activeIds()).toEqual(['B-L03']);
    for (let i = 0; i < 200; i++) engine.frame(16, body.src, rec.sink, FLAGS);
    expect(engine.instanceCount).toBe(0);
  });
});

// ---------------------------------------------------------------- 音

describe('着地音（B/H/D × 10段階）', () => {
  test('30種類すべてに合成の定義があり、効果音の割り当てにも入っている', () => {
    const names = new Set(synthNames());
    for (const target of ['B', 'H', 'D'] as const) for (let level = 1; level <= 10; level++) expect(names.has(landingSoundName(target, level))).toBe(true);
  });

  test('同じジャンプの着地の通知が重なっても、着地音は1回だけ', () => {
    const scheduler = new SoundScheduler(DEFAULT_SETTINGS);
    const ev = { runId: 'r', seq: 1, atUs: 0, kind: 'land' as const, pathId: 'p', sMm: 0, x: 0, y: 0,
      data: { jumpId: 4, names: ['技'], points: 900, trickTier: 5, trickPoints: 900, trickBase: 900, fxTarget: 'H' } };
    const cue = cueForEvent(ev)!;
    expect(cue.sound).toBe('trickLandingH09');
    expect(scheduler.onCues([cue], 0)).toHaveLength(1);
    expect(scheduler.onCues([cue], 500)).toEqual([]);
    expect(scheduler.onCues([cueForEvent({ ...ev, data: { ...ev.data, jumpId: 5 } })!], 600)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 走行と再生データ

const turn = (strokeId: number, atUs: number, seq: number, rotation: Vec3, target?: FreeTarget): GestureFact =>
  ({ kind: 'freeRotate', atUs, strokeId, seq, rotation, target });

describe('走行・再生データ', () => {
  test('着地の通知に実回転の対象が付き、点数・記録は変わらない', () => {
    const run = newRun(testCourse(), 'shiba', { rulesVersion: FREE_RULES_VERSION });
    const launch = jumpFacts(200_000);
    advanceRun(run, 240_000, launch.slice(0, 2).concat(turn(launch[0].strokeId, 205_000, 1, [0, 6, 0])));
    advanceRun(run, 3_000_000);
    const land = run.events.find(e => e.kind === 'land' && !e.data?.plain)!;
    expect(land.data?.fxTarget).toBe('B');
    expect(run.score.jumps[0].points).toBe(land.data?.trickPoints);
  });

  test('新しい記録だけが演出の出来事を持ち、同じ決め方で残る。古い記録は演出なしで再生できる', () => {
    const run = newRun(testCourse(), 'shiba', { rulesVersion: FREE_RULES_VERSION });
    const recorder = new ReplayRecorder(20);
    const launch = jumpFacts(200_000);
    advanceRun(run, 240_000, launch.slice(0, 2).concat(turn(launch[0].strokeId, 205_000, 1, [0, 6, 0])), s => recorder.sample(s));
    advanceRun(run, 3_000_000, [], s => recorder.sample(s));
    const data = recorder.finish(run);
    const kinds = data.visualEvents!.map(e => e.kind);
    expect(kinds[0]).toBe('F');
    expect(kinds).toContain('A');
    expect(kinds.filter(k => k === 'L')).toHaveLength(1);
    expect(data.visualEvents!.every(e => e.id === null || TRICK_FX_81.some(p => p.id === e.id))).toBe(true);
    const old = { ...data, visualEvents: undefined };
    expect(replayPoseAt(old, 300_000)).not.toBeNull();
    expect(replayPoseAt({ ...old, frames: old.frames.map(f => f.slice(0, 12)) }, 300_000)).not.toBeNull();
  });
});
