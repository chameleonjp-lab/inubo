import * as THREE from 'three';
import { freeParts } from '../game/free-geometry';
import { freeBoxes, type FreeScenario } from '../game/free-arena';
import type { FreePose } from '../game/free-motion';
import { FxEngine, type FxSpinSample } from './trick-fx-engine';
import { FreePartsFxSource } from './trick-fx-anchors';
import { ThreeFxSink } from './trick-fx-three';
import type { FxVisualEvent } from './trick-fx-timeline';

export interface FreeFxFlags { paused: boolean; reduced: boolean; dtMs: number; spin?: FxSpinSample | null }

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
  }
  private material(color: string): THREE.MeshStandardMaterial {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    return this.materials.get(color)!;
  }
  /**
   * 確認用の背景（光の見え方を確かめるため）。明るい空・明るい路面・暗い路面。
   * 演出・判定には関係しない。
   */
  setBackdrop(kind: 'sky' | 'bright-road' | 'dark-road'): void {
    const [sky, floor, line] = kind === 'bright-road' ? ['#f3f1ea', '#e6dfcf', '#d2c8b3'] : kind === 'dark-road' ? ['#5f6a73', '#3a3e44', '#4a5058'] : ['#d7eced', '#a5bcad', '#94afa1'];
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
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    const parts = freeParts(pose);
    for (const part of parts) {
      let mesh = this.parts.get(part.id);
      if (!mesh) { mesh = new THREE.Mesh(this.geometry, this.material(part.color)); this.parts.set(part.id, mesh); this.scene.add(mesh); }
      mesh.position.set(...part.p); mesh.scale.setScalar(part.radius);
    }
    // 競技と同じ81種類の演出を、球の模型の足・手・靴・鼻・耳・しっぽの位置から描く。
    this.fxSource.update(pose, parts);
    this.fxSink.begin();
    this.fx.frame(flags.dtMs, this.fxSource, this.fxSink, { reduced: flags.reduced, weak: false, paused: flags.paused, alpha: 1, heading: 0, groundY: 0, spin: flags.spin });
    this.fxSink.end();
    this.fxStats = { ...this.fxSink.stats };
    // 水平の視点を保ち、パッドの右向き入力が水平回転になるようにする.
    const focus = new THREE.Vector3(pose.pivot[0], 1.25 + Math.max(0, pose.dog.p[1] - 0.5) * 0.7, 0);
    this.camera.position.copy(focus).add(new THREE.Vector3(4.5, 0, 6.75)); this.camera.lookAt(focus);
    this.renderer.render(this.scene, this.camera);
  }
}
