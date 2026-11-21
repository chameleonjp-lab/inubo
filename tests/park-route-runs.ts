import { describe, expect, test } from 'vitest';
import { getCourse } from '../src/content/courses/index';
import { DOG_ORDER } from '../src/content/dogs';
import { Autopilot, runWithAutopilot } from '../src/game/autopilot';
import { FOOT_FRONT, FOOT_HALF_WIDTH, TICK_US } from '../src/game/rules';
import { advanceRun } from '../src/game/run';
import { baseHeight, gatePhase, solidTop } from '../src/game/track';
import { newRun } from './helpers';

const course = getCourse('park');
const { safe, short, trick } = course.def.autoRoutes;

describe('開始線から2つの分岐を選んで完走する', () => {
  for (const dog of DOG_ORDER) {
    for (const [first, firstLabel] of [[safe, '脇の坂'], [short, '中央の階段'], [trick, '手すり']] as const) {
      for (const [second, secondLabel] of [[safe, '短い平道'], [trick, '手すり道']] as const) {
        test(`${dog}・${firstLabel}→${secondLabel}`, () => {
          const run = newRun(course, dog);
          runWithAutopilot(run, [
            ...first.filter(step => step.at < 286),
            ...safe.filter(step => step.at >= 286 && step.at < 410),
            ...second.filter(step => step.at >= 410 && step.at < 500),
            ...safe.filter(step => step.at >= 500),
          ]);
          expect(run.finished).toBe(true);
          expect(run.route).toEqual([firstLabel, secondLabel]);
        });
      }
    }
  }
});

describe('通常ジャンプで追加の手すりに乗り、端から着地して得点する', () => {
  for (const dog of DOG_ORDER) {
    for (const [id, pathId, steerAt, x, jumpAt] of [
      ['rail-v3-01', 'f1-rail', 215, -1.6, 246],
      ['rail-v3-02', 'f1-rail', 215, 1.6, 259],
      ['rail-v3-03', 'f2-rail', 421, -1.35, 430],
      ['rail-v3-04', 'f2-rail', 421, 1.35, 471],
    ] as const) {
      test(`${dog}・${id}`, () => {
        const pilot = new Autopilot([
          ...trick.filter(step => step.at < steerAt),
          { at: steerAt, path: pathId, steer: x },
          { at: jumpAt, path: pathId, jump: true },
        ]);
        const run = newRun(course, dog);
        do {
          advanceRun(run, run.simUs + TICK_US, pilot.poll(run));
        } while (!run.finished && run.simUs < 240_000_000 && !run.score.scoredRails[id]);
        const events = run.events.filter(e => e.objId === id && e.pathId === pathId);
        expect(events.map(e => e.kind)).toEqual(['railOn', 'railOff', 'railScore']);
        const takeoff = run.events.filter(e => e.kind === 'jump' && e.seq < events[0].seq).at(-1);
        expect(takeoff).toMatchObject({ pathId, data: { kind: 'flat', viaSwipe: true } });
        expect(events[1].data?.reason).toBe('end');
        expect(events[2].data?.points).toBeGreaterThan(0);
        expect(run.events.some(e => e.kind === 'land' && e.atUs === events[2].atUs)).toBe(true);
      });
    }
  }
});

describe('走行中に障害物を通過する高さと横位置', () => {
  for (const [id, dog, route, move] of [
    ['fence-1', 'shiba', safe, 'jump'],
    ['wall-1', 'shiba', safe, 'bypass'],
    ['gate-1', 'shiba', safe, 'jump'],
    ['gate-v3-01', 'whippet', short, 'bypass'],
    ['gate-v3-02', 'whippet', short, 'bypass'],
  ] as const) {
    test(`${id}・${move}`, () => {
      const solid = course.solidsById.get(id)!;
      const path = course.paths.get(solid.pathId)!;
      const run = newRun(course, dog);
      const pilot = new Autopilot(route);
      let crossed = false;
      let samples = 0;
      while (!run.finished && run.simUs < 240_000_000) {
        advanceRun(run, run.simUs + TICK_US, pilot.poll(run));
        if (run.pathId !== path.id || run.s + FOOT_FRONT < solid.s0) continue;
        if (run.s > solid.s1) {
          crossed = true;
          break;
        }
        samples++;
        if (move === 'jump') {
          expect(run.mode).toBe('air');
          // 最高速で到着時刻が変わっても、閉じたゲートを跳び越せる高さを検証する。
          const top = solid.gate ? baseHeight(path, run.s) + solid.height : solidTop(path, solid, run.s, run.simUs);
          expect(run.y).toBeGreaterThan(top);
        } else {
          if (solid.gate) expect(gatePhase(solid.gate, run.simUs).phase).toBe('up');
          expect(run.mode).toBe('ground');
          expect(run.x + FOOT_HALF_WIDTH < solid.x0 || run.x - FOOT_HALF_WIDTH > solid.x1).toBe(true);
        }
      }
      expect(samples).toBeGreaterThan(0);
      expect(crossed).toBe(true);
      expect(run.events.filter(e => e.kind === 'collide' && e.objId === id)).toEqual([]);
    });
  }
});
