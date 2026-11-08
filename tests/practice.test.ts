import { describe, expect, it } from 'vitest';
import { getCourse } from '../src/content/courses';
import { DOGS, DOG_ORDER } from '../src/content/dogs';
import { RULES_VERSION } from '../src/game/rules';
import { advanceRun, createRun } from '../src/game/run';
import type { RunIdentity, SimEvent } from '../src/game/types';
import * as practice from '../src/ui/practice';
import { GestureRecognizer } from '../src/input/gestures';

const course = getCourse('practice');
const identity: RunIdentity = {
  runId: 'practice-test', courseId: 'practice', courseVersion: course.def.version, rulesVersion: RULES_VERSION,
  dogId: 'shiba', mode: 'practice', playerName: '', rankingOptIn: false, participantId: null,
  outfit: { clothes: '', helmet: '' },
};

describe('練習広場', () => {
  it('5番のガイドを1本の指で円から線へなぞり、着地すると練習を完了できる', () => {
    const guide = practice.practiceGuide('composite', true);
    const points = guide.flatMap((stroke) => [...stroke.points]);
    for (const dogId of DOG_ORDER) {
      const ride = createRun({ ...identity, dogId }, course, DOGS[dogId]);
      while (ride.mode !== 'air') advanceRun(ride, ride.simUs + 5000);
      const start = ride.simUs + 100_000;
      const input = new GestureRecognizer();
      const facts = points.flatMap(([x, y], i) => {
        const at = start + Math.round(500_000 * i / (points.length - 1));
        if (i === 0) return input.pointerDown(1, x, y, at);
        if (i === points.length - 1) return input.pointerUp(1, x, y, at);
        return input.pointerMove(1, x, y, at);
      });
      const coach = new practice.PracticeCoach();
      for (let i = 0; i < 4; i++) coach.next();
      const { events } = advanceRun(ride, start + 1_500_000, facts);
      expect(events.find((e) => e.kind === 'land')?.data?.composite).toBe(true);
      expect(coach.observe(events, ride)).toBe(true);
      expect(coach.done).toBe(true);
    }
  });
  it('スタート近くから踏切台が並び、周回しても長く待たずにもう一度試せる', () => {
    const path = course.paths.get(course.start.pathId)!;
    const ramps = path.solids.filter((s) => s.kind === 'kicker').map((s) => s.s0).sort((a, b) => a - b);
    expect(ramps[0] - course.start.s).toBeLessThan(15);
    expect(Math.max(...ramps.map((s, i) => (ramps[i + 1] ?? ramps[0] + path.length) - s))).toBeLessThanOrEqual(30);
  });

  it('ジャンプの練習は踏切台を通っただけでは進まず、指で上に払うと進む', () => {
    const coach = new practice.PracticeCoach();
    coach.next();
    const ride = createRun(identity, course, DOGS.shiba);
    const { events } = advanceRun(ride, 3_000_000);
    expect(events.some((e) => e.kind === 'jump')).toBe(true);
    expect(coach.observe(events, ride)).toBe(false);
    const swipe = new practice.PracticeDemo('jump', identity, course, DOGS.shiba);
    expect(coach.observe(swipe.advanceTo(500_000), swipe.state)).toBe(true);
  });

  it.each(['lateral', 'jump', 'dog', 'body', 'composite'] as const)('手本 %s の指の線から実際の動きが成立する', (step) => {
    for (const dogId of DOG_ORDER) {
      const demo = new practice.PracticeDemo(step, { ...identity, dogId }, course, DOGS[dogId]);
      const events: SimEvent[] = [];
      let minX = 0, maxX = 0;
      let tracedAtTakeoff = false;
      let tracedAtTrick = false;
      for (let us = 0; us <= demo.durationUs; us += 10_000) {
        const frame = demo.advanceTo(us);
        events.push(...frame);
        minX = Math.min(minX, demo.state.x);
        maxX = Math.max(maxX, demo.state.x);
        if (frame.some((e) => e.kind === 'jump')) tracedAtTakeoff = demo.traces.some((t) => t.progress > 0 && t.progress < 1);
        if (frame.some((e) => e.kind === 'trickStart')) tracedAtTrick = demo.traces.some((t) => t.progress >= 0.8);
      }
      if (step === 'lateral') {
        expect(minX).toBeLessThan(-1.2);
        expect(maxX).toBeGreaterThan(1.2);
      } else {
        expect(events.some((e) => e.kind === 'jump' && e.data?.kind === 'kicker')).toBe(true);
        expect(tracedAtTakeoff).toBe(true);
        if (step !== 'jump') {
          const land = events.find((e) => e.kind === 'land');
          expect(tracedAtTrick).toBe(true);
          expect(Number(land?.data?.tenths)).toBeGreaterThan(0);
          expect(events.filter((e) => e.kind === 'trickStart').map((e) => e.data?.channel).sort()).toEqual(step === 'composite' ? ['body', 'dog'] : [step]);
          expect(!!land?.data?.composite).toBe(step === 'composite');
        }
      }
    }
  });
});
