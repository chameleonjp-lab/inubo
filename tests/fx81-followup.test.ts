import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getCourse } from '../src/content/courses';
import { DOGS } from '../src/content/dogs';
import { advanceFreeMotion, createFreeMotion, type FreeMotionInput, type FreeTarget } from '../src/game/free-motion';
import type { Vec3 } from '../src/game/math';
import { DEFAULT_SETTINGS } from '../src/storage/records';
import { FxEngine, type FxBodySource, type FxFrameFlags } from '../src/view/trick-fx-engine';
import { FxTimeline, type FxFlightView, type FxVisualEvent } from '../src/view/trick-fx-timeline';
import { GameView } from '../src/view/scene';
import type { ReplayData } from '../src/view/replay';
import { newRun } from './helpers';

/**
 * PR #29 の後続対応（F01〜F06）の再現試験。修正前のコードで失敗し、修正後に成功することを確かめる。
 */

vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class { setPixelRatio() {} render() {} dispose() {} },
}));
beforeAll(() => {
  const ctx = { fillRect() {}, fillText() {}, beginPath() {}, ellipse() {}, fill() {} };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ ...ctx }) }) });
});
afterAll(() => vi.unstubAllGlobals());

const FLAGS: FxFrameFlags = { reduced: false, weak: false, paused: false, alpha: 1, heading: 0, groundY: 0 };

const LOCAL: Record<string, [number, number, number]> = {
  dogNose: [0.6, 0.6, 0], dogEarL: [0.45, 0.8, -0.1], dogEarR: [0.45, 0.8, 0.1], dogTail: [-0.55, 0.6, 0],
  dogPawFL: [0.35, 0.05, -0.14], dogPawFR: [0.35, 0.05, 0.14], dogPawBL: [-0.35, 0.05, -0.14], dogPawBR: [-0.35, 0.05, 0.14],
  dogBack: [0, 0.65, 0], dogBelly: [0, 0.4, 0], riderHead: [0, 1.9, 0], riderHelmet: [0, 2.0, 0],
  riderShoulderL: [0, 1.6, -0.2], riderShoulderR: [0, 1.6, 0.2], riderHandL: [0.1, 1.2, -0.3], riderHandR: [0.1, 1.2, 0.3],
  riderWaist: [0, 1.2, 0], riderShoeL: [0, 0.75, -0.1], riderShoeR: [0, 0.75, 0.1], pivot: [0, 0.75, 0],
};
/** 前へ進みながら z 軸まわりに回る検査用の身体。 */
function body() {
  const s = { angle: 0, forward: 0 };
  const src: FxBodySource = {
    anchor(key, out) {
      const [x, y, z] = LOCAL[key];
      const c = Math.cos(s.angle), n = Math.sin(s.angle);
      out.x = x * c - (y - 0.75) * n + s.forward; out.y = x * n + (y - 0.75) * c + 0.75; out.z = z;
      return true;
    },
    quat(_b, q) { q.x = 0; q.y = 0; q.z = Math.sin(s.angle / 2); q.w = Math.cos(s.angle / 2); return true; },
  };
  return { s, src };
}
function recorder() {
  const dots: number[][] = [], lines: number[][] = [], decals: number[][] = [];
  return { dots, lines, decals, sink: {
    line: (...v: number[]) => lines.push(v), dot: (...v: number[]) => dots.push(v),
    decal: (...v: number[]) => decals.push(v), burst: () => {},
  } };
}

// ------------------------------------------------------------------ F01
function maxSpinFlight(target: FreeTarget, untilUs: number, airUs: number): FxFlightView {
  // 物理上限（3600度/秒）を保つよう、100msごとに強く払い続ける。
  const inputs: FreeMotionInput[] = [];
  for (let t = 1_000, seq = 1; t <= untilUs; t += 100_000) inputs.push({ seq: seq++, atUs: t, target, rotation: [0, 0, 4] as Vec3 });
  const motion = createFreeMotion();
  advanceFreeMotion(motion, untilUs, inputs, undefined, true);
  return { jumpId: 1, takeoffUs: 0, predictedAirUs: airUs, heading: 0, motionTimeUs: motion.timeUs, history: motion.history, inputs: motion.seen.values() };
}

describe('F01 空中の最高段階', () => {
  test.each([['common', 'B'], ['dog', 'D'], ['rider', 'H']] as const)('%s：連携なしでも回し続ければ空中F10・A07が出る。序盤には出ない', (target, fx) => {
    const air = 800_000;
    const timeline = new FxTimeline();
    const events: FxVisualEvent[] = [];
    for (let t = 0; t <= air; t += 30_000) events.push(...timeline.observe(t, maxSpinFlight(target, t, air), target));
    const early = events.filter(e => e.tUs <= 250_000);
    expect(early.some(e => e.id === `${fx}-F10`)).toBe(false);
    expect(early.some(e => e.id === `${fx}-A07`)).toBe(false);
    expect(events.some(e => e.id === `${fx}-F10`)).toBe(true);
    expect(events.some(e => e.id === `${fx}-A07`)).toBe(true);
    expect(events.some(e => e.kind === 'C')).toBe(false);
  });
});

// ------------------------------------------------------------------ F02
describe('F02 着地の位置', () => {
  test.each(['B-L01', 'D-L05', 'H-L03', 'D-L10'] as const)('%s：着地のあと身体が5m進んでも、床の印は接地点から動かない', id => {
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    engine.frame(16, b.src, rec.sink, FLAGS);
    engine.apply({ tUs: 0, jumpId: 1, kind: 'L', target: id[0] as 'B', level: Number(id.slice(3)), id }, { contact: { x: 0, y: 0, z: 0 }, yaw: 0 });
    for (let i = 0; i < 30; i++) {
      b.s.forward += 0.17;
      engine.frame(16, b.src, rec.sink, FLAGS);
    }
    const xs = [...rec.dots.map(v => v[0]), ...rec.decals.map(v => v[0]), ...rec.lines.flatMap(v => [v[0], v[3]])];
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(1.6);
  });
});

// ------------------------------------------------------------------ F03・F04
describe('F03 高速回転の向き・F04 ジャンプ間の初期化', () => {
  test('1フレームに240度回る高速回転でも、回転軸の向きを逆に取り違えない', () => {
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    const step = 240 * Math.PI / 180;
    for (let i = 0; i < 6; i++) {
      b.s.angle += step;
      const omega = { x: 0, y: 0, z: step / 0.033 };
      engine.frame(33, b.src, rec.sink, { ...FLAGS, spin: { dog: { omega, accum: b.s.angle }, rider: { omega, accum: b.s.angle } } } as FxFrameFlags);
    }
    const axis = (engine as unknown as { axisOf(b: string, o: THREE.Vector3): THREE.Vector3 }).axisOf('dog', new THREE.Vector3());
    expect(axis.z).toBeGreaterThan(0.9);
  });

  test('次のジャンプは回転の累積を0から始める', () => {
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    engine.apply({ tUs: 0, jumpId: 1, kind: 'F', target: 'B', level: 1, id: 'B-F01' });
    for (let i = 0; i < 20; i++) { b.s.angle += 0.3; engine.frame(16, b.src, rec.sink, FLAGS); }
    const turned = () => (engine as unknown as { turnedOf(b: string): number }).turnedOf('dog');
    expect(turned()).toBeGreaterThan(3);
    engine.apply({ tUs: 2_000_000, jumpId: 2, kind: 'F', target: 'B', level: 1, id: 'B-F01' });
    expect(turned()).toBe(0);
  });
});

// ------------------------------------------------------------------ F05・F06（競技の描画）
const park = getCourse('park');
function viewWithRig(): GameView {
  const view = new GameView(document.createElement('canvas') as unknown as HTMLCanvasElement);
  view.setCourse(park);
  view.setRider(DOGS.shiba.look, '#112233', '#334455');
  return view;
}
type Particle = { x: number; y: number; z: number; life: number };

describe('F05 一時停止', () => {
  test('一時停止中は、共通の粒も動かず、寿命も減らず、新しく増えない', () => {
    const view = viewWithRig();
    const run = newRun(park);
    view.frame(run, run.simUs, [{ effect: 'E24', visual: 'tape', sound: null, atUs: 0, runId: run.id.runId }], DEFAULT_SETTINGS, 0, 16);
    const list = () => (view as unknown as { particles: { list: Particle[] } }).particles.list.map(p => ({ ...p }));
    const before = list();
    expect(before.length).toBeGreaterThan(0);
    view.setFxPaused(true);
    view.frame(run, run.simUs, [{ effect: 'E24', visual: 'tape', sound: null, atUs: 0, runId: run.id.runId }], DEFAULT_SETTINGS, 1000, 1000);
    view.frame(run, run.simUs, [], DEFAULT_SETTINGS, 2000, 1000);
    expect(list()).toEqual(before);
    view.dispose();
  });
});

describe('F06 ゴーストの着地位置', () => {
  test('保存された着地は、その出来事の接地点で描く（再生が遅れて始まっても、今のゴーストの位置へずらさない）', () => {
    const view = viewWithRig();
    const run = newRun(park);
    // 秒速10mで x 方向へ進む録画。着地は1.0秒（x=10m）。
    const frames = Array.from({ length: 31 }, (_, i) => [i * 100, 0, 0, 0, 0, 0, 0, 1000, 0, 0, 0, 1000]);
    const replay: ReplayData = { runId: 'g', dogId: 'shiba', courseId: 'park', courseVersion: park.def.version, rulesVersion: 'rules-freestyle-2',
      motionVersion: 'freestyle-1', stepMs: 100, frames,
      visualEvents: [{ tUs: 1_000_000, jumpId: 1, kind: 'L', target: 'D', level: 5, id: 'D-L05', contact: { x: 10, y: 0, z: 0, yaw: 0 } } as FxVisualEvent] };
    view.setGhost(replay, DOGS.shiba.look);
    const engine = (view as unknown as { ghostFx: FxEngine }).ghostFx;
    const applied: { contact?: { x: number } }[] = [];
    const original = engine.apply.bind(engine);
    engine.apply = (ev, ctx = {}) => { applied.push(ctx); original(ev, ctx); };
    view.frame(run, 1_500_000, [], DEFAULT_SETTINGS, 0, 16);
    expect(applied).toHaveLength(1);
    expect(applied[0].contact!.x).toBeCloseTo(10, 1);
    view.dispose();
  });
});

// ------------------------------------------------------------------ 追加の回帰試験（T04〜T09）
import { contactOfEvent, FxSpinReader } from '../src/view/trick-fx-sim';
import { ReplayRecorder } from '../src/view/replay';
import { advanceRun } from '../src/game/run';
import { FREE_RULES_VERSION } from '../src/game/free-motion';
import type { GestureFact, SimEvent } from '../src/game/types';
import { jumpFacts, testCourse } from './helpers';

const landEvent = (run: ReturnType<typeof newRun>, sMm: number, x: number, y: number, data: SimEvent['data'] = {}): SimEvent =>
  ({ runId: run.id.runId, seq: 1, atUs: 1_000_000, kind: 'land', pathId: 'main', sMm, x, y, data });

describe('T04 接地点（地面・斜面・手すり）', () => {
  test('斜面では地面の傾き、手すりの上では手すりの傾きと高さを使う', () => {
    const slope = newRun(testCourse({ height: [{ u: 0, v: 0 }, { u: 400, v: 40 }] }));
    const onSlope = contactOfEvent(slope, landEvent(slope, 100_000, 0.5, 10))!;
    expect(onSlope.grade).toBeCloseTo(0.1, 2);
    expect(onSlope.y).toBe(10);
    const rail = newRun(testCourse({ objects: [{ kind: 'rail', id: 'A', path: 'main', u0: 40, u1: 50, x: 0, h0: 0.6, h1: 1.6 }] }));
    const onRail = contactOfEvent(rail, landEvent(rail, 45_000, 0, 1.1, { onRail: 'A' }))!;
    expect(onRail.grade).toBeCloseTo(0.1, 3);
    expect(onRail.y).toBe(1.1);
  });

  test('傾いた接地面では、床の輪も傾きに沿う（浮いたり埋まったりしない）', () => {
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    engine.frame(16, b.src, rec.sink, FLAGS);
    engine.apply({ tUs: 0, jumpId: 1, kind: 'L', target: 'D', level: 9, id: 'D-L09' }, { contact: { x: 0, y: 2, z: 0 }, yaw: 0, grade: 0.2 });
    for (let i = 0; i < 10; i++) engine.frame(16, b.src, rec.sink, FLAGS);
    expect(rec.lines.length).toBeGreaterThan(0);
    for (const v of rec.lines) {
      expect(v[1]).toBeCloseTo(2.03 + v[0] * 0.2, 4);
      expect(v[4]).toBeCloseTo(2.03 + v[3] * 0.2, 4);
    }
  });
});

describe('T05 連続ジャンプ', () => {
  test('前の着地Lは位置を変えずに寿命まで残り、次のジャンプの空中演出は回転0から始まる', () => {
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    engine.apply({ tUs: 0, jumpId: 1, kind: 'F', target: 'D', level: 3, id: 'D-F03' });
    for (let i = 0; i < 10; i++) { b.s.angle += 0.3; engine.frame(16, b.src, rec.sink, FLAGS); }
    engine.apply({ tUs: 800_000, jumpId: 1, kind: 'L', target: 'D', level: 5, id: 'D-L05' }, { contact: { x: 0, y: 0, z: 0 }, yaw: 0 });
    engine.frame(16, b.src, rec.sink, FLAGS);
    rec.lines.length = 0;
    engine.frame(16, b.src, rec.sink, FLAGS);
    const ringBefore = rec.lines.map(v => v.slice(0, 6));
    b.s.forward += 3;
    engine.apply({ tUs: 1_000_000, jumpId: 2, kind: 'F', target: 'B', level: 1, id: 'B-F01' });
    expect((engine as unknown as { turnedOf(b: string): number }).turnedOf('dog')).toBe(0);
    expect(engine.activeIds().sort()).toEqual(['B-F01', 'D-L05']);
    rec.lines.length = 0;
    engine.frame(0, b.src, rec.sink, { ...FLAGS, paused: true });
    expect(rec.lines.map(v => v.slice(0, 6))).toEqual(ringBefore);
    for (let i = 0; i < 80; i++) engine.frame(16, b.src, rec.sink, FLAGS);
    expect(engine.activeIds()).toEqual(['B-F01']);
  });
});

describe('T06 高速回転（15/30/60/120fps）', () => {
  // 共通と犬の両方を上限で回し、犬は合成で約7200度/秒。
  const motion = createFreeMotion();
  const inputs: FreeMotionInput[] = [];
  for (let t = 1_000, seq = 1; t < 600_000; t += 100_000) {
    inputs.push({ seq: seq++, atUs: t, target: 'common', rotation: [0, 0, 4] });
    inputs.push({ seq: seq++, atUs: t, target: 'dog', rotation: [0, 0, 4] });
  }
  advanceFreeMotion(motion, 600_000, inputs, undefined, true);

  test.each([15, 30, 60, 120])('%dfps：同じ時刻の角速度・累積角が一致し、回転軸は逆にならない', fps => {
    const reader = new FxSpinReader();
    const step = Math.round(1e6 / fps);
    let sample = reader.read(motion, 'j', 0);
    for (let t = step; t < 500_000; t += step) sample = reader.read(motion, 'j', t);
    sample = reader.read(motion, 'j', 500_000);
    const reference = new FxSpinReader().read(motion, 'j', 500_000);
    expect(sample.dog.accum).toBeCloseTo(reference.dog.accum, 6);
    expect(sample.dog.omega.z).toBeCloseTo(reference.dog.omega.z, 6);
    expect(sample.dog.omega.z).toBeGreaterThan(0);
    // 合成の速さは約7200度/秒（犬）、3600度/秒（人）。
    expect(sample.dog.accum).toBeGreaterThan(sample.rider.accum * 1.5);

    // 同じ回転を描画のフレームごとに渡すと、1フレームで180度を超えても軸は正の向き。
    const engine = new FxEngine();
    const b = body();
    const rec = recorder();
    const r2 = new FxSpinReader();
    const times = [...Array.from({ length: Math.floor(500_000 / step) + 1 }, (_, i) => i * step).filter(t => t < 500_000), 500_000];
    for (const t of times) {
      const s = r2.read(motion, 'j', t);
      b.s.angle = s.dog.accum;
      engine.frame(step / 1000, b.src, rec.sink, { ...FLAGS, spin: s });
    }
    const axis = (engine as unknown as { axisOf(b: string, o: THREE.Vector3): THREE.Vector3 }).axisOf('dog', new THREE.Vector3());
    expect(axis.z).toBeGreaterThan(0.99);
    expect((engine as unknown as { turnedOf(b: string): number }).turnedOf('dog')).toBeCloseTo(reference.dog.accum, 6);
  });
});

describe('T08・T09 再生データ', () => {
  const frames = Array.from({ length: 31 }, (_, i) => [i * 100, 0, 0, 0, 0, 0, 0, 1000, 0, 0, 0, 1000]);
  const base: ReplayData = { runId: 'g', dogId: 'shiba', courseId: 'park', courseVersion: park.def.version, rulesVersion: 'rules-freestyle-2',
    motionVersion: 'freestyle-1', stepMs: 100, frames };
  function ghostApplies(replay: ReplayData, renderTimes: number[]): { kind: string; contact?: { x: number } }[] {
    const view = viewWithRig();
    const run = newRun(park);
    view.setGhost(replay, DOGS.shiba.look);
    const engine = (view as unknown as { ghostFx: FxEngine }).ghostFx;
    const applied: { kind: string; contact?: { x: number } }[] = [];
    const original = engine.apply.bind(engine);
    engine.apply = (ev, ctx = {}) => { applied.push({ kind: ev.kind, contact: ctx.contact }); original(ev, ctx); };
    for (const t of renderTimes) view.frame(run, t, [], DEFAULT_SETTINGS, t / 1000, 16);
    view.dispose();
    return applied;
  }
  const L: FxVisualEvent = { tUs: 1_000_000, jumpId: 1, kind: 'L', target: 'D', level: 5, id: 'D-L05', contact: { x: 10, y: 0, z: 0, yaw: 0 } };

  test('時間どおり・500ms遅れ・30/60/120fpsのどれでも、同じ接地点に1回だけ描く', () => {
    for (const times of [
      Array.from({ length: 40 }, (_, i) => i * 33_333), Array.from({ length: 80 }, (_, i) => i * 16_667),
      Array.from({ length: 160 }, (_, i) => i * 8_333), [0, 1_500_000, 1_516_000],
    ]) {
      const applied = ghostApplies({ ...base, visualEvents: [L] }, times).filter(a => a.kind === 'L');
      expect(applied).toHaveLength(1);
      expect(applied[0].contact!.x).toBe(10);
    }
  });

  test('巻き戻すと組み立て直し、二重には描かない', () => {
    const applied = ghostApplies({ ...base, visualEvents: [L] }, [1_100_000, 1_200_000, 500_000, 1_100_000]).filter(a => a.kind === 'L');
    expect(applied).toHaveLength(2);
    expect(applied.every(a => a.contact!.x === 10)).toBe(true);
  });

  test('接地点の無い記録は、その時刻の再生姿勢で描く。演出の出来事が無い古い記録は何も描かない', () => {
    const { contact: _c, ...old } = L;
    const applied = ghostApplies({ ...base, visualEvents: [old] }, [1_500_000]).filter(a => a.kind === 'L');
    expect(applied[0].contact!.x).toBeCloseTo(10, 5);
    expect(ghostApplies(base, [1_500_000])).toEqual([]);
  });

  test('新しい記録の着地Lは接地点を持ち、旧形式の frames と保存の形は変えない', () => {
    const run = newRun(testCourse(), 'shiba', { rulesVersion: FREE_RULES_VERSION });
    const recorder = new ReplayRecorder(20);
    const launch = jumpFacts(200_000);
    const turn: GestureFact = { kind: 'freeRotate', atUs: 205_000, strokeId: launch[0].strokeId, seq: 1, rotation: [0, 6, 0] };
    advanceRun(run, 240_000, launch.slice(0, 2).concat(turn), s => recorder.sample(s));
    advanceRun(run, 3_000_000, [], s => recorder.sample(s));
    const data = recorder.finish(run);
    const land = data.visualEvents!.find(e => e.kind === 'L')!;
    const ev = run.events.find(e => e.kind === 'land' && !e.data?.plain)!;
    expect(land.contact).toEqual(contactOfEvent(run, ev));
    expect(Object.keys(data).sort()).toEqual(['courseId', 'courseVersion', 'dogId', 'frames', 'motionVersion', 'rulesVersion', 'runId', 'stepMs', 'visualEvents']);
    expect(JSON.stringify(data.visualEvents).length).toBeLessThan(2_000);
  });
});
