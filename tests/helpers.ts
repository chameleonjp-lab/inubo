import { buildCourse, type CourseRt } from '../src/game/track';
import { createRun, advanceRun } from '../src/game/run';
import { DOGS } from '../src/content/dogs';
import { RULES_VERSION } from '../src/game/rules';
import type { CourseDef, DogId, Key, ObjectDef, PathDef, SectionDef, SpineSeg } from '../src/content/types';
import type { GestureFact, RunIdentity, SimState } from '../src/game/types';

let runCounter = 0;

export function identity(over: Partial<RunIdentity> = {}): RunIdentity {
  return {
    runId: `run-${++runCounter}`,
    courseId: 'park',
    courseVersion: 'test-1',
    rulesVersion: RULES_VERSION,
    dogId: 'shiba',
    mode: 'competition',
    playerName: '',
    rankingOptIn: false,
    participantId: null,
    outfit: { clothes: '#d33', helmet: '#33d' },
    ...over,
  };
}

export interface TestCourseOptions {
  segs?: SpineSeg[];
  objects?: ObjectDef[];
  sections?: SectionDef[];
  paths?: PathDef[];
  height?: Key[];
  halfWidth?: number;
  edges?: PathDef['edges'];
  goalU?: number | null;
  startU?: number;
  timeScore?: CourseDef['timeScore'];
}

/** 試験用のまっすぐな（または指定の形の）コース。 */
export function testCourse(o: TestCourseOptions = {}): CourseRt {
  const segs = o.segs ?? [{ len: 400 }];
  const total = segs.reduce((a, s) => a + s.len, 0);
  const def: CourseDef = {
    id: 'park',
    version: 'test-1',
    name: 'test',
    theme: 'park',
    spine: { start: [0, 0], heading: -90, segs },
    height: o.height ?? [{ u: 0, v: 0 }],
    paths: o.paths ?? [{ id: 'main', u0: 0, u1: total, halfWidth: o.halfWidth ?? 4, edges: o.edges, next: { kind: 'end' } }],
    start: { path: o.paths ? o.paths[0].id : 'main', u: o.startU ?? 2 },
    goal: o.goalU === null ? null : { path: o.paths ? o.paths[o.paths.length - 1].id : 'main', u: o.goalU ?? total - 10 },
    objects: o.objects ?? [],
    sections: o.sections ?? [{ path: 'main', u0: 0, u1: total, opp: 'X' }],
    timeScore: o.timeScore ?? { fullCs: 6000, zeroCs: 11000, provisional: false },
    challenge: null,
    autoRoutes: {},
  };
  return buildCourse(def);
}

export function newRun(course: CourseRt, dogId: DogId = 'shiba', over: Partial<RunIdentity> = {}): SimState {
  return createRun(identity({ dogId, ...over }), course, DOGS[dogId]);
}

/** 描画の間隔 stepUs で、時刻 untilUs まで進める。 */
export function runTo(run: SimState, untilUs: number, facts: GestureFact[] = [], stepUs = 16_667): void {
  let first = true;
  let t = Math.max(run.simUs, 0);
  while (t < untilUs && !run.finished) {
    t = Math.min(untilUs, t + stepUs);
    advanceRun(run, t, first ? facts : []);
    first = false;
  }
}

let sid = 500_000;

/** 地上の前払い（ジャンプ）。 */
export function jumpFacts(atUs: number): GestureFact[] {
  const id = sid++;
  return [
    { kind: 'down', atUs, strokeId: id },
    { kind: 'forward', atUs, strokeId: id },
    { kind: 'up', atUs: atUs + 1, strokeId: id, cancelled: false },
  ];
}

/** 地上の横払い（目標位置を base から dx×STEER_GAIN だけ動かす）。 */
export function steerFacts(atUs: number, dx: number): GestureFact[] {
  const id = sid++;
  return [
    { kind: 'down', atUs, strokeId: id },
    { kind: 'steer', atUs, strokeId: id, dx },
    { kind: 'up', atUs: atUs + 1, strokeId: id, cancelled: false },
  ];
}

/** 空中の犬だけの回転（円）。 */
export function dogSpinFacts(atUs: number, vertical = false, clockwise = true, closeAfterUs = 150_000): GestureFact[] {
  const id = sid++;
  return [
    { kind: 'down', atUs, strokeId: id },
    { kind: 'circle', atUs: atUs + closeAfterUs, strokeId: id, vertical, clockwise, aspect: vertical ? 1.4 : 1 },
    { kind: 'up', atUs: atUs + closeAfterUs + 10_000, strokeId: id, cancelled: false },
  ];
}

/** 空中の体ごとの回転（直線）。 */
export function bodyFacts(atUs: number, dir8: number, releaseAfterUs = 100_000): GestureFact[] {
  const id = sid++;
  return [
    { kind: 'down', atUs, strokeId: id },
    { kind: 'line', atUs: atUs + releaseAfterUs, strokeId: id, dir8, afterCircle: false },
    { kind: 'up', atUs: atUs + releaseAfterUs, strokeId: id, cancelled: false },
  ];
}

export function count(run: SimState, kind: string): number {
  return run.events.filter((e) => e.kind === kind).length;
}

export function eventsOf(run: SimState, kind: string) {
  return run.events.filter((e) => e.kind === kind);
}
