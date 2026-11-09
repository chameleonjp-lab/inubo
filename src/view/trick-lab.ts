import * as THREE from 'three';
import type { DogLook } from '../content/types';
import { createRig, type Rig } from './models';
import {
  GAP,
  KICKER,
  LAB_FIXTURES,
  RAMP_RADIUS,
  RAMP_TOP_ANGLE,
  RAMP_TOP_HEIGHT,
  SLOPE_GRADE,
  STAIRS,
  rampPoint,
  type LabEdge,
  type LabFixtureId,
} from '../game/trick-lab-terrain';
import type { Handle, LabPose } from '../game/trick-lab';

/**
 * 技の練習の立体。競技の道とは別の場面を作り、描画装置（renderer）は競技と共有する。
 * 座標は計算と同じ: X = 地形の前方 s、Y = 上、Z = 右 x。
 */

const HANDLE_POS: Record<Handle, [number, number]> = {
  nose: [0.42, 0],
  tail: [-0.42, 0],
  toe: [0, 1],
  heel: [0, -1],
};

export class TrickLabStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private terrain = new THREE.Group();
  private rig: Rig | null = null;
  private handles = new Map<Handle, THREE.Mesh>();
  private plantMark: THREE.Mesh;
  private shadow: THREE.Mesh;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private fixture: LabFixtureId = 'flat';

  constructor() {
    this.scene.background = new THREE.Color('#bfe3f5');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7d8f6a', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(10, 20, 8);
    this.scene.add(sun);
    this.scene.add(this.terrain);
    this.plantMark = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.14, 20), new THREE.MeshBasicMaterial({ color: '#ff7a1a', side: THREE.DoubleSide }));
    this.plantMark.rotation.x = -Math.PI / 2;
    this.plantMark.visible = false;
    this.scene.add(this.plantMark);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
  }

  setRider(look: DogLook, clothes: string, helmet: string): void {
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = createRig(look, clothes, helmet);
    this.handles.clear();
    // 犬の背の練習用ベルトと持ち手、前後の練習用パッド。
    const top = look.legLength + look.bodyHeight - 0.35 + 0.02;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(look.bodyLength * 0.95, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: '#3a3f4b' }));
    belt.position.y = top;
    this.rig.dog.add(belt);
    for (const h of ['nose', 'tail', 'toe', 'heel'] as const) {
      const [fx, side] = HANDLE_POS[h];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#000000' }));
      m.position.set(fx * look.bodyLength, top + 0.03, side * 0.17);
      this.rig.dog.add(m);
      this.handles.set(h, m);
    }
    for (const fx of [0.35, -0.35]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), new THREE.MeshStandardMaterial({ color: '#2b5fa8' }));
      pad.position.set(fx * look.bodyLength / 0.8, look.legLength * 0.55 - 0.35, 0);
      this.rig.dog.add(pad);
    }
    this.scene.add(this.rig.root);
  }

  setFixture(id: LabFixtureId, edge: LabEdge | null): void {
    this.fixture = id;
    this.terrain.clear();
    this.camReady = false;
    const ground = new THREE.MeshStandardMaterial({ color: '#c9b98f', roughness: 0.95 });
    const concrete = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: '#7d8590', metalness: 0.6, roughness: 0.35 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      this.terrain.add(b);
      return b;
    };
    const len = LAB_FIXTURES[id].length;
    switch (id) {
      case 'slope': {
        box(4, 0.1, 8, 0, -0.05, 0, ground);
        const run = len;
        const drop = -SLOPE_GRADE * run;
        const plane = box(Math.hypot(run, drop), 0.1, 8, 2 + run / 2, -drop / 2 - 0.05, 0, ground);
        plane.rotation.z = Math.atan(SLOPE_GRADE);
        break;
      }
      case 'stairs': {
        box(STAIRS.s0 + 2, STAIRS.topHeight, 8, (STAIRS.s0 - 2) / 2, STAIRS.topHeight / 2, 0, concrete);
        for (let i = 1; i < STAIRS.steps; i++) {
          const h = STAIRS.topHeight - STAIRS.rise * i;
          box(STAIRS.tread, h, 8, STAIRS.s0 + STAIRS.tread * (i - 0.5), h / 2, 0, concrete);
        }
        box(len, 0.1, 8, len / 2 + STAIRS.s0, -0.05, 0, ground);
        break;
      }
      case 'gap': {
        box(GAP.s0 + 2, 0.1, 8, (GAP.s0 - 2) / 2, -0.05, 0, concrete);
        const rest = len - GAP.s0 - GAP.width + 2;
        box(rest, 0.1, 8, GAP.s0 + GAP.width + rest / 2, -0.05, 0, concrete);
        box(GAP.width, 0.1, 8, GAP.s0 + GAP.width / 2, -1.0, 0, new THREE.MeshStandardMaterial({ color: '#4a3b2a' }));
        break;
      }
      case 'kicker': {
        box(len + 4, 0.1, 8, len / 2, -0.05, 0, ground);
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(KICKER.length, 0);
        shape.lineTo(KICKER.length, KICKER.top);
        shape.lineTo(0, 0);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false });
        const k = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f08a24' }));
        k.position.set(KICKER.s0, 0, -1.2);
        this.terrain.add(k);
        break;
      }
      case 'ramp': {
        box(8, 0.1, 8, -3, -0.05, 0, concrete);
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        const n = 24;
        for (let i = 0; i <= n; i++) {
          const a = (RAMP_TOP_ANGLE * i) / n;
          shape.lineTo(RAMP_RADIUS * Math.sin(a), RAMP_RADIUS * (1 - Math.cos(a)));
        }
        const top = rampPoint(RAMP_RADIUS * RAMP_TOP_ANGLE);
        shape.lineTo(top.s + 2.5, RAMP_TOP_HEIGHT);
        shape.lineTo(top.s + 2.5, 0);
        shape.lineTo(0, 0);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false });
        const r = new THREE.Mesh(geo, concrete);
        r.position.z = -2;
        this.terrain.add(r);
        const coping = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 10), metal);
        coping.rotation.x = Math.PI / 2;
        coping.position.set(top.s, top.y, 0);
        this.terrain.add(coping);
        break;
      }
      default:
        box(len + 6, 0.1, 8, len / 2, -0.05, 0, ground);
    }
    if (edge) {
      const l = edge.s1 - edge.s0;
      if (edge.kind === 'rail') {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(edge.halfWidth, edge.halfWidth, l, 12), metal);
        bar.rotation.z = Math.PI / 2;
        bar.position.set((edge.s0 + edge.s1) / 2, edge.top - edge.halfWidth, edge.x);
        this.terrain.add(bar);
        for (const s of [edge.s0 + 0.2, edge.s1 - 0.2]) box(0.05, edge.top - 0.1, 0.05, s, (edge.top - 0.1) / 2, edge.x, metal);
      } else {
        box(l, edge.top, 0.5, (edge.s0 + edge.s1) / 2, edge.top / 2, edge.x + Math.sign(edge.x) * (0.25 - edge.halfWidth), concrete);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(l, 0.03, edge.halfWidth * 2), metal);
        lip.position.set((edge.s0 + edge.s1) / 2, edge.top, edge.x);
        this.terrain.add(lip);
      }
    }
    // 入口の目印
    const start = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    start.rotation.x = -Math.PI / 2;
    start.position.set(0, (id === 'stairs' ? STAIRS.topHeight : 0) + 0.01, 0);
    if (id !== 'ramp') this.terrain.add(start);
  }

  /** 計算の姿勢をそのまま描く（判定と描画が同じ座標を使う）。 */
  frame(renderer: THREE.WebGLRenderer, pose: LabPose, highlight: Handle | null, dtMs: number, reducedMotion: boolean, band: { left: number; top: number; right: number; bottom: number }): void {
    const rig = this.rig;
    if (!rig) return;
    const [s, x, y] = pose.pos;
    const deg = Math.PI / 180;
    rig.root.position.set(s, y, x);
    rig.root.rotation.set(0, 0, pose.pitch);
    rig.board.quaternion.identity();
    rig.dog.rotation.set(pose.flip * deg, pose.toe * pose.dogYaw * deg, 0, 'YXZ');
    // 人は横向き（つま先側を向く）に立ち、そこから水平に回る。
    rig.rider.rotation.set(0, pose.toe * pose.riderYaw * deg - pose.toe * Math.PI / 2, 0);
    const front = pose.toe > 0 ? 0 : 1;
    const back = 1 - front;
    rig.riderArms.forEach((a, i) => {
      a.rotation.set(i === 0 ? 0.6 : -0.6, 0, 0);
    });
    if (pose.hand !== 'idle') {
      const arm = rig.riderArms[pose.grabHand === 'front' ? front : back];
      arm.rotation.set(0, 0, pose.hand === 'holding' ? 0.15 : 0.5);
    }
    const knee = 0.15 + pose.crouch * 0.5;
    rig.riderLegs.forEach((l, i) => {
      l.rotation.set(0, 0, i === front && pose.frontFootOff ? (pose.frontFootPlanted ? 1.0 : 0.7) : knee);
    });
    for (const [h, m] of this.handles) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.set(h === highlight ? '#ff8a00' : pose.hand === 'holding' && h === pose.grabHandle ? '#2266ff' : '#000000');
    }
    this.plantMark.visible = pose.frontFootPlanted;
    if (pose.frontFootPlanted) this.plantMark.position.set(s + 0.3, y + 0.02, x);
    const ground = this.fixture === 'ramp' ? (s > rampPoint(RAMP_RADIUS * RAMP_TOP_ANGLE).s ? RAMP_TOP_HEIGHT : y) : Math.min(y, this.groundAt(s));
    this.shadow.position.set(s, ground + 0.02, x);
    this.shadow.visible = pose.mode === 'air';

    // カメラ: 人と地形の接触点を横から見る。競技の11 m先を追う処理とは分ける。
    // パネルに隠れていない帯の中央に映るよう、見る範囲をずらし、帯が狭いほど引いて写す。
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const hgt = Math.max(1, size.y);
    const bandH = Math.max(60, band.bottom - band.top);
    const bandW = Math.max(60, band.right - band.left);
    const fov = 40;
    const need = 3.2; // 帯に収めたい高さ（m）
    const dist = Math.min(40, Math.max(5, (need * (hgt / bandH)) / (2 * Math.tan((fov / 2) * Math.PI / 180)), (need * 1.4 * (w / bandW)) / (2 * Math.tan((fov / 2) * Math.PI / 180)) / (w / hgt)));
    const ramp = this.fixture === 'ramp';
    const focusS = ramp ? 1.6 : s + 0.8;
    const focusY = ramp ? 1.0 : Math.max(y, 0) + 0.6;
    const focusX = ramp ? 0 : x * 0.5;
    const dir = new THREE.Vector3(-0.35, 0.32, 1).normalize();
    const wantLook = new THREE.Vector3(focusS, focusY, focusX);
    const wantPos = wantLook.clone().addScaledVector(dir, dist);
    const k = !this.camReady || reducedMotion ? 1 : 1 - Math.exp(-dtMs / 120);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    if (!this.camReady) {
      this.camPos.copy(wantPos);
      this.camLook.copy(wantLook);
      this.camReady = true;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.aspect = w / hgt;
    this.camera.fov = fov;
    const cx = (band.left + band.right) / 2;
    const cy = (band.top + band.bottom) / 2;
    this.camera.setViewOffset(w, hgt, w / 2 - cx, hgt / 2 - cy, w, hgt);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  private groundAt(s: number): number {
    if (this.fixture === 'stairs') return s < STAIRS.s0 ? STAIRS.topHeight : 0;
    if (this.fixture === 'slope') return s > 2 ? SLOPE_GRADE * (s - 2) : 0;
    return 0;
  }

  dispose(): void {
    this.terrain.clear();
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = null;
  }
}
