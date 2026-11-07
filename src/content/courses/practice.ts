import type { CourseDef } from '../types';

/**
 * 練習広場。時間を競わない周回の道。踏切台を多めに置き、長い滞空で技を試せる。
 * ゴールはなく、記録も作らない（練習の記録は競技記録と分ける）。
 */
export const practicePlaza: CourseDef = {
  id: 'practice',
  version: 'plaza-1',
  name: '練習広場',
  theme: 'plaza',
  spine: {
    start: [0, 0],
    heading: -90,
    segs: [{ len: 80 }, { len: 30, turn: 90 }, { len: 40 }, { len: 30, turn: 90 }, { len: 80 }, { len: 30, turn: 90 }, { len: 40 }, { len: 30, turn: 90 }],
  },
  height: [{ u: 0, v: 0 }],
  paths: [{ id: 'loop', u0: 0, u1: 360, halfWidth: 5, next: { kind: 'path', to: 'loop' } }],
  start: { path: 'loop', u: 3 },
  goal: null,
  objects: [
    { kind: 'kicker', id: 'pk-1', path: 'loop', u0: 30, u1: 34, x0: -1.5, x1: 1.5, height: 0.6 },
    { kind: 'kicker', id: 'pk-2', path: 'loop', u0: 62, u1: 66, x0: -1.5, x1: 1.5, height: 0.6 },
    { kind: 'kicker', id: 'pk-3', path: 'loop', u0: 140, u1: 144, x0: -1.5, x1: 1.5, height: 0.6 },
    { kind: 'kicker', id: 'pk-4', path: 'loop', u0: 210, u1: 214, x0: -1.5, x1: 1.5, height: 0.6 },
    { kind: 'kicker', id: 'pk-5', path: 'loop', u0: 242, u1: 246, x0: -1.5, x1: 1.5, height: 0.6 },
    { kind: 'kicker', id: 'pk-6', path: 'loop', u0: 320, u1: 324, x0: -1.5, x1: 1.5, height: 0.6 },
  ],
  sections: [{ path: 'loop', u0: 0, u1: 360, opp: 'P' }],
  timeScore: { fullCs: 1, zeroCs: 2, provisional: true },
  challenge: null,
  autoRoutes: {},
};
