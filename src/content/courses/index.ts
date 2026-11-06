import type { CourseDef, CourseId } from '../types';
import { buildCourse, type CourseRt } from '../../game/track';
import { park } from './park';
import { shoppingStreet } from './shopping-street';
import { riverside } from './riverside';

export const COURSE_DEFS: Partial<Record<CourseId, CourseDef>> = {
  park,
  'shopping-street': shoppingStreet,
  riverside,
};

/** ホームで選べる競技用のコース（練習広場は別）。 */
export const RACE_COURSES: CourseId[] = ['park', 'shopping-street', 'riverside'];

const cache = new Map<string, CourseRt>();

/** 組み立てたコースを返す（同じ版は使い回す）。 */
export function getCourse(id: CourseId): CourseRt {
  const def = COURSE_DEFS[id];
  if (!def) throw new Error(`unknown course ${id}`);
  const key = `${id}@${def.version}`;
  let c = cache.get(key);
  if (!c) {
    c = buildCourse(def);
    cache.set(key, c);
  }
  return c;
}
