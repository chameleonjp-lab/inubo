import type { CourseDef, CourseId } from '../types';
import { buildCourse, type CourseRt } from '../../game/track';
import { park } from './park';
import { parkFreestyle } from './park-freestyle';
import { shoppingStreet } from './shopping-street';
import { riverside } from './riverside';
import { practicePlaza } from './practice';

export const COURSE_DEFS: Partial<Record<CourseId, CourseDef>> = {
  park,
  'shopping-street': shoppingStreet,
  riverside,
  practice: practicePlaza,
};

/** 公開中の競技コース（練習広場は別）。 */
export const RACE_COURSES: CourseId[] = ['park'];

const cache = new Map<string, CourseRt>();

/** 組み立てたコースを返す（同じ版は使い回す）。 */
export function getCourse(id: CourseId, version?: string): CourseRt {
  const def = id === 'park' && version === parkFreestyle.version ? parkFreestyle : COURSE_DEFS[id];
  if (!def) throw new Error(`unknown course ${id}`);
  const key = `${id}@${def.version}`;
  let c = cache.get(key);
  if (!c) {
    c = buildCourse(def);
    cache.set(key, c);
  }
  return c;
}
