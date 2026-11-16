import * as THREE from 'three';
import { freeParts } from '../game/free-geometry';
import { freeBoxes, type FreeScenario } from '../game/free-arena';
import type { FreePose } from '../game/free-motion';

export class FreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  private parts = new Map<string, THREE.Mesh>();
  private geometry = new THREE.SphereGeometry(1, 12, 8);
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private obstacles: THREE.Mesh[] = [];
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#d7eced'); this.scene.fog = new THREE.Fog('#d7eced', 14, 40);
    this.scene.add(new THREE.HemisphereLight('#fff9ed', '#739188', 3));
    const sun = new THREE.DirectionalLight('#fff1d5', 3); sun.position.set(4, 8, 5); this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), this.material('#a5bcad'));
    floor.rotation.x = -Math.PI / 2; floor.position.set(20, -0.002, 0); this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 100, '#729b8d', '#94afa1'); grid.position.set(20, 0, 0); this.scene.add(grid);
  }
  private material(color: string): THREE.MeshStandardMaterial {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    return this.materials.get(color)!;
  }
  setScenario(s: FreeScenario): void {
    for (const mesh of this.obstacles) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.obstacles = freeBoxes(s).map(b => {
      const size = b.max.map((v, i) => v - b.min[i]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), this.material(b.color));
      m.position.set(...b.min.map((v, i) => (v + b.max[i]) / 2) as [number, number, number]); this.scene.add(m); return m;
    });
  }
  draw(pose: FreePose): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    for (const part of freeParts(pose)) {
      let mesh = this.parts.get(part.id);
      if (!mesh) { mesh = new THREE.Mesh(this.geometry, this.material(part.color)); this.parts.set(part.id, mesh); this.scene.add(mesh); }
      mesh.position.set(...part.p); mesh.scale.setScalar(part.radius);
    }
    // 水平の視点を保ち、パッドの右向き入力が水平回転になるようにする。
    const focus = new THREE.Vector3(pose.pivot[0], 1.25 + Math.max(0, pose.dog.p[1] - 0.5) * 0.7, 0);
    this.camera.position.copy(focus).add(new THREE.Vector3(4.5, 0, 6.75)); this.camera.lookAt(focus);
    this.renderer.render(this.scene, this.camera);
  }
}
