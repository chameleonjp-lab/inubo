import { park } from './park';
import type { CourseDef, ForkOption, ObjectDef } from '../types';

export const parkRouteLooks: Record<string, { road: string; edge: string; sign: string }> = {
  'f1-slope': { road: '#8caa75', edge: '#d5f39d', sign: 'なだらかな下り' },
  'f1-stairs': { road: '#c39878', edge: '#ffc986', sign: '段差から空中技' },
  'f1-rail': { road: '#7a8aa6', edge: '#b2d9ff', sign: '手すりの連続' },
  'f2-short': { road: '#739b82', edge: '#b8f6a2', sign: 'フードで加速' },
  'f2-rail': { road: '#8a78a9', edge: '#dec4ff', sign: '長い手すりと高い台' },
};

const curveFood: ObjectDef[] = [
  { kind: 'food', id: 'curve-out-1', path: 'start', u: 132, x: -2.5, h: 0.35 },
  { kind: 'food', id: 'curve-out-2', path: 'mid', u: 387, x: 2.5, h: 0.35 },
  { kind: 'food', id: 'curve-out-late', path: 'late', u: 642, x: -2.6, h: 0.35 },
  { kind: 'food', id: 'curve-out-3', path: 'extension', u: 913, x: 2.6, h: 0.35 },
  { kind: 'food', id: 'curve-out-4', path: 'extension', u: 1098, x: -2.6, h: 0.35 },
  { kind: 'food', id: 'curve-out-5', path: 'extension', u: 1334, x: 2.6, h: 0.35 },
];

const routeObjects: ObjectDef[] = [
  { kind: 'kicker', id: 'stairs-launch-1', path: 'f1-stairs', u0: 231, u1: 235, x0: -1.15, x1: 1.15, height: 0.68 },
  { kind: 'kicker', id: 'stairs-launch-2', path: 'f1-stairs', u0: 259, u1: 263, x0: -1.15, x1: 1.15, height: 0.68 },
  { kind: 'rail', id: 'rail-stair-bridge', path: 'f1-rail', u0: 248, u1: 278, x: 0.82, h0: 0.72, h1: 0.72 },
  { kind: 'kicker', id: 'rail-bridge-launch', path: 'f1-rail', u0: 241, u1: 245, x0: 0.45, x1: 1.25, height: 0.5 },
  { kind: 'kicker', id: 'long-rail-high-launch', path: 'f2-rail', u0: 479, u1: 484, x0: -1.15, x1: 0.5, height: 0.9 },
  { kind: 'food', id: 'long-rail-air-food', path: 'f2-rail', u: 494, x: -0.3, h: 3.15 },
];

function tagRoute(option: ForkOption): ForkOption {
  return { ...option, detail: parkRouteLooks[option.to]?.sign };
}

export const parkFreestyle: CourseDef = {
  ...park,
  version: 'park-5',
  sections: [],
  paths: park.paths.map(path => path.next.kind === 'fork'
    ? { ...path, next: { ...path.next, options: path.next.options.map(tagRoute) } }
    : path),
  objects: [
    ...park.objects.filter(object => object.id !== 'k-3').map(object => {
      if (object.kind === 'food' && object.path === 'f2-short') return { ...object, x: -0.35 };
      if (object.kind === 'rail' && object.id === 'r-long') return { ...object, u0: 446, u1: 472 };
      return object;
    }),
    ...curveFood,
    ...routeObjects,
  ],
};
