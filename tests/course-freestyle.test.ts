import { expect, test } from 'vitest';
import { DOGS } from '../src/content/dogs';
import { advanceRun, RunSession } from '../src/game/run';
import { FREE_RULES_VERSION, sampleFreeSpan, type FreeTarget } from '../src/game/free-motion';
import { qDistance } from '../src/game/free-math';
import type { Vec3 } from '../src/game/math';
import type { GestureFact } from '../src/game/types';
import { FreePointerController } from '../src/input/free-pointer';
import { FREE_REPLAY_STEP_MS, ReplayRecorder, poseOf, replayPoseAt } from '../src/view/replay';
import { eventsOf, identity, jumpFacts, newRun, runTo, testCourse } from './helpers';

const free = { rulesVersion: FREE_RULES_VERSION };
const jumpAt = 200_000;
const down = (strokeId: number, atUs: number, freeTarget: FreeTarget = 'common'): GestureFact => ({ kind: 'down', atUs, strokeId, freeTarget });
const turn = (strokeId: number, atUs: number, seq: number, rotation: Vec3, target?: FreeTarget): GestureFact => ({ kind: 'freeRotate', atUs, strokeId, seq, rotation, target });
const up = (strokeId: number, atUs: number, cancelled = false): GestureFact => ({ kind: 'up', atUs, strokeId, cancelled });

test('踏切の指を離さずすぐ回る。続いて新しい指でも回せて慣性と逆回転を維持する', () => {
  const run = newRun(testCourse(), 'shiba', free);
  const launch = jumpFacts(jumpAt);
  const takeoffFinger = launch[0].strokeId;
  advanceRun(run, 240_000, launch.slice(0, 2).concat(turn(takeoffFinger, 205_000, 1, [0, 3, 0])));
  const flight = run.freeFlight!;
  expect(flight.motion.omega.common[1]).toBeGreaterThan(0);
  expect(run.jump?.resolution.rotations).toEqual([]);
  const initial = flight.motion.pose.dog.q;
  advanceRun(run, 310_000, [up(takeoffFinger, 242_000), down(1, 250_000), turn(1, 265_000, 2, [0.15, 0.46, 0.05])]);
  const during = flight.motion.pose.dog.q;
  expect(qDistance(initial, during)).toBeGreaterThan(0.07);
  expect(run.strokes[1].upUs).toBeNull();
  expect(flight.motion.omega.common[1]).toBeGreaterThan(0);

  advanceRun(run, 400_000, [up(1, 320_000)]);
  expect(qDistance(during, flight.motion.pose.dog.q)).toBeGreaterThan(0.08);
  expect(flight.motion.omega.common[1]).toBeGreaterThan(0);

  advanceRun(run, 470_000, [down(2, 410_000), turn(2, 425_000, 3, [0, -5, 0]), turn(2, 440_000, 4, [0.26, 0, 0.28])]);
  expect(flight.motion.omega.common[1]).toBeLessThan(0);
  expect(Math.abs(flight.motion.omega.common[0]) + Math.abs(flight.motion.omega.common[2])).toBeGreaterThan(1.1);
  expect(eventsOf(run, 'trickStart')).toEqual([]);
  expect(run.score.jumps).toEqual([]);
});

test('犬だけの回転は人へ伝わらず、別の指が同じ操作対象を奪えない', () => {
  const run = newRun(testCourse(), 'corgi', free);
  advanceRun(run, 235_000, jumpFacts(jumpAt));
  const start = poseOf(run).free!;
  advanceRun(run, 360_000, [down(1, 240_000, 'dog'), down(2, 245_000, 'dog'), down(3, 250_000, 'rider'),
    turn(1, 255_000, 1, [0, 0.5, 0]), turn(2, 260_000, 2, [0, -4, 0])]);
  const flight = run.freeFlight!;
  expect(qDistance(start.dog.q, flight.motion.pose.dog.q)).toBeGreaterThan(0.18);
  expect(qDistance(start.rider.q, flight.motion.pose.rider.q)).toBeLessThan(1e-6);
  expect(flight.motion.omega.dog[1]).toBeGreaterThan(1.5);
  expect(run.strokes[2].freeTarget).toBeUndefined();

  advanceRun(run, 440_000, [turn(3, 390_000, 3, [0.2, 0.4, 0])]);
  expect(qDistance(start.rider.q, flight.motion.pose.rider.q)).toBeGreaterThan(0.05);
});

test('画面の端から払っても反応し、長い払いも指を置いた位置から回り続ける', () => {
  for (const [width, height] of [[402, 700], [700, 402]]) {
    const pointer = new FreePointerController(undefined, true);
    pointer.setSurface(width, height);
    expect(pointer.down(1, width - 4, height * 0.78, 'dog')).toBe(true);
    const first = pointer.move(1, width - 32, height * 0.78, 1_000);
    expect(first.reduce((sum, i) => sum + i.rotation[1], 0)).toBeLessThan(-0.1);
    pointer.move(1, 45, height * 0.78, 2_000);
    pointer.setSurface(width, height - 16); // 同じ向きでアドレスバー等の高さだけ変わる。
    const end = pointer.move(1, 6, height * 0.78, 3_000);
    expect(end.reduce((sum, i) => sum + i.rotation[1], 0)).toBeLessThan(-0.01);
  }
});

test('接地までの回転で即時採点し、実際の着地区間に1回だけ付く', () => {
  const course = testCourse({ sections: [
    { path: 'main', u0: 0, u1: 8.4, opp: 'first' },
    { path: 'main', u0: 8.4, u1: 60, opp: 'second' },
  ] });
  const run = newRun(course, 'shiba', free);
  const facts = [...jumpFacts(jumpAt), down(1, 240_000), turn(1, 250_000, 1, [0, 0.78, 0]), up(1, 270_000)];
  advanceRun(run, 970_000, facts);
  expect(run.score.jumps).toEqual([]);
  advanceRun(run, 1_035_000);
  expect(run.score.jumps).toHaveLength(1);
  const landing = run.score.jumps[0];
  expect(landing).toMatchObject({ opp: 'first', names: [expect.stringContaining('犬と人の左スピン')], tenths: 10 });
  expect(landing.awarded).toBeGreaterThan(0);
  expect(eventsOf(run, 'land')[0].data).toMatchObject({ trickTier: expect.any(Number) });

  advanceRun(run, 1_245_000, [down(2, 1_055_000), turn(2, 1_065_000, 2, [-2, -3, 2]), up(2, 1_075_000)]);
  expect(run.score.jumps).toEqual([landing]);
  expect(run.score.scoredOpps.second).toBeUndefined();
  expect(eventsOf(run, 'sectionMiss').some(e => e.data?.opp === 'first')).toBe(false);
});

test('どの時刻で描画しても未知の姿勢と着地が同じ。再生用の姿勢にも犬・人を別々に記録する', () => {
  const run = newRun(testCourse(), 'whippet', free);
  const facts = [...jumpFacts(jumpAt), down(1, 232_000), turn(1, 250_000, 1, [0, 0.74, 0]), up(1, 310_000)];
  const values = [8_000, 16_000, 33_000].map(step => {
    const sim = newRun(run.course, 'whippet', free);
    runTo(sim, 1_240_000, facts, step);
    return sim.score.jumps;
  });
  expect(values[0]).toEqual(values[1]);
  expect(values[1]).toEqual(values[2]);
  expect(values[0][0]?.points).toBeGreaterThan(0);
  const recorder = new ReplayRecorder(50);
  for (let t = 0; t <= 600_000; t += 50_000) {
    advanceRun(run, t, t === 0 ? facts : []);
    recorder.sample(run);
  }
  const replay = recorder.finish(run);
  expect(replay.motionVersion).toBe('freestyle-1');
  const pose = replayPoseAt(replay, 525_000)!.free!;
  expect(qDistance(pose.dog.q, poseOf(run).free!.dog.q)).toBeGreaterThan(0.02);
  expect(pose.rider.p[1]).toBeGreaterThan(pose.dog.p[1]);
});

test.each(['common', 'dog', 'rider'] as const)('%s の姿勢が傾いても、接地時に技を採点する', target => {
  const run = newRun(testCourse(), 'shiba', free);
  advanceRun(run, 1_100_000, [...jumpFacts(jumpAt), down(1, 240_000, target),
    turn(1, 250_000, 1, [0.33, 0, 0]), up(1, 270_000)]);
  expect(run.score.jumps).toHaveLength(1);
  expect(run.score.jumps[0].points).toBeGreaterThan(0);
  expect(run.score.jumps[0].names[0]).toContain('バックフリップ');
  expect(eventsOf(run, 'landFail')).toHaveLength(0);
});

test('手すりの上に戻った時点で、傾いた犬の回転も採点する', () => {
  const course = testCourse({ objects: [{ kind: 'rail', id: 'A', path: 'main', u0: 6, u1: 20, x: 0, h0: 0.6, h1: 0.6 }] });
  const run = newRun(course, 'shiba', free);
  advanceRun(run, 1_080_000, [...jumpFacts(jumpAt), down(1, 240_000, 'dog'),
    turn(1, 250_000, 1, [0.52, 0, 0]), up(1, 270_000)]);
  expect(eventsOf(run, 'railOn').map(event => event.objId)).toEqual(['A']);
  expect(run.score.jumps).toHaveLength(1);
  expect(run.score.jumps[0]).toMatchObject({ onRail: true, names: [expect.stringContaining('犬のバックフリップ')] });
  expect(run.score.jumps[0].awarded).toBeGreaterThan(0);
});

test('描画が100ms遅れても最高速の共通・個別回転を逆向きに再生しない', () => {
  const recorder = new ReplayRecorder(FREE_REPLAY_STEP_MS);
  const session = new RunSession(identity(free), testCourse(), DOGS.shiba, run => recorder.sample(run));
  session.update(0);
  session.begin();
  session.submit(session.runId, [...jumpFacts(20_000),
    down(1, 25_000), turn(1, 25_000, 1, [0, Math.PI, 0]), up(1, 25_000),
    down(2, 25_000, 'dog'), turn(2, 25_000, 2, [0, Math.PI, 0]), up(2, 25_000)]);
  session.update(100_000);
  const at = 50_000;
  const history = session.sim.freeFlight!.motion.history;
  const span = history.find(s => s.startUs <= at && s.endUs >= at)!;
  const saved = replayPoseAt(recorder.finish(session.sim), at)!.free!;
  expect(qDistance(saved.dog.q, sampleFreeSpan(span, at).pose.dog.q)).toBeLessThan(0.02);
});

test('空中で壁に触れると回転の履歴を閉じ、前進を止める', () => {
  const course = testCourse({ objects: [{ kind: 'wall', id: 'wall', path: 'main', u0: 5.3, u1: 5.6, x0: -2, x1: 2, height: 3 }] });
  const run = newRun(course, 'shiba', free);
  advanceRun(run, 740_000, [...jumpFacts(jumpAt), down(1, 240_000), turn(1, 250_000, 1, [0, 0.8, 0])]);
  expect(eventsOf(run, 'collide').map(event => event.objId)).toContain('wall');
  expect(run.s).toBeLessThan(5.3);
  expect(run.freeFlight).toBeNull();
  expect(run.score.jumps).toHaveLength(0);
  expect(eventsOf(run, 'landFail')).toHaveLength(0);
});

test('着地前にゴールした走行へ後から得点を足さない', () => {
  const run = newRun(testCourse({ goalU: 7.2 }), 'shiba', free);
  advanceRun(run, 1_500_000, [...jumpFacts(jumpAt), down(1, 240_000), turn(1, 250_000, 1, [0, 0.8, 0]), up(1, 270_000)]);
  expect(run.finished).toBe(true);
  expect(run.result?.trickScore).toBe(0);
  expect(run.result?.jumps).toHaveLength(0);
});

test('一時停止は入力待ちを捨て、空中姿勢と勢いを保存する', () => {
  const session = new RunSession(identity(free), testCourse(), DOGS.shiba);
  session.update(0);
  session.begin();
  session.submit(session.runId, [...jumpFacts(20_000), down(1, 30_000), turn(1, 45_000, 1, [0, 0.7, 0]), turn(1, 98_000, 2, [0, -3, 0])]);
  session.update(80_000);
  const before = poseOf(session.sim).free!.dog.q;
  const omega = session.sim.freeFlight!.motion.omega.common[1];
  session.pause('orientation');
  session.update(900_000);
  expect(poseOf(session.sim).free!.dog.q).toEqual(before);
  expect(session.sim.freeFlight!.motion.omega.common[1]).toBe(omega);
  expect(session.sim.strokes[1]).toMatchObject({ upUs: 80_000, cancelled: true });
  session.requestResume(900_000);
  session.submit(session.runId, [down(2, 90_000), turn(2, 95_000, 3, [0, 0.2, 0])]);
  session.update(930_000);
  expect(session.sim.freeFlight!.motion.omega.common[1]).toBeGreaterThan(omega);
  expect(qDistance(poseOf(session.sim).free!.dog.q, before)).toBeGreaterThan(0.03);
});


test('空中で指を保持したまま一緒→犬→人に即時切替できる', () => {
  const run = newRun(testCourse(), 'shiba', free);
  const finger = 981;
  advanceRun(run, 260_000, [down(finger, jumpAt), { kind: 'forward', atUs: jumpAt, strokeId: finger },
    turn(finger, jumpAt + 1_000, 1, [0, 0.7, 0], 'common'),
    turn(finger, jumpAt + 30_000, 2, [0, 0.7, 0], 'dog'),
    turn(finger, jumpAt + 45_000, 3, [0, 0.7, 0], 'rider')]);
  const motion = run.freeFlight!.motion;
  expect(motion.omega.common[1]).toBeGreaterThan(0);
  expect(motion.omega.dog[1]).toBeGreaterThan(0);
  expect(motion.omega.rider[1]).toBeGreaterThan(0);
  expect(run.strokes[finger]).toMatchObject({ tag: 'air', freeTarget: 'rider', jumpId: run.jump?.jumpId });
});
