import { describe, expect, test } from 'vitest';
import { deliverContacts, advanceRun, forceFall } from '../src/game/run';
import { timeScore, totalScore, trickScore } from '../src/game/scoring';
import { sectionAt } from '../src/game/track';
import { toCentiseconds } from '../src/game/rules';
import { Autopilot } from '../src/game/autopilot';
import { newRun, testCourse } from './helpers';
import type { Candidate } from '../src/game/tricks';
import type { PathDef, RouteStep } from '../src/content/types';
import type { SimState } from '../src/game/types';

/** 空中で、犬・横転＋右ひねりの複合（回り切っている）を持つ状態を作る。 */
function airborneWithComposite(run: SimState, takeoffUs: number): void {
  const dog: Candidate = { kind: 'dog', strokeId: 1, establishedUs: takeoffUs + 150_000, vertical: false, clockwise: true };
  const body: Candidate = { kind: 'body', strokeId: 2, establishedUs: takeoffUs + 150_000, dir8: 2, afterCircle: false };
  run.mode = 'air';
  run.jumpCounter += 1;
  run.jump = { jumpId: run.jumpCounter, takeoffUs, kind: 'flat', fromRail: null, strokes: [1, 2], resolution: { rotations: [], held: [], rejected: [], composite: false } };
  run.strokes[1] = { strokeId: 1, downUs: takeoffUs + 50_000, upUs: takeoffUs + 160_000, cancelled: false, tag: 'air', jumpId: run.jumpCounter, baseTargetX: 0, consumed: false, candidates: [dog] };
  run.strokes[2] = { strokeId: 2, downUs: takeoffUs + 50_000, upUs: takeoffUs + 150_000, cancelled: false, tag: 'air', jumpId: run.jumpCounter, baseTargetX: 0, consumed: false, candidates: [body] };
  run.basePitch = 0;
}

describe('V10 ゴールの境界', () => {
  const cases: [number, number][] = [
    [76_001_000, 420],
    [76_002_000, 420],
    [76_004_000, 0],
  ];
  for (const [landUs, expected] of cases) {
    for (const order of ['landFirst', 'goalFirst'] as const) {
      test(`ゴール 76.002 秒・着地 ${landUs / 1e6} 秒（通知の順: ${order}）→ 記録 76.00 秒、その技点は ${expected}`, () => {
        const run = newRun(testCourse({ goalU: 390 }));
        run.s = 100;
        airborneWithComposite(run, 75_000_000);
        const land = { type: 'land' as const, atUs: landUs };
        const goal = { type: 'goal' as const, atUs: 76_002_000 };
        deliverContacts(run, order === 'landFirst' ? [land, goal] : [goal, land]);
        // 終了と着地の再通知は数えない。
        deliverContacts(run, [goal, land]);
        expect(run.result).not.toBeNull();
        expect(run.result!.recordCs).toBe(7600);
        expect(run.result!.trickScore).toBe(expected);
        expect(run.events.filter((e) => e.kind === 'goal').length).toBe(1);
      });
    }
  }

  test('完走の記録だけを 0.01 秒に丸める（0.005 秒ちょうどは上へ）', () => {
    expect(toCentiseconds(76_002_000)).toBe(7600);
    expect(toCentiseconds(76_004_999)).toBe(7600);
    expect(toCentiseconds(76_005_000)).toBe(7601);
    expect(toCentiseconds(59_995_000)).toBe(6000);
  });
});

/** 共通 A → 分岐（B または C、同じ採点機会）→ 共通 D…H のコース。 */
function branchCourse() {
  const paths: PathDef[] = [
    {
      id: 'pa',
      u0: 0,
      u1: 100,
      halfWidth: 4,
      next: {
        kind: 'fork',
        forkId: 'F',
        options: [
          { to: 'pb', xMin: -99, xMax: 0, label: 'B' },
          { to: 'pc', xMin: 0, xMax: 99, label: 'C' },
        ],
      },
    },
    { id: 'pb', u0: 100, u1: 200, offset: [{ u: 100, v: -2 }], halfWidth: 2, next: { kind: 'path', to: 'pd' }, route: 'B' },
    { id: 'pc', u0: 100, u1: 200, offset: [{ u: 100, v: 2 }], halfWidth: 2, next: { kind: 'path', to: 'pd' }, route: 'C' },
    { id: 'pd', u0: 200, u1: 900, halfWidth: 4, edges: ['wall', 'drop'], next: { kind: 'end' } },
  ];
  return testCourse({
    segs: [{ len: 900 }],
    paths,
    goalU: 880,
    objects: [{ kind: 'checkpoint', id: 'cp-a', path: 'pa', u: 70, x: 0 }],
    sections: [
      { path: 'pa', u0: 0, u1: 100, opp: 'A' },
      { path: 'pb', u0: 100, u1: 200, opp: 'BC' },
      { path: 'pc', u0: 100, u1: 200, opp: 'BC' },
      { path: 'pd', u0: 200, u1: 300, opp: 'D' },
      { path: 'pd', u0: 300, u1: 400, opp: 'E' },
      { path: 'pd', u0: 400, u1: 500, opp: 'F' },
      { path: 'pd', u0: 500, u1: 600, opp: 'G' },
      { path: 'pd', u0: 600, u1: 900, opp: 'H' },
    ],
  });
}

const spinAt = (u: number): RouteStep[] => [
  { at: u, jump: true },
  { at: u, trick: { afterUs: 30_000, dog: { vertical: false, clockwise: true } } },
];

function drive(run: SimState, steps: RouteStep[], untilUs = 120_000_000, hook?: (run: SimState) => void): void {
  const pilot = new Autopilot(steps);
  let t = run.simUs;
  while (!run.finished && t < untilUs) {
    const f = pilot.poll(run);
    advanceRun(run, (t += 5_000), f);
    hook?.(run);
  }
}

describe('V11 区間と連続', () => {
  test('A・B・D で成功すると連続 100 点。未選択の C は失敗に数えない', () => {
    const run = newRun(branchCourse());
    drive(run, [{ at: 3, steer: -1 }, ...spinAt(50), ...spinAt(150), ...spinAt(250)]);
    expect(run.result!.streakBonus).toBe(100);
    expect(run.result!.sections.find((s) => s.opp === 'BC')!.state).toBe('scored');
    expect(run.score.missedOpps).not.toContain('BC');
  });

  test('B に入って技を決めずに D へ行くと、連続の加点は 0', () => {
    const run = newRun(branchCourse());
    drive(run, [{ at: 3, steer: -1 }, ...spinAt(50), ...spinAt(250)]);
    expect(run.result!.streakBonus).toBe(0);
    expect(run.score.missedOpps).toContain('BC');
  });

  test('落下して分岐を再訪し、反対側の C を通っても、同じ採点機会は取り直せない', () => {
    const run = newRun(branchCourse());
    let fell = false;
    drive(run, [{ at: 3, steer: -1 }, ...spinAt(50), ...spinAt(150), { at: 205, steer: 0 }], 30_000_000, (r) => {
      if (!fell && r.pathId === 'pd' && r.s > 20 && r.mode === 'ground') {
        fell = true;
        forceFall(r, r.simUs);
      }
    });
    expect(fell).toBe(true);
    const pointsBefore = run.score.jumpPoints;
    expect(run.score.scoredOpps.BC).toBeTruthy();
    // 復帰後は C を通り、C で技を決める。
    drive(run, [{ at: 72, steer: 1 }, ...spinAt(150)]);
    const onC = run.score.jumps.filter((j) => j.sectionKey?.startsWith('pc'));
    expect(onC.length).toBe(1);
    expect(onC[0].awarded).toBe(0);
    expect(run.score.jumpPoints).toBe(pointsBefore);
  });

  test('区間ちょうどの着地は、次の区間だけに付く（開始線を含み、終了線を含まない）', () => {
    const course = branchCourse();
    const pd = course.paths.get('pd')!;
    const boundary = pd.sections[1].s0Mm;
    expect(sectionAt(pd, boundary)!.opp).toBe('E');
    expect(sectionAt(pd, boundary - 1)!.opp).toBe('D');
    const run = newRun(course);
    run.pathId = 'pd';
    run.s = boundary / 1000;
    run.y = 0;
    airborneWithComposite(run, 10_000_000);
    deliverContacts(run, [{ type: 'land', atUs: 11_000_000 }]);
    expect(run.score.scoredOpps.E).toBeTruthy();
    expect(run.score.scoredOpps.D).toBeUndefined();
  });

  test('選んだ道の異なる 6 区間を連続で成功すると、連続分は 200 点', () => {
    const run = newRun(branchCourse());
    drive(run, [{ at: 3, steer: -1 }, ...spinAt(50), ...spinAt(150), ...spinAt(250), ...spinAt(350), ...spinAt(450), ...spinAt(550)]);
    expect(run.result!.streakBonus).toBe(200);
  });

  test('同じ区間で普通のジャンプ → 成功技 → 別の成功技と続けると、最初の成功技だけが入る', () => {
    const run = newRun(branchCourse());
    drive(run, [{ at: 3, steer: -1 }, { at: 20, jump: true }, ...spinAt(40), ...spinAt(70)]);
    const inA = run.score.jumps.filter((j) => j.opp === 'A');
    expect(inA.length).toBe(2);
    expect(inA[0].awarded).toBeGreaterThan(0);
    expect(inA[1].awarded).toBe(0);
    expect(run.score.scoredOpps.A.points).toBe(inA[0].awarded);
  });
});

describe('V12 採点', () => {
  test('公園の 60.00／60.01／109.99／110.00 秒はタイム点 5000／4999／1／0', () => {
    expect(timeScore(6000, 6000, 11000)).toBe(5000);
    expect(timeScore(6001, 6000, 11000)).toBe(4999);
    expect(timeScore(10999, 6000, 11000)).toBe(1);
    expect(timeScore(11000, 6000, 11000)).toBe(0);
    expect(timeScore(5000, 6000, 11000)).toBe(5000);
    expect(timeScore(13000, 6000, 11000)).toBe(0);
  });

  test('76 秒＋技 1,200 点は 4,600、80 秒＋技 1,800 点は 4,800', () => {
    expect(totalScore(timeScore(7600, 6000, 11000), 1200)).toBe(4600);
    expect(totalScore(timeScore(8000, 6000, 11000), 1800)).toBe(4800);
  });

  test('技点の上限 5,000、総合の上限 10,000', () => {
    expect(totalScore(5000, 7000)).toBe(10000);
    expect(totalScore(5000, 5000)).toBe(10000);
    const sc = { jumpPoints: 4700, railPoints: 300, streakBonus: 400 } as Parameters<typeof trickScore>[0];
    expect(trickScore(sc)).toBe(5000);
  });

  test('ほかのコースの基準でも、同じ式で整数に四捨五入する', () => {
    // 5000 × (8800 − 6700) ÷ (8800 − 4600) = 2500
    expect(timeScore(6700, 4600, 8800)).toBe(2500);
    // 5000 × 1 ÷ 3 = 1666.67 → 1667
    expect(timeScore(8799, 8797, 8800)).toBe(1667);
  });
});
