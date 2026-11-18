import * as THREE from 'three';
import { baseHeight, hwAt, indexAt, linearHeight, solidTop, worldXZ, type PathRt, type Solid, type StairsRt } from '../game/track';

/** 両端と、その間で道の高さ・向き・幅が変わる標本を使う。 */
function samples(p: PathRt, from: number, to: number): number[] {
  const result = [from];
  for (let k = indexAt(p, from) + 1; k < p.n && p.s[k] < to; k++) result.push(p.s[k]);
  if (to > from) result.push(to);
  return result;
}

function vertex(vertices: number[], path: PathRt, s: number, x: number, y: number): void {
  const [wx, wz] = worldXZ(path, s, x);
  vertices.push(wx, y, wz);
}

function geometry(vertices: number[], faces: number[], flat = false): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  result.setIndex(faces);
  if (flat) {
    const surface = result.toNonIndexed();
    result.dispose();
    surface.computeVertexNormals();
    return surface;
  }
  result.computeVertexNormals();
  return result;
}

export function roadGeometry(p: PathRt): THREE.BufferGeometry {
  const vertices: number[] = [], faces: number[] = [];
  function addRoad(from: number, to: number) {
    if (from >= to) return;
    let previous = -1;
    for (const s of samples(p, from, to)) {
      const row = vertices.length / 3;
      const h = linearHeight(p, s);
      const hw = hwAt(p, s);
      vertex(vertices, p, s, -hw, h);
      vertex(vertices, p, s, hw, h);
      if (previous >= 0) faces.push(previous, previous + 1, row, previous + 1, row + 1, row);
      previous = row;
    }
  }
  let start = 0;
  for (const stair of [...p.stairs].sort((a, b) => a.s0 - b.s0)) {
    addRoad(start, stair.s0);
    start = stair.s1;
  }
  addRoad(start, p.length);
  return geometry(vertices, faces);
}

/** 各断面の上辺と下辺をつなぐ。踏切台・壁・段の側面も道のカーブに沿う。 */
function raisedStrip(p: PathRt, sections: number[], bounds: (s: number, i: number) => [number, number, number, number]): THREE.BufferGeometry {
  const vertices: number[] = [], faces: number[] = [];
  for (const [i, s] of sections.entries()) {
    const [left, right, bottom, top] = bounds(s, i);
    const row = vertices.length / 3;
    vertex(vertices, p, s, left, top);
    vertex(vertices, p, s, right, top);
    vertex(vertices, p, s, left, bottom);
    vertex(vertices, p, s, right, bottom);
    if (row === 0) {
      faces.push(0, 2, 1, 2, 3, 1);
      continue;
    }
    const prev = row - 4;
    faces.push(prev, prev + 1, row, prev + 1, row + 1, row,
      prev, row, prev + 2, prev + 2, row, row + 2,
      prev + 1, prev + 3, row + 1, prev + 3, row + 3, row + 1);
  }
  const end = vertices.length / 3 - 4;
  faces.push(end, end + 1, end + 2, end + 1, end + 3, end + 2);
  // 上面と側面の法線を分け、縁の陰影を保つ。
  return geometry(vertices, faces, true);
}

export function solidGeometry(p: PathRt, so: Solid): THREE.BufferGeometry {
  return raisedStrip(p, samples(p, so.s0, so.s1), (s) =>
    [so.x0, so.x1, baseHeight(p, s), solidTop(p, so, s, 0)]);
}

export function stairTreadGeometry(p: PathRt, st: StairsRt, step: number): THREE.BufferGeometry {
  const depth = (st.s1 - st.s0) / st.steps;
  const start = st.s0 + depth * step, end = st.s0 + depth * (step + 1);
  const rise = (st.hTop - st.hBottom) / st.steps;
  const top = st.hTop - rise * (step + 1);
  // 先頭に上段と同じ横断面を重ねて、路面から最初の踏み面への垂直面も閉じる。
  const sections = [start, ...samples(p, start, end)];
  return raisedStrip(p, sections, (s, i) => {
    const hw = hwAt(p, s);
    const height = i === 0 ? top + rise : top;
    return [-hw, hw, st.hBottom - 0.3, height];
  });
}
