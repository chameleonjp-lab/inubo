import type { CourseDef } from '../types';

/**
 * 練習広場。時間を競わない周回の道。踏切台を多めに置き、長い滞空で技を試せる。
 * ゴールはなく、記録も作らない（練習の記録は競技記録と分ける）。
 */
export const practicePlaza: CourseDef = {
  id: 'practice',
  version: 'plaza-2',
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
  objects: [15, 38, 63, 88, 114, 140, 166, 192, 218, 244, 270, 296, 321, 346].map((u0, i) => ({
    kind: 'kicker', id: `pk-${i + 1}`, path: 'loop', u0, u1: u0 + 4, x0: -1.5, x1: 1.5, height: 0.6,
  })),
  sections: [{ path: 'loop', u0: 0, u1: 360, opp: 'P' }],
  timeScore: { fullCs: 1, zeroCs: 2, provisional: true },
  challenge: null,
  autoRoutes: {},
};
