import * as THREE from 'three';
import { freeParts } from '../game/free-geometry';
import { FreeArena, freeBoxes, type FreeScenario } from '../game/free-arena';
import type { FreePose, FreeTarget } from '../game/free-motion';
import { FxSpinReader } from './trick-fx-sim';
import { fxProgram, type FxId } from './trick-fx-81';
import { FIXTURE_AIR_START_US, FIXTURE_STEP_MS, classifyFixture, fixtureTimes, type FixtureBackdrop, type FixtureDiff, type FixturePhase, type FixtureResult } from './fx-fixture';
import type { FxSink } from './trick-fx-pen';
import { FxEngine, type FxSpinSample } from './trick-fx-engine';
import { FreePartsFxSource } from './trick-fx-anchors';
import { ThreeFxSink } from './trick-fx-three';
import type { FxVisualEvent } from './trick-fx-timeline';

export interface FreeFxFlags { paused: boolean; reduced: boolean; weak?: boolean; dtMs: number; spin?: FxSpinSample | null }

export class FreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  private parts = new Map<string, THREE.Mesh>();
  private geometry = new THREE.SphereGeometry(1, 12, 8);
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private obstacles: THREE.Mesh[] = [];
  /** 競技と同じ81種類の演出。球の模型の部品の位置を計測点として読む。 */
  readonly fx = new FxEngine();
  private floor!: THREE.Mesh;
  private grid!: THREE.GridHelper;
  private fxSource = new FreePartsFxSource();
  private fxSink = new ThreeFxSink(null);
  fxStats = { lines: 0, dots: 0, decals: 0, bursts: 0 };
  /** 背景だけの壁（ぶつからない飾り）。衝突のある「壁あり」とは別。 */
  private wallDeco: THREE.Mesh;
  private contextLost = false;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#d7eced'); this.scene.fog = new THREE.Fog('#d7eced', 14, 40);
    this.scene.add(new THREE.HemisphereLight('#fff9ed', '#739188', 3));
    const sun = new THREE.DirectionalLight('#fff1d5', 3); sun.position.set(4, 8, 5); this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#a5bcad', roughness: 0.75 }));
    this.floor = floor;
    floor.rotation.x = -Math.PI / 2; floor.position.set(20, -0.002, 0); this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 100, '#729b8d', '#94afa1'); grid.position.set(20, 0, 0); this.scene.add(grid);
    this.grid = grid;
    this.scene.add(this.fxSink.group);
    this.wallDeco = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshStandardMaterial({ color: '#c9a48f', roughness: 0.9 }));
    this.wallDeco.visible = false;
    this.scene.add(this.wallDeco);
    canvas.addEventListener('webglcontextlost', () => { this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
  }
  private material(color: string): THREE.MeshStandardMaterial {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    return this.materials.get(color)!;
  }
  /**
   * 確認用の背景（光の見え方を確かめるため）。明るい空・明るい路面・暗い路面。
   * 演出・判定には関係しない。
   */
  setBackdrop(kind: FixtureBackdrop): void {
    const [sky, floor, line] = kind === 'bright-road' ? ['#f3f1ea', '#e6dfcf', '#d2c8b3'] : kind === 'dark-road' ? ['#5f6a73', '#3a3e44', '#4a5058'] : ['#d7eced', '#a5bcad', '#94afa1'];
    // 「壁の前」は背景に壁を描くだけで、跳躍は止めない（光の見え方だけを確かめる）。
    this.wallDeco.visible = kind === 'wall';
    this.renderer.setClearColor(sky);
    (this.scene.fog as THREE.Fog).color.set(sky);
    (this.floor.material as THREE.MeshStandardMaterial).color.set(floor);
    this.grid.visible = kind !== 'bright-road';
    void line;
  }

  /** 確認用：演出だけを隠して、前後を見比べる。 */
  setFxVisible(visible: boolean): void {
    this.fxSink.group.visible = visible;
  }

  setScenario(s: FreeScenario): void {
    for (const mesh of this.obstacles) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.obstacles = freeBoxes(s).map(b => {
      const size = b.max.map((v, i) => v - b.min[i]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), this.material(b.color));
      m.position.set(...b.min.map((v, i) => (v + b.max[i]) / 2) as [number, number, number]); this.scene.add(m); return m;
    });
  }
  /** 演出の出来事を受け取る。着地は球の模型の真下（床の高さ0）を接地点にする。 */
  applyFx(ev: FxVisualEvent, pose: FreePose): void {
    this.fx.apply(ev, { contact: { x: pose.pivot[0], y: 0, z: pose.pivot[2] }, yaw: 0 });
  }
  draw(pose: FreePose, flags: FreeFxFlags = { paused: false, reduced: false, dtMs: 16 }): void {
    if (!this.fitCanvas()) return;
    this.drawWith(this.fx, pose, flags, this.fxSink);
    this.renderer.render(this.scene, this.camera);
  }

  private fitCanvas(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return false;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    return true;
  }

  /** 身体の球を置き、演出を1コマ進め、カメラを合わせる（描画はしない）。sink が null なら演出は描かずに進めるだけ。 */
  private drawWith(engine: FxEngine, pose: FreePose, flags: FreeFxFlags, sink: FxSink | null): void {
    const parts = freeParts(pose);
    for (const part of parts) {
      let mesh = this.parts.get(part.id);
      if (!mesh) { mesh = new THREE.Mesh(this.geometry, this.material(part.color)); this.parts.set(part.id, mesh); this.scene.add(mesh); }
      mesh.position.set(...part.p); mesh.scale.setScalar(part.radius);
    }
    // 競技と同じ81種類の演出を、球の模型の足・手・靴・鼻・耳・しっぽの位置から描く。
    this.fxSource.update(pose, parts);
    const target = sink ?? NULL_SINK;
    if (sink === this.fxSink) this.fxSink.begin();
    engine.frame(flags.dtMs, this.fxSource, target, { reduced: flags.reduced, weak: flags.weak ?? false, paused: flags.paused, alpha: 1, heading: 0, groundY: 0, spin: flags.spin });
    if (sink === this.fxSink) { this.fxSink.end(); this.fxStats = { ...this.fxSink.stats }; }
    // 水平の視点を保ち、パッドの右向き入力が水平回転になるようにする.
    const focus = new THREE.Vector3(pose.pivot[0], 1.25 + Math.max(0, pose.dog.p[1] - 0.5) * 0.7, 0);
    this.camera.position.copy(focus).add(new THREE.Vector3(4.5, 0, 6.75)); this.camera.lookAt(focus);
    if (this.wallDeco.visible) {
      // カメラから見て身体の奥に、カメラへ向けて置く。
      const back = new THREE.Vector3(-4.5, 0, -6.75).normalize().multiplyScalar(2.4);
      this.wallDeco.position.copy(focus).add(back);
      this.wallDeco.position.y = 2.2;
      this.wallDeco.lookAt(this.camera.position.x, 2.2, this.camera.position.z);
    }
  }

  /**
   * 固定比較（Q02）：決まった跳躍と回転を固定の刻みで進め、指定の時刻で「演出あり」「演出なし」を同じ姿勢・同じカメラで描いて比べる。
   * 画面の時計・操作・描画の速さには左右されない。終わったあと、画面には「演出あり」の絵が残る。
   */
  renderFixture(id: FxId, phase: FixturePhase, backdrop: FixtureBackdrop, opts: { reduced?: boolean; weak?: boolean; image?: boolean; tMs?: number } = {}): FixtureResult & { image?: string } {
    const prog = fxProgram(id);
    const tMs = opts.tMs ?? fixtureTimes(prog)[phase];
    const dpr = this.renderer.getPixelRatio();
    const base = { id, phase, tMs, backdrop, viewport: { width: this.canvas.clientWidth, height: this.canvas.clientHeight, dpr } };
    if (!this.fitCanvas() || this.contextLost) {
      return { ...base, ...classifyFixture(id, [], { lines: 0, dots: 0, decals: 0 }, null, this.contextLost), activeIds: [], commands: { lines: 0, dots: 0, decals: 0 }, diff: null };
    }
    this.setBackdrop(backdrop);
    const engine = new FxEngine();
    const spin = new FxSpinReader();
    const arena = new FreeArena('flat');
    const target: FreeTarget = prog.target === 'B' ? 'common' : prog.target === 'D' ? 'dog' : 'rider';
    arena.jump(true);
    arena.advance(0, [{ seq: 1, atUs: 0, target, rotation: [0.2, 0.08, 0.75] }]);
    const ev = (kind: 'F' | 'A' | 'L' | 'C', fxid: FxId | null, level: number) => ({ tUs: 0, jumpId: 1, kind, target: prog.target, level, id: fxid });
    const flags = (): FreeFxFlags => ({ paused: false, reduced: !!opts.reduced, weak: !!opts.weak, dtMs: FIXTURE_STEP_MS,
      spin: arena.phase === 'air' ? spin.read(arena.motion, 'fixture', arena.motion.timeUs) : null });
    let startedUs: number | null = null;
    let timeUs = 0;
    if (prog.kind === 'L') engine.apply(ev('A', `${prog.target}-A07` as FxId, 7));
    // 演出が始まるまでと、始まってから tMs までを、固定の刻みで進める。
    for (let guard = 0; guard < 2_000; guard++) {
      timeUs += FIXTURE_STEP_MS * 1000;
      arena.advance(timeUs);
      const pose = arena.motion.pose;
      if (startedUs === null) {
        if (prog.kind !== 'L' && timeUs >= FIXTURE_AIR_START_US) {
          engine.apply(ev(prog.kind as 'F' | 'A', prog.id, prog.level));
          if (prog.kind === 'F') engine.apply(ev('C', null, 1));
          startedUs = timeUs;
        } else if (prog.kind === 'L' && arena.phase === 'done') {
          engine.apply(ev('L', prog.id, prog.level), { contact: { x: pose.pivot[0], y: 0, z: pose.pivot[2] }, yaw: 0, source: this.fxSource, sourceHeading: 0 });
          startedUs = timeUs;
        }
      }
      const last = startedUs !== null && timeUs - startedUs >= tMs * 1000;
      this.drawWith(engine, pose, flags(), last ? this.fxSink : null);
      if (last) break;
    }
    const activeIds = engine.activeIds();
    const commands = { lines: this.fxStats.lines, dots: this.fxStats.dots, decals: this.fxStats.decals };
    // 同じ姿勢・同じカメラで、演出あり→なしの順に描いて読み取る。
    this.fxSink.group.visible = true;
    this.renderer.render(this.scene, this.camera);
    const withFx = this.readPixels();
    const image = opts.image ? this.canvas.toDataURL('image/png') : undefined;
    this.fxSink.group.visible = false;
    this.renderer.render(this.scene, this.camera);
    const withoutFx = this.readPixels();
    this.fxSink.group.visible = true;
    this.renderer.render(this.scene, this.camera);
    const diff = withFx && withoutFx ? this.compare(withFx, withoutFx, arena.motion.pose) : null;
    return { ...base, ...classifyFixture(id, activeIds, commands, diff, this.contextLost), activeIds, commands, diff, ...(image ? { image } : {}) };
  }

  private readPixels(): { data: Uint8Array; w: number; h: number } | null {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!w || !h) return null;
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, w, h };
  }

  /** 犬と人のまわり（支点から左右前後1.6m、床から頭の上まで）を画面へ写した範囲で、画素の差を数える。 */
  private compare(a: { data: Uint8Array; w: number; h: number }, b: { data: Uint8Array; w: number; h: number }, pose: FreePose): FixtureDiff {
    const { w, h } = a;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    const v = new THREE.Vector3();
    for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) for (const y of [-0.05, pose.pivot[1] + 2]) {
      v.set(pose.pivot[0] + dx, y, pose.pivot[2] + dz).project(this.camera);
      const sx = (v.x + 1) / 2 * w, sy = (v.y + 1) / 2 * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    let changed = 0, strong = 0, maxDelta = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 30) changed++;
      if (d > 90) strong++;
      if (d > maxDelta) maxDelta = d;
    }
    return { roiPixels: Math.max(0, x1 - x0) * Math.max(0, y1 - y0), changed, strong, maxDelta };
  }
}

const NULL_SINK: FxSink = { line() {}, dot() {}, decal() {}, burst() {} };
