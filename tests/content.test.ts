import { describe, expect, test } from 'vitest';
import { COURSE_DEFS, RACE_COURSES, getCourse } from '../src/content/courses/index';
import { DOGS, DOG_ORDER } from '../src/content/dogs';
import { buildCourse, baseHeight, hwAt, supportHeight, solidTop } from '../src/game/track';
import { runWithAutopilot } from '../src/game/autopilot';
import { advanceRun } from '../src/game/run';
import { BASE_SPEED, BODY_ROT_US, DOG_SPIN_US, FOOT_FRONT, FOOT_HALF_WIDTH, JUMP_VY } from '../src/game/rules';
import { maxSpeed } from '../src/game/motion';
import { newRun, testCourse } from './helpers';
import type { CourseId, DogId } from '../src/content/types';

describe('コースのデータ', () => {
  for (const id of RACE_COURSES) {
    const def = COURSE_DEFS[id]!;
    test(`${def.name}: 識別子の重複がなく、道はすべてゴールへつながり、行き止まりがない`, () => {
      const ids = def.objects.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      const pathIds = def.paths.map((p) => p.id);
      expect(new Set(pathIds).size).toBe(pathIds.length);
      const course = buildCourse(def);
      // 開始の道からたどれる道
      const reach = new Set<string>();
      const stack = [def.start.path];
      while (stack.length) {
        const id = stack.pop()!;
        if (reach.has(id)) continue;
        reach.add(id);
        const p = course.paths.get(id)!;
        if (p.next.kind === 'path') stack.push(p.next.to);
        if (p.next.kind === 'fork') for (const o of p.next.options) stack.push(o.to);
      }
      expect([...reach].sort()).toEqual([...pathIds].sort());
      // どの道からもゴールの道に着く（end で終わるのはゴールの道だけ）
      for (const p of course.paths.values()) {
        if (p.next.kind === 'end') expect(p.id).toBe(def.goal!.path);
      }
      expect(course.goal!.s).toBeLessThan(course.paths.get(def.goal!.path)!.length);
    });

    test(`${def.name}: 採点区間は各道を隙間なく覆い、分岐の左右は同じ採点機会の番号を持つ`, () => {
      const course = getCourse(id);
      for (const p of course.paths.values()) {
        expect(p.sections.length).toBeGreaterThan(0);
        expect(p.sections[0].s0Mm).toBe(0);
        for (let i = 1; i < p.sections.length; i++) expect(p.sections[i].s0Mm).toBe(p.sections[i - 1].s1Mm);
        expect(p.sections[p.sections.length - 1].s1Mm).toBe(Math.round(p.length * 1000));
      }
      for (const p of course.paths.values()) {
        if (p.next.kind !== 'fork') continue;
        const opps = p.next.options.map((o) => course.paths.get(o.to)!.sections.map((s) => s.opp).join(','));
        expect(new Set(opps).size).toBe(1);
      }
    });

    test(`${def.name}: 復帰地点は路面の上にあり、物の中や宙に浮いた位置にない`, () => {
      const course = getCourse(id);
      for (const p of course.paths.values()) {
        for (const cp of p.checkpoints) {
          expect(Math.abs(cp.x)).toBeLessThanOrEqual(hwAt(p, cp.s) - 0.3);
          const ground = baseHeight(p, cp.s);
          expect(supportHeight(p, cp.s, cp.x, ground + 0.01, 0)).toBeCloseTo(ground, 6);
          for (const so of p.solids) {
            const inside = cp.s > so.s0 - FOOT_FRONT && cp.s < so.s1 && cp.x > so.x0 - FOOT_HALF_WIDTH && cp.x < so.x1 + FOOT_HALF_WIDTH;
            if (inside) expect(solidTop(p, so, cp.s, 0)).toBeLessThanOrEqual(ground + 0.18);
          }
        }
      }
    });

    test(`${def.name}: 同じコース・同じ版なら、アイテムの位置と種類はすべて一致する（R47）`, () => {
      const a = buildCourse(def);
      const b = buildCourse(def);
      expect([...a.itemsById.values()]).toEqual([...b.itemsById.values()]);
    });
  }

  test('公園だけを競技に使い、旧版の倍の距離、35 基の踏切台、18 の採点区間を持つ', () => {
    expect(RACE_COURSES).toEqual(['park']);
    const course = getCourse('park');
    expect(course.progressLength).toBe((760 - 3) * 2);
    expect(course.def.objects.filter((o) => o.kind === 'kicker')).toHaveLength(5 + 30);
    expect(course.opportunities).toHaveLength(18);
    for (const dog of DOG_ORDER) {
      const base = BASE_SPEED * DOGS[dog].speedIndex / 100;
      expect(maxSpeed(newRun(course, dog))).toBeCloseTo(base * 1.5);
      expect(maxSpeed(newRun(getCourse('practice'), dog))).toBeCloseTo(base);
    }
  });
});

describe('公園を 3 犬種で完走（技を使わない走り）', () => {
  for (const cid of RACE_COURSES) {
    for (const dog of DOG_ORDER) {
      test(`${COURSE_DEFS[cid]!.name} × ${DOGS[dog].name}`, () => {
        const course = getCourse(cid);
        const run = newRun(course, dog, { courseId: cid, courseVersion: course.def.version });
        runWithAutopilot(run, course.def.autoRoutes.safe);
        expect(run.finished).toBe(true);
        expect(run.result!.trickScore).toBe(0);
        if (cid === 'park') {
          expect(run.result!.recordCs).toBeGreaterThanOrEqual(8000);
          expect(run.result!.recordCs).toBeLessThanOrEqual(12000);
        }
      });
    }
  }
});

describe('公園の近道と技の道', () => {
  for (const dog of DOG_ORDER) {
    test(`${DOGS[dog].name}: 近道は最速、技の道は総合点で勝つ`, () => {
      const course = getCourse('park');
      const short = newRun(course, dog);
      const trick = newRun(course, dog);
      runWithAutopilot(short, course.def.autoRoutes.short);
      runWithAutopilot(trick, course.def.autoRoutes.trick);
      expect(short.result!.recordCs).toBeLessThan(trick.result!.recordCs);
      expect(trick.result!.total).toBeGreaterThan(short.result!.total);
      expect(trick.result!.challengeDone).toBe(true);
    });
  }

  test('公園の技の道を全犬種が完走できる', () => {
    for (const cid of RACE_COURSES) {
      for (const dog of DOG_ORDER) {
        const course = getCourse(cid as CourseId);
        const run = newRun(course, dog as DogId);
        runWithAutopilot(run, course.def.autoRoutes.trick);
        expect(run.finished, `${cid} ${dog}`).toBe(true);
        expect(run.result!.trickScore, `${cid} ${dog}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('犬種の性能（R32〜R35）', () => {
  test('平地・効果なしの最高速はコーギー・柴犬・ウィペットの順に 93・100・107', () => {
    const speeds = DOG_ORDER.map((dog) => {
      const run = newRun(testCourse(), dog);
      let t = 0;
      while (t < 5_000_000) advanceRun(run, (t += 5_000));
      return run.baseSpeed;
    });
    expect(speeds.map((v) => Math.round(v * 10))).toEqual([100, 93, 107]);
  });

  test('ジャンプの高さ・回転時間・接触の大きさ・基礎点は全犬種で共通', () => {
    // 犬種の定義に、ジャンプや接触や回転の値を持たせていない。
    for (const d of Object.values(DOGS)) {
      expect(Object.keys(d).sort()).toEqual(['handlingIndex', 'id', 'look', 'name', 'speedIndex']);
    }
    expect(JUMP_VY).toBeGreaterThan(0);
    expect(DOG_SPIN_US).toBeGreaterThan(0);
    expect(BODY_ROT_US).toBeGreaterThan(0);
    // 同じ位置からの同じジャンプで、頂点の高さが同じ。
    const apexes = DOG_ORDER.map((dog) => {
      const run = newRun(testCourse(), dog);
      let t = 0;
      while (t < 2_000_000) advanceRun(run, (t += 5_000));
      advanceRun(run, (t += 5_000), [
        { kind: 'down', atUs: t - 5_000, strokeId: 1 },
        { kind: 'forward', atUs: t - 5_000, strokeId: 1 },
      ]);
      let best = 0;
      while (t < 3_500_000) {
        advanceRun(run, (t += 5_000));
        best = Math.max(best, run.y);
      }
      return best;
    });
    expect(apexes[1]).toBeCloseTo(apexes[0], 9);
    expect(apexes[2]).toBeCloseTo(apexes[0], 9);
  });

  test('最初から全犬種を選べる（解放の条件を持たない）', () => {
    expect(DOG_ORDER).toEqual(['shiba', 'corgi', 'whippet']);
  });
});
