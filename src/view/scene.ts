import * as THREE from 'three';
import {
  baseHeight,
  gatePhase,
  hwAt,
  railTopAt,
  sampleAt,
  solidTop,
  supportGrade,
  supportHeight,
  worldXZ,
  type CourseRt,
  type PathRt,
  type Solid,
} from '../game/track';
import { extrapolate } from '../game/run';
import { maxSpeed } from '../game/motion';
import { foodActive, poopActive } from '../game/items';
import { quatAxisAngle } from '../game/math';
import { FollowCamera } from './camera';
import { animateRig, createRig, type Rig } from './models';
import { poseOf, replayPoseAt, type Pose, type ReplayData } from './replay';
import type { Cue } from './effects';
import type { DogLook } from '../content/types';
import type { SimState } from '../game/types';
import type { Settings } from '../storage/records';

/**
 * 立体の描画（Three.js）。計算の状態と演出（Cue）を読んで描くだけで、計算には何も返さない。
 */

const THEMES = {
  park: { sky: '#bfe3f5', ground: '#8cc56b', road: '#d9cdb4', curb: '#b8ab92', fog: [60, 260] },
  street: { sky: '#d6e6f2', ground: '#b9b2a6', road: '#9fa4a8', curb: '#7d8287', fog: [50, 230] },
  river: { sky: '#cfe9f7', ground: '#94c47a', road: '#d6c8a4', curb: '#a99a78', fog: [70, 300] },
  plaza: { sky: '#e3eef6', ground: '#a8d08d', road: '#e2dccb', curb: '#c2b9a1', fog: [70, 280] },
} as const;

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function labelTexture(text: string, bg = '#1f2a37', fg = '#ffffff', w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.5)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2, w * 0.92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pawTexture(color: string, bg = 'rgba(0,0,0,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(32, 40, 13, 11, 0, 0, Math.PI * 2);
  g.fill();
  for (const [x, y] of [
    [17, 22],
    [27, 15],
    [37, 15],
    [47, 22],
  ]) {
    g.beginPath();
    g.ellipse(x, y, 5.5, 7, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 道の上の位置に、道の向きにそろえた物を置く。 */
function placeOnPath(obj: THREE.Object3D, p: PathRt, s: number, x: number, y: number): void {
  const sc = Math.max(0, Math.min(p.length, s));
  const [wx, wz] = worldXZ(p, sc, x);
  obj.position.set(wx, y, wz);
  obj.rotation.set(0, -sampleAt(p, sc).heading, 0);
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
}

class Particles {
  readonly points: THREE.Points;
  private list: Particle[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  constructor(private cap = 600) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false;
  }
  emit(n: number, at: THREE.Vector3, color: THREE.Color, speed: number, up: number, life = 0.6): void {
    for (let i = 0; i < n && this.list.length < this.cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.list.push({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp, life, max: life, r: color.r, g: color.g, b: color.b });
    }
  }
  update(dt: number): void {
    this.list = this.list.filter((p) => (p.life -= dt) > 0);
    for (const p of this.list) {
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    this.list.forEach((p, i) => {
      this.pos.set([p.x, p.y, p.z], i * 3);
      const f = p.life / p.max;
      this.col.set([p.r * f + (1 - f), p.g * f + (1 - f), p.b * f + (1 - f)], i * 3);
    });
    this.geo.setDrawRange(0, this.list.length);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
  clear(): void {
    this.list = [];
  }
}

class Trail {
  readonly line: THREE.Line;
  private pts: THREE.Vector3[] = [];
  private geo = new THREE.BufferGeometry();
  constructor(material: THREE.LineBasicMaterial | THREE.LineDashedMaterial, private cap = 40) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    this.line = new THREE.Line(this.geo, material);
    this.line.frustumCulled = false;
  }
  push(p: THREE.Vector3): void {
    this.pts.push(p.clone());
    if (this.pts.length > this.cap) this.pts.shift();
    this.sync();
  }
  fade(): void {
    if (this.pts.length > 0) {
      this.pts.shift();
      this.sync();
    }
  }
  points(): THREE.Vector3[] {
    return this.pts;
  }
  clear(): void {
    this.pts = [];
    this.sync();
  }
  private sync(): void {
    const a = this.geo.attributes.position as THREE.BufferAttribute;
    this.pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
    a.needsUpdate = true;
    this.geo.setDrawRange(0, this.pts.length);
    this.line.computeLineDistances();
  }
}

class Decals {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private born: number[];
  private dummy = new THREE.Object3D();
  constructor(texture: THREE.Texture, private cap = 120, size = 0.32) {
    const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size), m, cap);
    this.mesh.frustumCulled = false;
    this.born = new Array(cap).fill(-1e9);
    for (let i = 0; i < cap; i++) {
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  }
  add(pos: THREE.Vector3, yaw: number, color: THREE.Color, nowMs: number, scale = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.dummy.position.copy(pos);
    this.dummy.rotation.set(-Math.PI / 2, 0, -yaw - Math.PI / 2);
    this.dummy.scale.set(scale, scale, scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.setColorAt(i, color);
    this.born[i] = nowMs;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(nowMs: number, lifeMs: number): void {
    let changed = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.born[i] > -1e8 && nowMs - this.born[i] > lifeMs) {
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.born[i] = -1e9;
        changed = true;
      }
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new FollowCamera();
  private courseGroup = new THREE.Group();
  private course: CourseRt | null = null;
  private rig: Rig | null = null;
  private ghostRig: Rig | null = null;
  private ghost: ReplayData | null = null;
  private shadow: THREE.Mesh;
  private items = new Map<string, THREE.Object3D>();
  private gates = new Map<string, { bar: THREE.Group; lamp: THREE.Mesh; solid: Solid; path: PathRt }>();
  private flags = new Map<string, THREE.Object3D>();
  private guideGroups = new Map<string, THREE.Group>();
  private goalTape: THREE.Mesh | null = null;
  private particles = new Particles();
  private dogTrail: Trail;
  private shoulderTrail: Trail;
  private prints: Decals;
  private impact: THREE.LineSegments;
  private impactUntil = 0;
  private windLines: THREE.LineSegments;
  private legPhase = 0;
  private lastPrintS = 0;
  private wagUntil = 0;
  private sun: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b7d5a', 1.4));
    this.sun = new THREE.DirectionalLight('#ffffff', 1.6);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.sun);
    this.scene.add(this.courseGroup);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.renderOrder = 2;
    this.shadow = sh;
    this.scene.add(sh);
    this.scene.add(this.particles.points);
    this.dogTrail = new Trail(new THREE.LineBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.9 }));
    this.shoulderTrail = new Trail(new THREE.LineDashedMaterial({ color: '#2f6fe0', dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 }));
    this.scene.add(this.dogTrail.line, this.shoulderTrail.line);
    this.prints = new Decals(pawTexture('#ffffff'), 160);
    this.scene.add(this.prints.mesh);
    const impGeo = new THREE.BufferGeometry();
    impGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
    this.impact = new THREE.LineSegments(impGeo, new THREE.LineBasicMaterial({ color: '#ffffff' }));
    this.impact.visible = false;
    this.impact.frustumCulled = false;
    this.scene.add(this.impact);
    const windGeo = new THREE.BufferGeometry();
    windGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 2 * 3), 3));
    this.windLines = new THREE.LineSegments(windGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
    this.windLines.visible = false;
    this.windLines.frustumCulled = false;
    this.scene.add(this.windLines);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, h);
  }

  setRider(look: DogLook, clothes: string, helmet: string): void {
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = createRig(look, clothes, helmet);
    this.scene.add(this.rig.root);
  }

  setGhost(replay: ReplayData | null, look: DogLook | null): void {
    if (this.ghostRig) this.scene.remove(this.ghostRig.root);
    this.ghostRig = null;
    this.ghost = replay;
    if (replay && look) {
      this.ghostRig = createRig(look, '#ffffff', '#ffffff', true);
      this.scene.add(this.ghostRig.root);
    }
  }

  resetEffects(): void {
    this.particles.clear();
    this.dogTrail.clear();
    this.shoulderTrail.clear();
    this.cam.reset();
    if (this.goalTape) this.goalTape.visible = true;
    for (const f of this.flags.values()) f.position.y = 0.2;
    for (const o of this.items.values()) o.visible = true;
  }

  setCourse(course: CourseRt): void {
    this.course = course;
    this.courseGroup.clear();
    this.items.clear();
    this.gates.clear();
    this.flags.clear();
    this.guideGroups.clear();
    const th = THEMES[course.def.theme];
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.sky, th.fog[0], th.fog[1]);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: th.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    this.courseGroup.add(ground);
    if (course.def.theme === 'river') {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#4f9fd0' }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = -0.9;
      this.courseGroup.add(water);
    }
    let order = 0;
    for (const p of course.paths.values()) this.buildPath(p, th, order++);
    this.buildScenery(course);
    this.buildGoal(course);
  }

  private buildPath(p: PathRt, th: (typeof THEMES)[keyof typeof THEMES], order: number): void {
    const step = 2;
    const verts: number[] = [];
    const idx: number[] = [];
    const lift = 0.002 * order;
    let row = 0;
    for (let k = 0; k < p.n; k += step) {
      const s = p.s[k];
      const hw = p.hw[k];
      const h = baseHeight(p, s) + lift;
      const [lx, lz] = worldXZ(p, s, -hw);
      const [rx, rz] = worldXZ(p, s, hw);
      verts.push(lx, h, lz, rx, h, rz);
      if (row > 0) {
        const a = (row - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      row++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: th.road, side: THREE.DoubleSide }));
    this.courseGroup.add(road);
    // 端: 壁なら縁石、落下側なら縁取りだけ（川沿いは水が見える）。
    for (const side of [-1, 1] as const) {
      const edge = p.edges[side < 0 ? 0 : 1];
      const cv: number[] = [];
      const ci: number[] = [];
      let r = 0;
      for (let k = 0; k < p.n; k += step) {
        const s = p.s[k];
        const hw = p.hw[k] + 0.08;
        const h = baseHeight(p, s);
        const [x, z] = worldXZ(p, s, side * hw);
        const top = edge === 'wall' ? 0.28 : 0.04;
        cv.push(x, h - 0.5, z, x, h + top, z);
        if (r > 0) {
          const a = (r - 1) * 2;
          ci.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        r++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3));
      g.setIndex(ci);
      g.computeVertexNormals();
      this.courseGroup.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: edge === 'wall' ? th.curb : '#e9e2cf', side: THREE.DoubleSide })));
    }
    // 階段
    for (const st of p.stairs) {
      const d = (st.s1 - st.s0) / st.steps;
      for (let k = 1; k <= st.steps; k++) {
        const top = st.hTop - ((st.hTop - st.hBottom) * k) / st.steps;
        const hgt = top - st.hBottom + 0.3;
        const box = new THREE.Mesh(new THREE.BoxGeometry(d, hgt, hwAt(p, st.s0) * 2), new THREE.MeshLambertMaterial({ color: k % 2 ? '#cfc6b3' : '#bdb3a0' }));
        placeOnPath(box, p, st.s0 + d * (k - 0.5), 0, top - hgt / 2);
        this.courseGroup.add(box);
      }
    }
    for (const so of p.solids) this.buildSolid(p, so);
    for (const it of p.items) this.buildItem(p, it.id, it.kind, it.s, it.x, it.y);
    for (const cp of p.checkpoints) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), new THREE.MeshLambertMaterial({ color: '#eeeeee' }));
      pole.position.y = 1.1;
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshLambertMaterial({ color: '#f2c94c', side: THREE.DoubleSide }));
      flag.position.set(0.35, 0.2, 0);
      const holder = new THREE.Group();
      holder.add(flag);
      holder.position.y = 0.2;
      g.add(holder);
      placeOnPath(g, p, cp.s, hwAt(p, cp.s) + 0.5, baseHeight(p, cp.s));
      this.courseGroup.add(g);
      this.flags.set(cp.id, holder);
    }
    for (const ar of p.arrows) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), new THREE.MeshLambertMaterial({ color: '#555555' }));
      post.position.y = 0.5;
      g.add(post);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture(ar.dir === 'right' ? '›››' : '‹‹‹', '#ffd400', '#111111', 256, 160), side: THREE.DoubleSide }));
      sign.position.y = 1.25;
      sign.rotation.y = Math.PI / 2;
      g.add(sign);
      placeOnPath(g, p, ar.s, (ar.side === 'right' ? 1 : -1) * (hwAt(p, ar.s) + 0.6), baseHeight(p, ar.s));
      this.courseGroup.add(g);
    }
    // 分岐の標識（E20）: 分岐の少し手前に、行き先の名前を出す。
    if (p.next.kind === 'fork') {
      const opts = p.next.options;
      const g = new THREE.Group();
      opts.forEach((o, i) => {
        const tex = labelTexture(`${o.trick ? '★ ' : ''}${o.label}`, o.trick ? '#7a3b00' : '#1f2a37');
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        const mid = (Math.max(o.xMin, -hwAt(p, p.length)) + Math.min(o.xMax, hwAt(p, p.length))) / 2;
        plate.position.set(0, 2.6, mid);
        plate.rotation.y = Math.PI / 2;
        g.add(plate);
        void i;
      });
      placeOnPath(g, p, Math.max(0, p.length - 16), 0, baseHeight(p, Math.max(0, p.length - 16)));
      this.courseGroup.add(g);
      // 道しるべの足跡（技を狙える道）
      for (const o of opts) {
        if (!o.trick) continue;
        const tp = this.course!.paths.get(o.to)!;
        const pg = new THREE.Group();
        const tex = pawTexture('#7b4a12');
        const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        for (let s = 2; s < tp.length - 2; s += 1.6) {
          const paw = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), m);
          const [x, z] = worldXZ(tp, s, (Math.floor(s / 1.6) % 2 ? 0.25 : -0.25));
          paw.position.set(x, baseHeight(tp, s) + 0.03, z);
          paw.rotation.set(-Math.PI / 2, 0, -sampleAt(tp, s).heading - Math.PI / 2);
          pg.add(paw);
        }
        pg.visible = false;
        this.courseGroup.add(pg);
        this.guideGroups.set(p.next.forkId, pg);
      }
    }
  }

  private buildSolid(p: PathRt, so: Solid): void {
    if (so.kind === 'rail') {
      const r = so.rail!;
      const pts: THREE.Vector3[] = [];
      for (let s = r.s0; s <= r.s1 + 1e-6; s += Math.max(0.5, (r.s1 - r.s0) / 40)) {
        const [x, z] = worldXZ(p, s, r.x);
        pts.push(new THREE.Vector3(x, railTopAt(r, s) - 0.04, z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.05, 8), new THREE.MeshStandardMaterial({ color: '#c9d1d9', metalness: 0.8, roughness: 0.3 }));
      this.courseGroup.add(tube);
      for (let s = r.s0 + 0.2; s < r.s1; s += 2.5) {
        const top = railTopAt(r, s);
        const base = baseHeight(p, s);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, top - base, 6), new THREE.MeshLambertMaterial({ color: '#8b949e' }));
        placeOnPath(post, p, s, r.x, base + (top - base) / 2);
        this.courseGroup.add(post);
      }
      return;
    }
    if (so.kind === 'kicker') {
      const corners = (s: number, x: number, y: number) => {
        const [wx, wz] = worldXZ(p, s, x);
        return [wx, y, wz];
      };
      const b0 = baseHeight(p, so.s0);
      const top = b0 + so.height;
      const v = [
        ...corners(so.s0, so.x0, b0),
        ...corners(so.s0, so.x1, b0),
        ...corners(so.s1, so.x0, top),
        ...corners(so.s1, so.x1, top),
        ...corners(so.s1, so.x0, baseHeight(p, so.s1)),
        ...corners(so.s1, so.x1, baseHeight(p, so.s1)),
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 0, 4, 2, 1, 3, 5]);
      geo.computeVertexNormals();
      this.courseGroup.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#f08a24', side: THREE.DoubleSide })));
      return;
    }
    if (so.kind === 'gate') {
      const g = new THREE.Group();
      const width = so.x1 - so.x0;
      const bone = new THREE.MeshLambertMaterial({ color: '#f5f0e1' });
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, width - 0.6, 10), bone);
      bar.rotation.x = Math.PI / 2;
      g.add(bar);
      for (const z of [-(width / 2 - 0.3), width / 2 - 0.3]) {
        for (const dy of [-0.12, 0.12]) {
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bone);
          knob.position.set(0, dy, z);
          g.add(knob);
        }
      }
      const holder = new THREE.Group();
      holder.add(g);
      placeOnPath(holder, p, (so.s0 + so.s1) / 2, (so.x0 + so.x1) / 2, baseHeight(p, so.s0));
      this.courseGroup.add(holder);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#552222' }));
      placeOnPath(lamp, p, so.s0 - 0.6, hwAt(p, so.s0) + 0.4, baseHeight(p, so.s0) + 1.6);
      this.courseGroup.add(lamp);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshLambertMaterial({ color: '#555555' }));
      placeOnPath(post, p, so.s0 - 0.6, hwAt(p, so.s0) + 0.4, baseHeight(p, so.s0) + 0.8);
      this.courseGroup.add(post);
      this.gates.set(so.id, { bar: g, lamp, solid: so, path: p });
      return;
    }
    // 柵・壁: 長いものは道に沿って分けて置く。
    const len = so.s1 - so.s0;
    const pieces = Math.max(1, Math.ceil(len / 2));
    const color = so.kind === 'fence' ? '#f4f1ea' : so.look === 'planter' ? '#6d9c4f' : so.look === 'shop' ? '#b5835a' : '#9aa5b1';
    for (let i = 0; i < pieces; i++) {
      const a = so.s0 + (len * i) / pieces;
      const b = so.s0 + (len * (i + 1)) / pieces;
      const mid = (a + b) / 2;
      const base = baseHeight(p, mid);
      const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.12, b - a), so.height, so.x1 - so.x0), new THREE.MeshLambertMaterial({ color }));
      placeOnPath(box, p, mid, (so.x0 + so.x1) / 2, base + so.height / 2);
      this.courseGroup.add(box);
    }
    const base = baseHeight(p, so.s0);
    if (so.kind === 'fence' || (so.kind === 'wall' && so.height < 1)) {
      // その場で越せる柵: 手前の足跡帯（R27）
      const tex = pawTexture('#3b2f1a', '#ffd84d');
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, Math.max(1, Math.round((so.x1 - so.x0) / 0.8)));
      const band = new THREE.Mesh(new THREE.PlaneGeometry(1.6, so.x1 - so.x0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
      band.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(band);
      placeOnPath(holder, p, so.s0 - 1.6, (so.x0 + so.x1) / 2, baseHeight(p, so.s0 - 1.6) + 0.02);
      this.courseGroup.add(holder);
    } else if (so.kind === 'wall' && so.height >= 1.2) {
      // 踏切台で越す高い壁: 坂の印（R27）
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ map: labelTexture('◢ 踏切台', '#0b4f8a', '#ffffff', 384, 256), side: THREE.DoubleSide }));
      placeOnPath(sign, p, so.s0 - 0.02, (so.x0 + so.x1) / 2, base + so.height * 0.6);
      sign.rotation.y += Math.PI / 2;
      this.courseGroup.add(sign);
    }
  }

  private buildItem(p: PathRt, id: string, kind: 'food' | 'poop' | 'guide', s: number, x: number, y: number): void {
    const g = new THREE.Group();
    if (kind === 'food') {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.2), new THREE.MeshLambertMaterial({ color: '#e8a33d' }));
      bag.position.y = 0.18;
      g.add(bag);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      label.position.set(0.141, 0.2, 0);
      label.rotation.y = Math.PI / 2;
      g.add(label);
    } else if (kind === 'poop') {
      const m = new THREE.MeshLambertMaterial({ color: '#6b4423' });
      [0.16, 0.12, 0.07].forEach((r, i) => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
        b.position.y = 0.08 + i * 0.1;
        b.scale.y = 0.7;
        g.add(b);
      });
    } else {
      const m = new THREE.MeshLambertMaterial({ color: '#fff4cf', emissive: '#4a3c10' });
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), m);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 0.25;
      g.add(bar);
      for (const dx of [-0.25, 0.25]) for (const dz of [-0.06, 0.06]) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), m);
        k.position.set(dx, 0.25, dz);
        g.add(k);
      }
    }
    placeOnPath(g, p, s, x, kind === 'poop' ? baseHeight(p, s) : y - 0.18);
    g.userData.baseY = g.position.y;
    this.courseGroup.add(g);
    this.items.set(id, g);
  }

  private buildScenery(course: CourseRt): void {
    const theme = course.def.theme;
    const r = rand(course.def.version.length * 7919 + 17);
    const trunk = new THREE.MeshLambertMaterial({ color: '#7a5533' });
    const leaves = new THREE.MeshLambertMaterial({ color: theme === 'river' ? '#5f9e4a' : '#4f8f3f' });
    const treeTrunk = new THREE.CylinderGeometry(0.15, 0.2, 2, 6);
    const treeTop = new THREE.ConeGeometry(1.3, 2.8, 7);
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    const spots: { x: number; z: number; y: number; yaw: number }[] = [];
    for (const p of course.paths.values()) {
      if (p.def.route) continue;
      for (let s = 4; s < p.length; s += theme === 'street' ? 7 : 10) {
        for (const side of [-1, 1]) {
          if (theme === 'river' && side === 1 && p.edges[1] === 'drop') continue;
          const off = hwAt(p, s) + (theme === 'street' ? 4.5 : 4 + r() * 8);
          const [x, z] = worldXZ(p, s, side * off);
          spots.push({ x, z, y: baseHeight(p, s), yaw: -sampleAt(p, s).heading });
        }
      }
    }
    if (theme === 'street') {
      const mesh = new THREE.InstancedMesh(buildingGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), spots.length);
      const d = new THREE.Object3D();
      const palette = ['#e8d5b7', '#c9b79c', '#d98e73', '#a7c4bc', '#f2e3c6', '#b8a1c9'];
      spots.forEach((sp, i) => {
        const h = 4 + r() * 7;
        d.position.set(sp.x, sp.y - 1 + h / 2, sp.z);
        d.rotation.set(0, sp.yaw, 0);
        d.scale.set(6.2, h, 5);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        mesh.setColorAt(i, new THREE.Color(palette[Math.floor(r() * palette.length)]));
      });
      this.courseGroup.add(mesh);
    } else {
      const tm = new THREE.InstancedMesh(treeTrunk, trunk, spots.length);
      const lm = new THREE.InstancedMesh(treeTop, leaves, spots.length);
      const d = new THREE.Object3D();
      spots.forEach((sp, i) => {
        const sc = 0.8 + r() * 0.6;
        d.position.set(sp.x, sp.y - 0.2 + sc, sp.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(sc, sc, sc);
        d.updateMatrix();
        tm.setMatrixAt(i, d.matrix);
        d.position.y = sp.y - 0.2 + sc * 2 + 1.2 * sc;
        d.updateMatrix();
        lm.setMatrixAt(i, d.matrix);
      });
      this.courseGroup.add(tm, lm);
    }
  }

  private buildGoal(course: CourseRt): void {
    this.goalTape = null;
    if (!course.goal) return;
    const p = course.paths.get(course.goal.pathId)!;
    const s = course.goal.s;
    const hw = hwAt(p, s);
    const g = new THREE.Group();
    const postM = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    for (const z of [-hw - 0.3, hw + 0.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), postM);
      post.position.set(0, 1.7, z);
      g.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, hw * 2 + 0.9), new THREE.MeshBasicMaterial({ map: labelTexture('GOAL ゴール', '#d7263d', '#ffffff', 512, 96) }));
    top.position.y = 3.5;
    g.add(top);
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.08, hw * 2), new THREE.MeshBasicMaterial({ color: '#ffef5a', side: THREE.DoubleSide }));
    tape.position.y = 1.0;
    tape.rotation.y = Math.PI / 2;
    tape.rotation.z = Math.PI / 2;
    g.add(tape);
    placeOnPath(g, p, s, 0, baseHeight(p, s));
    this.courseGroup.add(g);
    this.goalTape = tape;
  }

  /** 1フレームを描く。cues はこのフレームで確定した演出。 */
  frame(run: SimState, renderUs: number, cues: Cue[], settings: Settings, nowMs: number, dtMs: number, wag = false): void {
    const course = this.course;
    if (!course || !this.rig) return;
    const dt = Math.min(0.1, dtMs / 1000);
    const lightK = settings.light === 'weak' ? 0.35 : 1;
    const path = course.paths.get(run.pathId)!;
    const ex = extrapolate(run, renderUs);
    const pose = poseOf(run, ex.s, ex.x, ex.y, run.finished ? run.simUs : renderUs);
    this.placeRig(this.rig, pose);
    const grade = run.mode === 'ground' ? supportGrade(path, run.s, run.x, run.y, run.simUs) : 0;
    const speed = run.finished ? 0 : run.forwardSpeed;
    this.legPhase += dt * (3 + speed * 1.6);
    const feetDown = run.mode === 'air' && run.vy < 0 && (run.jump?.resolution.rotations ?? []).every((r) => renderUs >= r.startUs + r.durUs);
    animateRig(this.rig, { mode: run.mode, speed, maxSpeed: maxSpeed(run), grade, lean: run.lateralSpeed / 4.5, feetDown, blocked: !!run.blocked, timeMs: nowMs, wag: wag || nowMs < this.wagUntil }, this.legPhase);
    this.rig.root.visible = run.mode !== 'falling' || nowMs % 200 < 100;

    // 影: 犬の真下。着地が近いほど濃く、小さくする（R62）。
    const groundY = supportHeight(path, Math.max(0, Math.min(path.length, ex.s)), ex.x, ex.y, run.simUs);
    const above = Math.max(0, ex.y - groundY);
    this.shadow.position.set(pose.x, groundY + 0.03, pose.z);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.55 - above * 0.14);
    const ss = 1 + Math.min(1.2, above * 0.25);
    this.shadow.scale.set(ss, ss, ss);
    this.shadow.visible = run.mode !== 'falling';

    // 犬だけの回転は足先の線、体ごとの回転には肩の線を加える（R63）。
    const rots = run.jump?.resolution.rotations ?? [];
    const dogSpinning = rots.some((r) => r.channel === 'dog' && renderUs >= r.startUs && renderUs < r.startUs + r.durUs);
    const bodySpinning = rots.some((r) => r.channel === 'body' && renderUs >= r.startUs && renderUs < r.startUs + r.durUs);
    this.rig.root.updateMatrixWorld(true);
    if (dogSpinning) this.dogTrail.push(this.rig.paw.getWorldPosition(new THREE.Vector3()));
    else this.dogTrail.fade();
    if (bodySpinning) this.shoulderTrail.push(this.rig.shoulder.getWorldPosition(new THREE.Vector3()));
    else this.shoulderTrail.fade();

    const at = new THREE.Vector3(pose.x, pose.y, pose.z);
    const fwd = new THREE.Vector3(Math.cos(pose.heading), 0, Math.sin(pose.heading));
    const sand = new THREE.Color('#d9c38f');
    for (const c of cues) {
      switch (c.visual) {
        case 'sandBurst':
        case 'kickMark':
        case 'kickMarkBig':
          this.particles.emit(Math.round((c.visual === 'kickMarkBig' ? 26 : 12) * lightK + 4), at, sand, c.visual === 'kickMarkBig' ? 3 : 2, 2);
          this.prints.add(new THREE.Vector3(pose.x, groundY + 0.03, pose.z), pose.heading, new THREE.Color('#6b5a3a'), nowMs, c.visual === 'kickMarkBig' ? 2.2 : 1.4);
          break;
        case 'sandRing':
          this.particles.emit(Math.round(16 * lightK + 4), new THREE.Vector3(pose.x, groundY + 0.05, pose.z), sand, 2.5, 0.6);
          break;
        case 'fourPaws':
          for (const [dx, dz] of [
            [0.35, -0.12],
            [0.35, 0.12],
            [-0.35, -0.12],
            [-0.35, 0.12],
          ]) {
            const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
            this.prints.add(new THREE.Vector3(pose.x, groundY + 0.03, pose.z).addScaledVector(fwd, dx).addScaledVector(right, dz), pose.heading, new THREE.Color('#ffd23f'), nowMs, 0.9);
          }
          break;
        case 'pawTrails':
          // 複合成功: 2本の軌跡が足跡の形で重なる（R64）。
          for (const pt of [...this.dogTrail.points(), ...this.shoulderTrail.points()].filter((_, i) => i % 4 === 0)) {
            this.prints.add(new THREE.Vector3(pt.x, Math.max(groundY + 0.04, pt.y), pt.z), pose.heading, new THREE.Color('#ff7ab6'), nowMs, 1.1);
          }
          break;
        case 'impactLines':
          this.showImpact(at.clone().addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, 0.5, 0)), nowMs);
          if (settings.shake) this.cam.kick(0.25);
          break;
        case 'underRotatedLabel':
          if (settings.shake) this.cam.kick(0.12);
          this.particles.emit(10, at, sand, 1.5, 0.5);
          break;
        case 'flagUp': {
          const f = c.objId ? this.flags.get(c.objId) : null;
          if (f) f.userData.raiseAt = nowMs;
          break;
        }
        case 'tape':
          if (this.goalTape) this.goalTape.visible = false;
          this.particles.emit(Math.round(40 * lightK + 6), at.clone().add(new THREE.Vector3(0, 1.5, 0)), new THREE.Color('#ffef5a'), 4, 3, 1.2);
          break;
        case 'tailWag':
          this.wagUntil = nowMs + 1200;
          break;
      }
      if (c.effect === 'E18' && c.visual === 'boostGauge') this.particles.emit(10, at, new THREE.Color('#ffb347'), 2, 1.5);
    }
    // 手すりの接点の光（滑走中だけ、速いほど多い）
    if (run.mode === 'rail') {
      const n = Math.max(1, Math.round(speed * 0.6 * lightK));
      this.particles.emit(n, new THREE.Vector3(pose.x, pose.y + 0.02, pose.z), new THREE.Color('#ffe066'), 1.5 + speed * 0.15, 1.2, 0.35);
    }
    // 走るほど砂つぶと足跡（R61）。糞を踏んだ間は茶色い足跡（R68）。
    const slowed = poopActive(run.effects, run.simUs);
    if (run.mode === 'ground' && speed > 0.5) {
      if (Math.random() < Math.min(1, speed / 10) * 0.6 * lightK) this.particles.emit(1, new THREE.Vector3(pose.x, groundY + 0.05, pose.z), sand, 0.8, 0.8, 0.4);
      if (Math.abs(run.s - this.lastPrintS) > (slowed ? 0.45 : 0.9)) {
        this.lastPrintS = run.s;
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const sideOff = (Math.round(run.s / 0.9) % 2 ? 0.12 : -0.12);
        this.prints.add(new THREE.Vector3(pose.x, groundY + 0.025, pose.z).addScaledVector(right, sideOff), pose.heading, slowed ? new THREE.Color('#6b4423') : new THREE.Color('#bba57a'), nowMs, slowed ? 1 : 0.7);
      }
    }
    // 加速中は犬の後ろに風の線（R67）
    const boosted = foodActive(run.effects, run.simUs);
    this.windLines.visible = (boosted || speed > maxSpeed(run) * 1.05) && !run.finished;
    if (this.windLines.visible) {
      const a = this.windLines.geometry.attributes.position as THREE.BufferAttribute;
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      for (let i = 0; i < 10; i++) {
        const off = ((i * 37) % 10) / 10 - 0.5;
        const y = pose.y + 0.2 + ((i * 53) % 10) / 10;
        const start = at.clone().addScaledVector(right, off * 1.4).addScaledVector(fwd, -0.6 - ((nowMs / 40 + i * 13) % 10) / 6);
        start.y = y;
        const end = start.clone().addScaledVector(fwd, -(boosted ? 1.6 : 0.9));
        a.setXYZ(i * 2, start.x, start.y, start.z);
        a.setXYZ(i * 2 + 1, end.x, end.y, end.z);
      }
      a.needsUpdate = true;
      (this.windLines.material as THREE.LineBasicMaterial).opacity = 0.6 * lightK + 0.15;
    }
    if (this.impact.visible && nowMs > this.impactUntil) this.impact.visible = false;

    // アイテム、ゲート、旗、道しるべの足跡
    for (const [id, o] of this.items) {
      o.visible = !run.consumed[id];
      o.rotation.y += dt * 1.2;
      o.position.y = (o.userData.baseY as number) + Math.sin(nowMs / 300 + o.position.x) * 0.05;
    }
    for (const g of this.gates.values()) {
      const ph = gatePhase(g.solid.gate!, run.simUs);
      g.bar.position.y = 0.2 + solidTop(g.path, g.solid, g.solid.s0, run.simUs) - baseHeight(g.path, g.solid.s0) - 0.2 * (1 - ph.raise);
      g.bar.visible = ph.raise > 0.02;
      (g.lamp.material as THREE.MeshBasicMaterial).color.set(ph.phase === 'lamp' || ph.phase === 'rising' ? (nowMs % 300 < 150 ? '#ff4040' : '#aa2020') : '#552222');
    }
    for (const [id, f] of this.flags) {
      const t0 = f.userData.raiseAt as number | undefined;
      const passed = run.lastCheckpoint.id === id || (t0 !== undefined);
      f.position.y = passed ? Math.min(1.85, 0.2 + (t0 ? (nowMs - t0) / 300 : 2)) : 0.2;
    }
    for (const [forkId, g] of this.guideGroups) {
      g.visible = run.guide.active && (run.guide.forkId === null || run.guide.forkId === forkId);
    }

    // 自分の最速の走り（半透明）。見るためだけで、計算には関与しない。
    if (this.ghostRig && this.ghost && settings.ghost) {
      const gp = replayPoseAt(this.ghost, renderUs);
      this.ghostRig.root.visible = !!gp;
      if (gp) this.placeRig(this.ghostRig, gp);
    } else if (this.ghostRig) {
      this.ghostRig.root.visible = false;
    }

    this.particles.update(dt);
    this.prints.update(nowMs, 2600);
    this.cam.update(path, ex.s, ex.x, ex.y, dtMs, settings.shake);
    this.sun.intensity = 1.2 + 0.4 * lightK;
    this.renderer.render(this.scene, this.cam.camera);
  }

  private placeRig(rig: Rig, pose: Pose): void {
    rig.root.position.set(pose.x, pose.y, pose.z);
    // 向き（道の接線）→ 体ごとの回転（基本姿勢を含む）→ 犬だけの回転、の順に重ねる。
    const yaw = quatAxisAngle([0, 1, 0], -pose.heading);
    rig.root.quaternion.set(yaw[0], yaw[1], yaw[2], yaw[3]);
    rig.board.quaternion.set(pose.body[0], pose.body[1], pose.body[2], pose.body[3]);
    rig.dog.quaternion.set(pose.dog[0], pose.dog[1], pose.dog[2], pose.dog[3]);
  }

  private showImpact(at: THREE.Vector3, nowMs: number): void {
    const a = this.impact.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(ang) * 0.1, Math.sin(ang) * 0.4, Math.sin(ang * 1.7) * 0.3);
      a.setXYZ(i * 2, at.x + d.x, at.y + d.y, at.z + d.z);
      a.setXYZ(i * 2 + 1, at.x + d.x * 2.6, at.y + d.y * 2.6, at.z + d.z * 2.6);
    }
    a.needsUpdate = true;
    this.impact.visible = true;
    this.impactUntil = nowMs + 350;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
