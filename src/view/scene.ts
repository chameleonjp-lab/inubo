import { language, t } from '../ui/i18n';
import * as THREE from 'three';
import { disposeObjects } from './dispose';
import { roadGeometry, solidGeometry, stairTreadGeometry } from './course-geometry';
import { TrickLabStage } from './trick-lab';
import type { LabEdge, LabFixtureId } from '../game/trick-lab-terrain';
import type { Handle, LabPose } from '../game/trick-lab';
import {
  baseHeight,
  gatePhase,
  hwAt,
  railTopAt,
  sampleAt,
  supportGrade,
  supportHeight,
  uAtS,
  worldXZ,
  type CourseRt,
  type PathRt,
  type Solid,
} from '../game/track';
import { rivalPose } from '../game/rivals';
import { DOG_EFFECT_COLORS } from '../content/dog-effects';
import { DOGS } from '../content/dogs';
import { parkFreestyle, parkRouteLooks } from '../content/courses/park-freestyle';
import { extrapolate } from '../game/run';
import { maxSpeed } from '../game/motion';
import { foodActive, poopActive } from '../game/items';
import { length, quatAxisAngle, quatRotate } from '../game/math';
import type { FreeTarget } from '../game/free-motion';
import { FxEngine, type FxFrameFlags } from './trick-fx-engine';
import { RigFxSource } from './trick-fx-anchors';
import { FxRunReader, FxSpinReader } from './trick-fx-sim';
import { ThreeFxSink } from './trick-fx-three';
import { add3 } from '../game/free-math';
import { BOARD_PIVOT_Y, DOG_PIVOT_Y, DOG_SCALE, RIDER_HIP_Y, riderFootHeight } from '../game/free-flight';
import { FollowCamera } from './camera';
import { animateRig, createRig, type Rig } from './models';
import { poseOf, replayPoseAt, type Pose, type ReplayData } from './replay';
import type { Cue } from './effects';
import type { DogId, DogLook } from '../content/types';
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

function sceneColors(dogId: DogId) {
  const { main, partner, light, glint, ink, shade, dust } = DOG_EFFECT_COLORS[dogId];
  return {
    main: new THREE.Color(main), partner: new THREE.Color(partner), light: new THREE.Color(light),
    glint: new THREE.Color(glint), ink: new THREE.Color(ink), shade: new THREE.Color(shade), dust: new THREE.Color(dust),
  };
}

const SCENE_COLORS = { shiba: sceneColors('shiba'), corgi: sceneColors('corgi'), whippet: sceneColors('whippet') };

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

export class Particles {
  readonly points: THREE.Points;
  /** 一時停止中は、粒を動かさず・寿命を減らさず・新しく出さない。 */
  paused = false;
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
  /** dir を与えると、その向き（床の上の角度）を中心に spread の幅で散らす。 */
  emit(n: number, at: THREE.Vector3, color: THREE.Color, speed: number, up: number, life = 0.6, dir?: { x: number; z: number; spread: number }): void {
    if (this.paused) return;
    const center = dir ? Math.atan2(dir.z, dir.x) : 0;
    for (let i = 0; i < n && this.list.length < this.cap; i++) {
      const a = dir ? center + (Math.random() - 0.5) * dir.spread : Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.list.push({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp, life, max: life, r: color.r, g: color.g, b: color.b });
    }
  }
  update(dt: number): void {
    if (this.paused) dt = 0;
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
  clear(): void {
    // 期限が残った足跡も、次の走行や練習のお手本へ持ち越さない。
    this.update(Infinity, 0);
    this.next = 0;
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
  private courseLanguage = language();
  private rig: Rig | null = null;
  private ghostRig: Rig | null = null;
  private ghost: ReplayData | null = null;
  private shadow: THREE.Mesh;
  private rivalRigs: Rig[] = [];
  private rivalDropCursor = 0;
  private rivalItemIds: string[] = [];
  private airFX: { level: number; target: 'B' | 'D' | 'H'; combo: number } | null = null;
  private items = new Map<string, THREE.Object3D>();
  private gates = new Map<string, { bar: THREE.Group; lamp: THREE.Mesh; solid: Solid }>();
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
  /** 81種類の空中・着地演出。決める側（fxReader）と描く側（fxEngine）を分ける。 */
  private fxReader = new FxRunReader();
  private effectDog: DogId | null = null;
  private fxEngine = new FxEngine();
  private fxSink: ThreeFxSink;
  private fxSource = new RigFxSource();
  private fxSelected: FreeTarget = 'common';
  private fxPaused = false;
  private pauseStartMs: number | null = null;
  private pausedTotalMs = 0;
  private fxSpin = new FxSpinReader();
  private fxComboSeen = -1e9;
  private fxReduced: MediaQueryList | null = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  /** 半透明の再生（自分の最速）の演出。保存された演出の出来事があるときだけ描く。 */
  private ghostFx = new FxEngine();
  private ghostFxSink: ThreeFxSink;
  private ghostFxSource = new RigFxSource();
  private ghostFxIndex = 0;
  private ghostFxLastUs = -1;
  /** 検査用：直前のフレームで描いた演出の命令の数。 */
  fxStats = { lines: 0, dots: 0, decals: 0, bursts: 0, ids: [] as string[] };

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
    // 着地の粒は既存の600粒の上限を共有し、1回の着地では最大72粒にする。
    const burst = (n: number, at: THREE.Vector3, color: THREE.Color, speed: number, up: number, life: number, dirX: number, dirZ: number, spread: number) =>
      this.particles.emit(Math.min(72, n), at, color, speed, up, life, { x: dirX, z: dirZ, spread });
    this.fxSink = new ThreeFxSink(burst);
    this.ghostFxSink = new ThreeFxSink(null);
    this.scene.add(this.fxSink.group, this.ghostFxSink.group);
  }

  /** 画面で選んでいる回す対象（踏切直後の演出の対象に使う）。 */
  setFxSelectedTarget(target: FreeTarget): void {
    this.fxSelected = target;
  }

  /** 一時停止中は演出の時計を止め、復帰しても止まっていた分をまとめて描かない。 */
  setFxPaused(paused: boolean): void {
    this.fxPaused = paused;
  }

  /** 連携が実際に成立したことを、一度だけ知らせる（画面の「連携」の印に使う）。 */
  takeFxCombo(): boolean {
    const at = this.fxEngine.lastComboMs;
    if (at <= this.fxComboSeen) return false;
    this.fxComboSeen = at;
    return true;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, h);
  }

  setRider(look: DogLook, clothes: string, helmet: string): void {
    if (this.rig) {
      disposeObjects(this.rig.root);
      this.rig.root.removeFromParent();
    }
    this.rig = createRig(look, clothes, helmet);
    this.scene.add(this.rig.root);
  }

  setGhost(replay: ReplayData | null, look: DogLook | null): void {
    if (this.ghostRig) {
      disposeObjects(this.ghostRig.root);
      this.ghostRig.root.removeFromParent();
    }
    this.ghostRig = null;
    this.ghost = replay;
    this.ghostFx.clear();
    this.ghostFxIndex = 0;
    this.ghostFxLastUs = -1;
    if (replay && look) {
      this.ghostFx.setColors(DOG_EFFECT_COLORS[replay.dogId]);
      this.ghostRig = createRig(look, '#ffffff', '#ffffff', true);
      this.scene.add(this.ghostRig.root);
    }
  }

  private setEffectDog(dogId: DogId): void {
    if (this.effectDog === dogId) return;
    this.effectDog = dogId;
    const { main, partner, light, glint, shade } = SCENE_COLORS[dogId];
    this.fxEngine.setColors(DOG_EFFECT_COLORS[dogId]);
    (this.dogTrail.line.material as THREE.LineBasicMaterial).color.copy(main);
    (this.shoulderTrail.line.material as THREE.LineDashedMaterial).color.copy(partner);
    (this.impact.material as THREE.LineBasicMaterial).color.copy(glint);
    (this.windLines.material as THREE.LineBasicMaterial).color.copy(light);
    if (this.goalTape) (this.goalTape.material as THREE.MeshBasicMaterial).color.copy(light);
    for (const flag of this.flags.values()) {
      ((flag.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial).color.copy(main);
    }
    for (const group of this.guideGroups.values()) {
      const paw = group.children[0] as THREE.Mesh | undefined;
      if (paw) (paw.material as THREE.MeshBasicMaterial).color.copy(shade);
    }
  }

  resetEffects(): void {
    for (const id of this.rivalItemIds) {
      const item = this.items.get(id);
      if (!item) continue;
      item.removeFromParent();
      disposeObjects(item);
      this.items.delete(id);
    }
    this.rivalItemIds = [];
    this.rivalDropCursor = 0;
    for (const rig of this.rivalRigs) rig.root.visible = false;
    this.airFX = null;
    this.particles.clear();
    this.dogTrail.clear();
    this.shoulderTrail.clear();
    this.cam.reset();
    if (this.goalTape) this.goalTape.visible = true;
    this.lastPrintS = 0;
    this.legPhase = 0;
    this.wagUntil = 0;
    this.fxReader.reset();
    this.fxEngine.clear();
    this.fxSpin.reset();
    this.pauseStartMs = null;
    this.ghostFx.clear();
    this.ghostFxIndex = 0;
    this.ghostFxLastUs = -1;
    this.fxComboSeen = -1e9;
    this.impactUntil = 0;
    this.impact.visible = false;
    this.windLines.visible = false;
    this.prints.clear();
    for (const f of this.flags.values()) {
      delete f.userData.raiseAt;
      f.position.y = 0.2;
    }
    for (const guide of this.guideGroups.values()) guide.visible = false;
    for (const o of this.items.values()) o.visible = true;
  }

  setCourse(course: CourseRt): void {
    if (this.course === course && this.courseLanguage === language()) return;
    this.course = course;
    this.courseLanguage = language();
    this.effectDog = null;
    disposeObjects(this.courseGroup);
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
    const newPark = this.course?.def.version === parkFreestyle.version;
    const routeLook = newPark ? parkRouteLooks[p.id] : undefined;
    // 合流部で重なる道は描画の優先順だけを調整し、路面高は走行判定にそろえる。
    const road = new THREE.Mesh(roadGeometry(p), new THREE.MeshLambertMaterial({
      color: routeLook?.road ?? th.road, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetUnits: -order,
    }));
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
      this.courseGroup.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: routeLook?.edge ?? (edge === 'wall' ? th.curb : '#e9e2cf'), side: THREE.DoubleSide })));
    }
    if (newPark && !routeLook) this.buildCurveMarkings(p);
    // 階段
    for (const st of p.stairs) {
      for (let step = 0; step < st.steps; step++) {
        const material = new THREE.MeshLambertMaterial({ color: step % 2 ? '#bdb3a0' : '#cfc6b3', side: THREE.DoubleSide });
        this.courseGroup.add(new THREE.Mesh(stairTreadGeometry(p, st, step), material));
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
      sign.rotation.y = -Math.PI / 2;
      g.add(sign);
      placeOnPath(g, p, ar.s, (ar.side === 'right' ? 1 : -1) * (hwAt(p, ar.s) + 0.6), baseHeight(p, ar.s));
      this.courseGroup.add(g);
    }
    // 分岐の標識（E20）: 分岐の少し手前に、行き先の名前を出す。
    if (p.next.kind === 'fork') {
      const opts = p.next.options;
      const g = new THREE.Group();
      opts.forEach((o, i) => {
        const tex = labelTexture(o.detail ? t(o.detail) : `${o.trick ? '★ ' : ''}${t(o.label)}`, parkRouteLooks[o.to] && o.detail ? parkRouteLooks[o.to].road : o.trick ? '#7a3b00' : '#1f2a37', o.detail ? '#111c26' : '#ffffff');
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(o.detail ? 3.25 : 2.4, 0.74), new THREE.MeshBasicMaterial({ map: tex }));
        const mid = (Math.max(o.xMin, -hwAt(p, p.length)) + Math.min(o.xMax, hwAt(p, p.length))) / 2;
        // 追従カメラより高く掲げ、近づいてくる犬に文字の表を向ける。
        plate.position.set(0, 5.2, mid);
        plate.rotation.y = -Math.PI / 2;
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
        const tex = pawTexture('#ffffff');
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

  private buildCurveMarkings(path: PathRt): void {
    const inside: number[] = [];
    const outside: number[] = [];
    for (let s = 3; s < path.length - 2; s += 3.5) {
      const curve = sampleAt(path, s).kappa;
      if (Math.abs(curve) < 0.012) continue;
      const sign = Math.sign(curve);
      for (const [positions, side] of [[inside, sign], [outside, -sign]] as const) {
        const corner = (at: number, offset: number): number[] => {
          const [x, z] = worldXZ(path, at, side * (hwAt(path, at) - offset));
          return [x, baseHeight(path, at) + 0.035, z];
        };
        const a = corner(s, 0.64), b = corner(s + 0.95, 1.12);
        const c = corner(s + 1.25, 1.02), d = corner(s + 0.5, 0.64);
        positions.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
    for (const [positions, color] of [[inside, '#e3ff93'], [outside, '#ffd05e']] as const) {
      if (!positions.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this.courseGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    }
  }

  private buildSolid(p: PathRt, so: Solid): void {
    if (so.kind === 'rail') {
      const r = so.rail!;
      const pts: THREE.Vector3[] = [];
      const length = r.s1 - r.s0;
      const segments = Math.max(1, Math.min(40, Math.ceil(length / 0.5)));
      for (let i = 0; i <= segments; i++) {
        const s = r.s0 + length * i / segments;
        const [x, z] = worldXZ(p, s, r.x);
        pts.push(new THREE.Vector3(x, railTopAt(r, s) - 0.07, z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.07, 8), new THREE.MeshStandardMaterial({ color: '#e5f3ff', metalness: 0.5, roughness: 0.3 }));
      this.courseGroup.add(tube);
      for (let s = r.s0 + 0.2; s < r.s1; s += 2.5) {
        const top = railTopAt(r, s);
        const base = baseHeight(p, s);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, top - base, 6), new THREE.MeshLambertMaterial({ color: '#8b949e' }));
        placeOnPath(post, p, s, r.x, base + (top - base) / 2);
        this.courseGroup.add(post);
      }
      return;
    }
    if (so.kind === 'kicker') {
      this.courseGroup.add(new THREE.Mesh(solidGeometry(p, so),
        new THREE.MeshLambertMaterial({ color: '#f08a24', side: THREE.DoubleSide })));
      return;
    }
    if (so.kind === 'gate') {
      const g = new THREE.Group();
      const width = so.x1 - so.x0;
      const bone = new THREE.MeshLambertMaterial({ color: '#f5f0e1' });
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, width, 12), bone);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = -0.12;
      g.add(bar);
      for (const z of [-(width / 2 - 0.18), width / 2 - 0.18]) {
        for (const dy of [-0.28, -0.18]) {
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bone);
          knob.scale.x = 0.15 / 0.18;
          knob.position.set(0, dy, z);
          g.add(knob);
        }
      }
      const holder = new THREE.Group();
      holder.add(g);
      placeOnPath(holder, p, (so.s0 + so.s1) / 2, (so.x0 + so.x1) / 2, baseHeight(p, so.s0));
      this.courseGroup.add(holder);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#552222' }));
      const roadEdge = hwAt(p, so.s0) + 0.4;
      const lampX = so.x1 < 0 ? -roadEdge : roadEdge;
      placeOnPath(lamp, p, so.s0 - 0.6, lampX, baseHeight(p, so.s0) + 1.6);
      this.courseGroup.add(lamp);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshLambertMaterial({ color: '#555555' }));
      placeOnPath(post, p, so.s0 - 0.6, lampX, baseHeight(p, so.s0) + 0.8);
      this.courseGroup.add(post);
      this.gates.set(so.id, { bar: g, lamp, solid: so });
      return;
    }
    const color = so.kind === 'fence' ? '#f4f1ea' : so.look === 'planter' ? '#6d9c4f' : so.look === 'shop' ? '#b5835a' : '#9aa5b1';
    this.courseGroup.add(new THREE.Mesh(solidGeometry(p, so), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
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
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ map: labelTexture('◢ ' + t('踏切台'), '#0b4f8a', '#ffffff', 384, 256), side: THREE.DoubleSide }));
      placeOnPath(sign, p, so.s0 - 0.02, (so.x0 + so.x1) / 2, base + so.height * 0.6);
      sign.rotation.y -= Math.PI / 2;
      this.courseGroup.add(sign);
    }
  }

  private buildItem(p: PathRt, id: string, kind: 'food' | 'poop' | 'guide' | 'bone', s: number, x: number, y: number): void {
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
      const m = new THREE.MeshLambertMaterial(kind === 'bone'
        ? { color: '#eefff8', emissive: '#00a988' } : { color: '#fff4cf', emissive: '#4a3c10' });
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
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, hw * 2 + 0.9), new THREE.MeshBasicMaterial({ map: labelTexture(t('ゴール'), '#d7263d', '#ffffff', 512, 96) }));
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
    this.setEffectDog(run.id.dogId);
    const colors = SCENE_COLORS[run.id.dogId];
    // 一時停止中は、粒・足跡・旗・アイテムの動き・演出の時計をまとめて止める（停止していた時間は後から進めない）。
    if (this.fxPaused && this.pauseStartMs === null) this.pauseStartMs = nowMs;
    if (!this.fxPaused && this.pauseStartMs !== null) { this.pausedTotalMs += nowMs - this.pauseStartMs; this.pauseStartMs = null; }
    const vnow = (this.pauseStartMs ?? nowMs) - this.pausedTotalMs;
    this.particles.paused = this.fxPaused;
    const dt = this.fxPaused ? 0 : Math.min(0.1, dtMs / 1000);
    const lightK = settings.light === 'weak' ? 0.35 : 1;
    const path = course.paths.get(run.pathId)!;
    const ex = extrapolate(run, renderUs);
    const pose = poseOf(run, ex.s, ex.x, ex.y, run.finished ? run.simUs : renderUs);
    this.placeRig(this.rig, pose);
    const grade = run.mode === 'ground' ? supportGrade(path, run.s, run.x, run.y, run.simUs) : 0;
    const speed = run.finished ? 0 : run.forwardSpeed;
    this.legPhase += dt * (3 + speed * 1.6);
    const feetDown = run.mode === 'air' && run.vy < 0 && (run.jump?.resolution.rotations ?? []).every((r) => renderUs >= r.startUs + r.durUs);
    animateRig(this.rig, { mode: run.mode, speed, maxSpeed: maxSpeed(run), grade, lean: run.lateralSpeed / 4.5, feetDown, blocked: !!run.blocked, timeMs: vnow, wag: wag || vnow < this.wagUntil, free: !!pose.free }, this.legPhase);
    this.rig.root.visible = run.mode !== 'falling' || vnow % 200 < 100;

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
    const omega = run.freeFlight?.motion.omega;
    const dogSpinning = omega ? length(add3(omega.common, omega.dog)) > 0.3 : rots.some((r) => r.channel === 'dog' && renderUs >= r.startUs && renderUs < r.startUs + r.durUs);
    const bodySpinning = omega ? length(add3(omega.common, omega.rider)) > 0.3 : rots.some((r) => r.channel === 'body' && renderUs >= r.startUs && renderUs < r.startUs + r.durUs);
    this.rig.root.updateMatrixWorld(true);
    // 自由回転では81種類の軌跡（実際の四足・手・靴などに追従）を使い、従来の2本線は旧ルールだけに残す。
    const legacyTrails = !omega;
    if (legacyTrails && dogSpinning) this.dogTrail.push(this.rig.paw.getWorldPosition(new THREE.Vector3()));
    else this.dogTrail.fade();
    if (legacyTrails && bodySpinning) this.shoulderTrail.push(this.rig.shoulder.getWorldPosition(new THREE.Vector3()));
    else this.shoulderTrail.fade();

    // 81種類の演出：走行の時計で段階を決め（描画の速さに左右されない）、実際の身体の計測点から描く。
    const reduced = this.fxReduced?.matches ?? false;
    // 回転の向き・速さ・累積角は、ゲームが計算した値を描画の時刻で読む（描画の前後の姿勢差からは求めない）。
    const flight = run.freeFlight;
    const spin = flight && run.jump ? this.fxSpin.read(flight.motion, `${run.id.runId}:${run.jump.jumpId}`, Math.max(flight.takeoffUs, renderUs)) : null;
    const fxFlags: FxFrameFlags = { reduced, weak: settings.light === 'weak', paused: this.fxPaused, alpha: 1, heading: pose.heading, groundY, spin };
    if (!flight) this.airFX = null;
    if (!this.fxPaused) {
      for (const { ev, source } of this.fxReader.read(run, this.fxSelected)) {
        if (ev.kind === 'F' && ev.target) this.airFX = { target: ev.target, level: ev.level, combo: this.airFX?.combo ?? 0 };
        if (ev.kind === 'C' && this.airFX) this.airFX.combo = ev.level;
        if (ev.kind === 'X' || ev.kind === 'L') this.airFX = null;
        this.fxSource.rig = this.rig;
        this.fxEngine.apply(ev, ev.contact ? { contact: ev.contact, yaw: ev.contact.yaw, grade: ev.contact.grade,
          switchCount: Number(source?.data?.switchCount ?? 0) + Number(source?.data?.directionCount ?? 0), source: this.fxSource, sourceHeading: pose.heading } : {});
      }
    }
    this.fxSource.rig = this.rig;
    this.fxSink.begin();
    this.fxEngine.frame(dtMs, this.fxSource, this.fxSink, fxFlags);
    this.fxSink.end();
    this.fxStats = { ...this.fxSink.stats, ids: this.fxEngine.activeIds() };

    const at = new THREE.Vector3(pose.x, pose.y, pose.z);
    const fwd = new THREE.Vector3(Math.cos(pose.heading), 0, Math.sin(pose.heading));
    const sand = colors.dust;
    for (const c of cues) {
      switch (c.visual) {
        case 'sandBurst':
        case 'kickMark':
        case 'kickMarkBig':
          this.particles.emit(Math.round((c.visual === 'kickMarkBig' ? 26 : 12) * lightK + 4), at, sand, c.visual === 'kickMarkBig' ? 3 : 2, 2);
          this.prints.add(new THREE.Vector3(pose.x, groundY + 0.03, pose.z), pose.heading, colors.shade, vnow, c.visual === 'kickMarkBig' ? 2.2 : 1.4);
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
            this.prints.add(new THREE.Vector3(pose.x, groundY + 0.03, pose.z).addScaledVector(fwd, dx).addScaledVector(right, dz), pose.heading, colors.light, vnow, 0.9);
          }
          break;
        case 'pawTrails':
          // 複合成功: 2本の軌跡が足跡の形で重なる（R64）。
          for (const pt of [...this.dogTrail.points(), ...this.shoulderTrail.points()].filter((_, i) => i % 4 === 0)) {
            this.prints.add(new THREE.Vector3(pt.x, Math.max(groundY + 0.04, pt.y), pt.z), pose.heading, colors.partner, vnow, 1.1);
          }
          break;
        case 'impactLines':
          this.showImpact(at.clone().addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, 0.5, 0)), vnow);
          if (settings.shake) this.cam.kick(0.25);
          break;
        case 'underRotatedLabel':
          if (settings.shake) this.cam.kick(0.12);
          this.particles.emit(10, at, sand, 1.5, 0.5);
          break;
        case 'flagUp': {
          const f = c.objId ? this.flags.get(c.objId) : null;
          if (f) f.userData.raiseAt = vnow;
          break;
        }
        case 'tape':
          if (this.goalTape) this.goalTape.visible = false;
          this.particles.emit(Math.round(40 * lightK + 6), at.clone().add(new THREE.Vector3(0, 1.5, 0)), colors.glint, 4, 3, 1.2);
          break;
        case 'tailWag':
          this.wagUntil = vnow + 1200;
          break;
      }
      if (c.effect === 'E18' && c.visual === 'boostGauge') this.particles.emit(10, at, colors.main, 2, 1.5);
    }
    // 手すりの接点の光（滑走中だけ、速いほど多い）
    if (run.mode === 'rail') {
      const n = Math.max(1, Math.round(speed * 0.6 * lightK));
      this.particles.emit(n, new THREE.Vector3(pose.x, pose.y + 0.02, pose.z), colors.light, 1.5 + speed * 0.15, 1.2, 0.35);
    }
    // 走るほど砂つぶと足跡（R61）。糞を踏んだ間は濃い足跡（R68）。
    const slowed = poopActive(run.effects, run.simUs);
    if (run.mode === 'ground' && speed > 0.5) {
      if (Math.random() < Math.min(1, speed / 10) * 0.6 * lightK) this.particles.emit(1, new THREE.Vector3(pose.x, groundY + 0.05, pose.z), sand, 0.8, 0.8, 0.4);
      if (Math.abs(run.s - this.lastPrintS) > (slowed ? 0.45 : 0.9)) {
        this.lastPrintS = run.s;
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const sideOff = (Math.round(run.s / 0.9) % 2 ? 0.12 : -0.12);
        this.prints.add(new THREE.Vector3(pose.x, groundY + 0.025, pose.z).addScaledVector(right, sideOff), pose.heading, slowed ? colors.ink : colors.shade, vnow, slowed ? 1 : 0.7);
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
        const start = at.clone().addScaledVector(right, off * 1.4).addScaledVector(fwd, -0.6 - ((vnow / 40 + i * 13) % 10) / 6);
        start.y = y;
        const end = start.clone().addScaledVector(fwd, -(boosted ? 1.6 : 0.9));
        a.setXYZ(i * 2, start.x, start.y, start.z);
        a.setXYZ(i * 2 + 1, end.x, end.y, end.z);
      }
      a.needsUpdate = true;
      (this.windLines.material as THREE.LineBasicMaterial).opacity = 0.6 * lightK + 0.15;
    }
    if (this.impact.visible && vnow > this.impactUntil) this.impact.visible = false;

    this.frameRivals(run, vnow);

    // アイテム、ゲート、旗、道しるべの足跡
    const progress = run.rivals ? uAtS(path, run.s) : 0;
    for (const [id, o] of this.items) {
      const rivalProgress = o.userData.rivalProgress as number | undefined;
      o.visible = !run.consumed[id] && (rivalProgress === undefined || (rivalProgress > progress - 18 && rivalProgress < progress + 90));
      if (!o.visible) continue;
      o.rotation.y += dt * 1.2;
      o.position.y = (o.userData.baseY as number) + Math.sin(vnow / 300 + o.position.x) * 0.05;
    }
    for (const g of this.gates.values()) {
      const ph = gatePhase(g.solid.gate!, run.simUs);
      g.bar.position.y = g.solid.height * ph.raise;
      g.bar.visible = ph.raise > 0;
      (g.lamp.material as THREE.MeshBasicMaterial).color.set(ph.phase === 'lamp' || ph.phase === 'rising' ? (vnow % 300 < 150 ? '#ff4040' : '#aa2020') : '#552222');
    }
    for (const [id, f] of this.flags) {
      const t0 = f.userData.raiseAt as number | undefined;
      const passed = run.lastCheckpoint.id === id || (t0 !== undefined);
      f.position.y = passed ? Math.min(1.85, 0.2 + (t0 ? (vnow - t0) / 300 : 2)) : 0.2;
    }
    for (const [forkId, g] of this.guideGroups) {
      g.visible = run.guide.active && (run.guide.forkId === null || run.guide.forkId === forkId);
    }

    // 自分の最速の走り（半透明）。見るためだけで、計算には関与しない。
    if (this.ghostRig && this.ghost && settings.ghost) {
      const gp = replayPoseAt(this.ghost, renderUs);
      this.ghostRig.root.visible = !!gp;
      if (gp) this.placeRig(this.ghostRig, gp);
      this.frameGhostFx(renderUs, gp, dtMs, settings, groundY);
    } else if (this.ghostRig) {
      this.ghostRig.root.visible = false;
      // 非表示の間は演出を持たない。再び表示したら、その時刻の出来事から組み立て直す。
      this.ghostFx.clear();
      this.ghostFxIndex = 0;
      this.ghostFxLastUs = -1;
      this.ghostFxSink.begin();
      this.ghostFxSink.end();
    }

    this.particles.update(dt);
    this.prints.update(vnow, 2600);
    this.cam.update(path, ex.s, ex.x, ex.y, dtMs, settings.shake, run.freeFlight?.heading);
    this.sun.intensity = 1.2 + 0.4 * lightK;
    this.renderer.render(this.scene, this.cam.camera);
  }

  /**
   * 保存された演出の出来事を、半透明の再生の身体に合わせて描く（F06）。
   * 着地L は出来事に残した接地点で描き、そのときのゴーストの位置へはずらさない。
   * 接地点の無い記録は、その時刻の再生姿勢から求め、求められなければ着地の飾りだけ省く。出来事の無い古い記録は演出なし。
   */
  private frameGhostFx(renderUs: number, gp: Pose | null, dtMs: number, settings: Settings, groundY: number): void {
    const replay = this.ghost;
    const events = replay?.visualEvents;
    this.ghostFxSink.begin();
    if (replay && events && events.length && this.ghostRig) {
      if (renderUs < this.ghostFxLastUs) { this.ghostFx.clear(); this.ghostFxIndex = 0; }
      this.ghostFxLastUs = renderUs;
      while (!this.fxPaused && this.ghostFxIndex < events.length && events[this.ghostFxIndex].tUs <= renderUs) {
        const ev = events[this.ghostFxIndex++];
        // 表示を再開したときなど、とうに終わった出来事は描き直さない。
        if (ev.tUs < renderUs - 2_100_000) continue;
        const ageMs = (renderUs - ev.tUs) / 1000;
        if (ev.kind !== 'L') { this.ghostFx.apply(ev); continue; }
        const then = replayPoseAt(replay, ev.tUs);
        const contact = ev.contact ?? (then ? { x: then.x, y: then.y, z: then.z, yaw: then.heading } : null);
        if (!contact || !then) { this.ghostFx.apply({ ...ev, kind: 'X', id: null }); continue; }
        // 計測点をその時刻の姿勢で読んでから固定する。
        this.placeRig(this.ghostRig, then);
        this.ghostRig.root.updateMatrixWorld(true);
        this.ghostFxSource.rig = this.ghostRig;
        this.ghostFx.apply(ev, { contact, yaw: contact.yaw, grade: contact.grade, ageMs, source: this.ghostFxSource, sourceHeading: then.heading });
      }
      if (gp) this.placeRig(this.ghostRig, gp);
      this.ghostRig.root.updateMatrixWorld(true);
      this.ghostFxSource.rig = gp ? this.ghostRig : null;
      this.ghostFx.frame(dtMs, this.ghostFxSource, this.ghostFxSink, {
        reduced: this.fxReduced?.matches ?? false, weak: settings.light === 'weak', paused: this.fxPaused, alpha: 0.35,
        heading: gp?.heading ?? 0, groundY,
      });
    }
    this.ghostFxSink.end();
  }

  projectTrack(pathId: string, s: number, x: number, y: number): { x: number; y: number } {
    const path = this.course!.paths.get(pathId)!;
    const [wx, wz] = worldXZ(path, s, x);
    const p = new THREE.Vector3(wx, y, wz).project(this.cam.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  airImpact(run: SimState) {
    if (!run.freeFlight || !this.airFX || !Object.values(run.freeFlight.motion.omega).some(v => length(v) > 2)) return null;
    return this.airFX;
  }

  private frameRivals(run: SimState, nowMs: number): void {
    const rivals = run.rivals;
    if (!rivals) return;
    if (this.rivalRigs.length === 0) {
      this.rivalRigs = [
        createRig(DOGS.corgi.look, '#8d42f4', '#fff079'),
        createRig(DOGS.whippet.look, '#106692', '#30efb2'),
      ];
      this.scene.add(...this.rivalRigs.map(rig => rig.root));
    }
    for (const [index, rig] of this.rivalRigs.entries()) {
      const pose = rivalPose(rivals.plans[index], rivals.elapsedUs);
      rig.root.visible = !!pose;
      if (!pose) continue;
      const [x, z] = worldXZ(pose.path, pose.s, pose.x);
      const y = baseHeight(pose.path, pose.s) + pose.height;
      this.placeRig(rig, { x, y, z, heading: pose.heading,
        body: quatAxisAngle(index ? [0, 0, 1] : [0, 1, 0], pose.angle), dog: [0, 0, 0, 1] });
      animateRig(rig, { mode: pose.height > 0 ? 'air' : 'ground', speed: pose.speed, maxSpeed: 18,
        grade: 0, lean: 0, feetDown: false, blocked: false, timeMs: nowMs, wag: false },
        rivals.elapsedUs / 1e6 * (pose.speed > 0 ? 18 : 0));
    }
    const progress = uAtS(this.course!.paths.get(run.pathId)!, run.s);
    while (this.rivalDropCursor < rivals.nextDrop) {
      for (const item of rivals.drops[this.rivalDropCursor++].items) {
        const path = run.course.paths.get(item.pathId)!;
        this.buildItem(path, item.id, 'poop', item.s, item.x, item.y);
        this.rivalItemIds.push(item.id);
        const model = this.items.get(item.id)!;
        model.scale.setScalar(1.36);
        model.userData.rivalProgress = uAtS(path, item.s);
        if (Math.abs(model.userData.rivalProgress - progress) < 65) {
          this.particles.emit(9, model.position, SCENE_COLORS[item.id.startsWith('rival-0-') ? 'corgi' : 'whippet'].shade, 3.8, 2.7);
        }
      }
    }
  }

  private placeRig(rig: Rig, pose: Pose): void {
    rig.root.position.set(pose.x, pose.y, pose.z);
    if (pose.free) {
      const { dog, rider } = pose.free;
      const hipOffset = quatRotate(rider.q, [0, RIDER_HIP_Y, 0]);
      rig.root.quaternion.identity();
      rig.board.quaternion.identity();
      rig.dog.position.set(dog.p[0], dog.p[1] - BOARD_PIVOT_Y, dog.p[2]);
      rig.dog.quaternion.set(...dog.q);
      rig.rider.position.set(rider.p[0] - hipOffset[0], rider.p[1] - hipOffset[1] - BOARD_PIVOT_Y, rider.p[2] - hipOffset[2]);
      rig.rider.quaternion.set(...rider.q);
      return;
    }
    rig.dog.position.set(0, DOG_PIVOT_Y * DOG_SCALE - BOARD_PIVOT_Y, 0);
    rig.rider.position.set(0, riderFootHeight(rig.look) - BOARD_PIVOT_Y, 0);
    rig.rider.quaternion.identity();
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

  // ---------------------------------------------------------------- 技の練習
  private lab: TrickLabStage | null = null;

  /** 技の練習の場面へ切り替える。描画装置・犬種・服装・照明の設定は競技と共有する。 */
  setTrickLabStage(fixture: LabFixtureId, edge: LabEdge | null, look: DogLook, clothes: string, helmet: string, dogId: DogId): void {
    if (!this.lab) this.lab = new TrickLabStage();
    this.lab.setRider(look, clothes, helmet, DOG_EFFECT_COLORS[dogId]);
    this.lab.setFixture(fixture, edge);
  }

  frameTrickLab(pose: LabPose, highlight: Handle | null, dtMs: number, reducedMotion: boolean, band: { left: number; top: number; right: number; bottom: number }): void {
    this.lab?.frame(this.renderer, pose, highlight, dtMs, reducedMotion, band);
  }

  /** 技の練習を出るときに、練習用の立体を片付ける。 */
  clearTrickLabStage(): void {
    this.lab?.dispose();
    this.lab = null;
  }

  dispose(): void {
    this.clearTrickLabStage();
    this.fxSink.dispose();
    this.ghostFxSink.dispose();
    disposeObjects(this.scene);
    this.scene.clear();
    this.renderer.dispose();
  }
}
