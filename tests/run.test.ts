import { describe, expect, test } from 'vitest';
import { RunSession, advanceRun, createRun } from '../src/game/run';
import { GestureRecognizer } from '../src/input/gestures';
import { DOGS } from '../src/content/dogs';
import { getCourse } from '../src/content/courses/index';
import { runWithAutopilot } from '../src/game/autopilot';
import { identity, newRun, runTo, testCourse } from './helpers';
import type { GestureFact, SimState } from '../src/game/types';

/** 指の操作を、画面と同じ順で走行の進行役へ渡す小さな結線（ui/screens.ts と同じ手順）。 */
class Wiring {
  rec = new GestureRecognizer();
  constructor(public session: RunSession) {
    this.rec.setViewport(400, 700);
  }
  private send(facts: GestureFact[]) {
    this.session.submit(this.session.runId, facts);
  }
  down(id: number, x: number, y: number, wallUs: number) {
    this.session.pointerDown(id);
    const at = this.session.runClockUs(wallUs);
    if (at === null) {
      this.rec.ignorePointer(id);
      return;
    }
    this.send(this.rec.pointerDown(id, x, y, at));
  }
  move(id: number, x: number, y: number, wallUs: number) {
    const at = this.session.runClockUs(wallUs);
    if (at === null) return;
    this.send(this.rec.pointerMove(id, x, y, at));
  }
  up(id: number, x: number, y: number, wallUs: number) {
    const at = this.session.runClockUs(wallUs) ?? this.session.sim.simUs;
    this.send(this.rec.pointerUp(id, x, y, at));
    this.session.pointerUp(id, wallUs);
  }
  pause(reason: 'manual' | 'hidden' | 'orientation') {
    this.session.pause(reason);
    this.send(this.rec.suspend(this.session.sim.simUs));
  }
}

describe('V01 起点と中断', () => {
  test('秒読みの末尾で二重に開始しても起点は1回、中断中の時間は時計・効果・回転・ゲートに入らず、新しいタッチまで跳ばない', () => {
    const course = testCourse({
      objects: [
        { kind: 'food', id: 'f', path: 'main', u: 2, x: 0, h: 0.35 },
        { kind: 'gate', id: 'g', path: 'main', u: 300, x0: -4, x1: 4, height: 0.9, periodUs: 4_000_000, offsetUs: 0 },
      ],
    });
    const session = new RunSession(identity(), course, DOGS.shiba);
    const w = new Wiring(session);
    const seen: string[] = [];
    let wall = 1_000_000;
    const tick = () => {
      wall += 16_667;
      seen.push(...session.update(wall).map((e) => e.kind));
    };
    seen.push(...session.update(wall).map((e) => e.kind));
    // 秒読み中の入力は走行操作として受け取らない（時計は 0 のまま）。
    expect(session.runClockUs(wall)).toBeNull();
    while (session.countdownUs < 2_990_000) tick();
    expect(session.sim.simUs).toBe(0);
    tick();
    expect(session.phase).toBe('running');
    // 秒読みの末尾で、もう一度開始の通知が来ても何もしない。
    expect(session.begin(0)).toBe(false);
    expect(session.begin(5_000)).toBe(false);
    for (let i = 0; i < 60; i++) tick();
    expect(seen.filter((k) => k === 'start').length).toBe(1);
    expect(seen.filter((k) => k === 'countdown').length).toBe(3);
    const beforePauseUs = session.sim.simUs;
    const foodUntil = session.sim.effects.foodUntilUs;
    expect(foodUntil).not.toBeNull();
    w.down(7, 200, 600, wall);
    session.setHidden(true, wall);
    w.pause('hidden');
    wall += 10_000_000;
    session.update(wall);
    session.pause('orientation');
    wall += 5_000_000;
    session.update(wall);
    session.setHidden(false, wall);
    session.update(wall);
    expect(session.paused).toBe(true);
    // 再開を押しても、指が残っている間は進まない。
    session.requestResume(wall);
    expect(session.paused).toBe(true);
    // 画面に残っていた指を上へ払っても、ゲーム操作にはならない。
    w.move(7, 200, 300, wall);
    w.up(7, 200, 300, wall);
    expect(session.paused).toBe(false);
    for (let i = 0; i < 6; i++) {
      wall += 16_667;
      session.update(wall);
    }
    // 中断していた 15 秒は走行時計に入っていない。
    expect(session.sim.simUs - beforePauseUs).toBeLessThan(120_000);
    expect(session.sim.effects.foodUntilUs).toBe(foodUntil);
    expect(session.sim.events.filter((e) => e.kind === 'jump').length).toBe(0);
    // 新しいタッチで初めて跳ぶ。
    w.down(8, 200, 600, wall);
    wall += 16_667;
    w.move(8, 200, 520, wall);
    w.up(8, 200, 520, wall);
    wall += 16_667;
    session.update(wall);
    wall += 16_667;
    session.update(wall);
    expect(session.sim.events.filter((e) => e.kind === 'jump').length).toBe(1);
  });

  test('ゲートの位相は走行時計で決まり、中断した2走でも同じ時刻に同じ状態になる', () => {
    const course = testCourse({ objects: [{ kind: 'gate', id: 'g', path: 'main', u: 390, x0: -4, x1: 4, height: 0.9, periodUs: 4_000_000, offsetUs: 0 }] });
    const runA = newRun(course);
    const runB = newRun(course);
    runTo(runA, 9_000_000);
    runTo(runB, 4_000_000);
    // runB は 4 秒で止めて（中断に相当）、時間をおかずに続きから進める。
    runTo(runB, 9_000_000, [], 33_333);
    const phasesA = runA.events.filter((e) => e.kind.startsWith('gate')).map((e) => `${e.kind}@${e.atUs}`);
    const phasesB = runB.events.filter((e) => e.kind.startsWith('gate')).map((e) => `${e.kind}@${e.atUs}`);
    expect(phasesB).toEqual(phasesA);
  });

  test('再挑戦すると新しい走行になり、前の走行の遅れた入力は走行番号で捨てる', () => {
    const course = testCourse();
    const first = new RunSession(identity(), course, DOGS.shiba);
    const second = new RunSession(identity(), course, DOGS.shiba);
    expect(second.runId).not.toBe(first.runId);
    let wall = 0;
    second.update(wall);
    for (let i = 0; i < 200; i++) second.update((wall += 16_667));
    second.submit(first.runId, [
      { kind: 'down', atUs: second.sim.simUs, strokeId: 1 },
      { kind: 'forward', atUs: second.sim.simUs, strokeId: 1 },
    ]);
    second.update((wall += 16_667));
    second.update((wall += 16_667));
    expect(second.sim.events.filter((e) => e.kind === 'jump').length).toBe(0);
    expect(second.sim.score.jumpPoints).toBe(0);
  });
});

describe('V02 描画間隔', () => {
  test('8.990〜9.010 秒を1回の更新にしても、加速終了の 9.000 秒で分けて 0.125＋0.100＝0.225m 進む', () => {
    const course = testCourse();
    const run = newRun(course);
    runTo(run, 8_990_000);
    expect(run.baseSpeed).toBeCloseTo(10, 9);
    run.effects.foodUntilUs = 9_000_000;
    const s0 = run.s;
    advanceRun(run, 9_010_000);
    expect(run.s - s0).toBeCloseTo(0.225, 9);
  });

  test('刻みの途中で効果が切れても、その時刻で分けて進む', () => {
    const course = testCourse();
    const run = newRun(course);
    runTo(run, 8_990_000);
    run.effects.foodUntilUs = 9_001_200;
    const s0 = run.s;
    advanceRun(run, 9_010_000);
    expect(run.s - s0).toBeCloseTo(12.5 * 0.0112 + 10 * 0.0088, 9);
  });

  test('同じ入力を 30・60・120 回/秒と、ときどき描画を飛ばす条件で再生しても、通過時刻・取得物・得点が一致する', () => {
    const course = getCourse('park');
    const recorded = newRun(course);
    runWithAutopilot(recorded, course.def.autoRoutes.trick);
    expect(recorded.finished).toBe(true);
    const inputs = recorded.inputLog.slice();
    const replay = (frames: (i: number) => number): SimState => {
      const run = createRun(identity(), course, DOGS.shiba);
      let t = 0;
      let i = 0;
      let next = 0;
      while (!run.finished && t < 200_000_000) {
        t += frames(i++);
        const batch: GestureFact[] = [];
        while (next < inputs.length && inputs[next].atUs <= t) batch.push(inputs[next++]);
        advanceRun(run, t, batch);
      }
      return run;
    };
    const fps30 = replay(() => 33_333);
    const fps60 = replay(() => 16_667);
    const fps120 = replay(() => 8_333);
    const skipping = replay((i) => (i % 7 === 3 ? 66_667 : i % 11 === 5 ? 3_001 : 16_667));
    const summary = (r: SimState) => ({
      result: r.result,
      events: r.events.filter((e) => ['checkpoint', 'food', 'poop', 'land', 'sectionScore', 'goal', 'railScore'].includes(e.kind)).map((e) => `${e.kind}@${e.atUs}:${e.objId ?? ''}:${JSON.stringify(e.data ?? {})}`),
    });
    const base = summary(recorded);
    expect(base.result).not.toBeNull();
    for (const r of [fps30, fps60, fps120, skipping]) {
      const sm = summary(r);
      expect(sm.result?.recordCs).toBe(base.result!.recordCs);
      expect(sm.result?.total).toBe(base.result!.total);
      expect(sm.events).toEqual(base.events);
    }
  });

  test('1回の更新で壁を越える距離を渡しても、壁で止まり、壁の奥の袋は取らない', () => {
    const course = testCourse({
      objects: [
        { kind: 'wall', id: 'w', path: 'main', u0: 60, u1: 60.4, x0: -4, x1: 4, height: 1.8 },
        { kind: 'food', id: 'behind', path: 'main', u: 61, x: 0, h: 0.35 },
      ],
    });
    const run = newRun(course);
    runTo(run, 4_500_000);
    advanceRun(run, 9_000_000);
    expect(run.blocked?.solidId).toBe('w');
    expect(run.s).toBeLessThanOrEqual(60 - 0.45 + 1e-9);
    expect(run.consumed.behind).toBeUndefined();
    expect(run.effects.foodUntilUs).toBeNull();
  });
});
