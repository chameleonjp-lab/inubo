import * as THREE from 'three';
import type { DogLook } from '../content/types';

/**
 * 犬（＝スケートボード）と、背に乗る1人の乗り手。見た目だけの形で、当たり判定には使わない。
 * 座標は X=前、Y=上、Z=右（計算側の姿勢と同じ向き）。足元の中心が原点。
 */

export interface Rig {
  root: THREE.Group;
  /** 体ごとの回転（人と犬が一緒に回る）。 */
  board: THREE.Group;
  /** 犬だけの回転。人の胸と視線は前に保つ。 */
  dog: THREE.Group;
  rider: THREE.Group;
  legs: THREE.Group[];
  tail: THREE.Object3D;
  ears: THREE.Object3D[];
  riderTorso: THREE.Object3D;
  riderArms: THREE.Group[];
  riderLegs: THREE.Group[];
  /** 人の肩（体ごとの回転の軌跡を出す位置）。 */
  shoulder: THREE.Object3D;
  /** 犬の鼻先と足先（犬だけの回転の軌跡）。 */
  nose: THREE.Object3D;
  paw: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  look: DogLook;
}

function mat(color: string, list: THREE.MeshStandardMaterial[]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
  list.push(m);
  return m;
}

/** 回転の中心（体ごとの回転は、乗り手を含めた重心のあたりを中心にする）。 */
export const BOARD_PIVOT_Y = 0.75;
export const DOG_PIVOT_Y = 0.35;

export function createRig(look: DogLook, clothes: string, helmet: string, ghost = false): Rig {
  const materials: THREE.MeshStandardMaterial[] = [];
  const root = new THREE.Group();
  const board = new THREE.Group();
  board.position.y = BOARD_PIVOT_Y;
  root.add(board);
  // 見た目の縮尺（当たり判定には使わない）: 犬を少し大きく、乗り手を少し小さく描く。
  const DOG_SCALE = 1.35;
  const RIDER_SCALE = 0.72;
  const dog = new THREE.Group();
  // 縮尺を掛けても足先が地面（足元の中心）に来る高さに置く。
  dog.position.y = DOG_PIVOT_Y * DOG_SCALE - BOARD_PIVOT_Y;
  dog.scale.setScalar(DOG_SCALE);
  board.add(dog);

  const fur = mat(look.body, materials);
  const belly = mat(look.belly, materials);
  const dark = mat('#2b2420', materials);
  const legLen = look.legLength;
  const bodyY = legLen + look.bodyHeight / 2 - DOG_PIVOT_Y;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(look.bodyHeight / 2, look.bodyLength - look.bodyHeight, 6, 12), fur);
  body.rotation.z = Math.PI / 2;
  body.position.y = bodyY;
  dog.add(body);
  const under = new THREE.Mesh(new THREE.CapsuleGeometry(look.bodyHeight / 2.4, look.bodyLength * 0.6, 4, 8), belly);
  under.rotation.z = Math.PI / 2;
  under.position.set(0.02, bodyY - look.bodyHeight * 0.18, 0);
  under.scale.set(1, 1, 0.9);
  dog.add(under);

  const head = new THREE.Group();
  head.position.set(look.bodyLength / 2 + 0.08, bodyY + look.bodyHeight * 0.45, 0);
  dog.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), fur);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.12), belly);
  snout.position.set(0.16, -0.04, 0);
  head.add(snout);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), dark);
  noseTip.position.set(0.25, -0.02, 0);
  head.add(noseTip);
  for (const z of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark);
    eye.position.set(0.12, 0.05, z);
    head.add(eye);
  }
  const ears: THREE.Object3D[] = [];
  for (const z of [-0.09, 0.09]) {
    let ear: THREE.Mesh;
    if (look.ear === 'pointy') {
      ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 4), fur);
      ear.position.set(0, 0.17, z);
    } else if (look.ear === 'big') {
      ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 4), fur);
      ear.position.set(-0.01, 0.19, z * 1.2);
      ear.rotation.x = z > 0 ? 0.35 : -0.35;
    } else {
      ear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.1), fur);
      ear.position.set(-0.05, 0.1, z * 1.3);
      ear.rotation.x = z > 0 ? 0.7 : -0.7;
    }
    head.add(ear);
    ears.push(ear);
  }

  let tail: THREE.Mesh;
  if (look.tail === 'curl') {
    tail = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.035, 6, 12, Math.PI * 1.5), fur);
    tail.position.set(-look.bodyLength / 2, bodyY + look.bodyHeight * 0.55, 0);
    tail.rotation.y = Math.PI / 2;
  } else if (look.tail === 'stub') {
    tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), fur);
    tail.position.set(-look.bodyLength / 2 - 0.02, bodyY + 0.05, 0);
  } else {
    tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.4, 6), fur);
    tail.position.set(-look.bodyLength / 2 - 0.12, bodyY + 0.02, 0);
    tail.rotation.z = Math.PI / 2.6;
  }
  dog.add(tail);

  const legs: THREE.Group[] = [];
  const pawObj = new THREE.Object3D();
  for (const [lx, lz] of [
    [look.bodyLength * 0.36, -0.12],
    [look.bodyLength * 0.36, 0.12],
    [-look.bodyLength * 0.36, -0.12],
    [-look.bodyLength * 0.36, 0.12],
  ]) {
    const hip = new THREE.Group();
    hip.position.set(lx, legLen - DOG_PIVOT_Y + 0.02, lz);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, legLen, 6), fur);
    leg.position.y = -legLen / 2;
    hip.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), belly);
    foot.position.y = -legLen;
    hip.add(foot);
    dog.add(hip);
    legs.push(hip);
  }
  pawObj.position.set(0, -DOG_PIVOT_Y, 0);
  dog.add(pawObj);
  const noseObj = new THREE.Object3D();
  noseObj.position.copy(head.position).add(new THREE.Vector3(0.25, -0.02, 0));
  dog.add(noseObj);

  // 乗り手（1人）。服とヘルメットの色だけを選べる。
  const rider = new THREE.Group();
  // 乗り手の足は犬の背中の上（体ごとの回転の中心からの高さ）。
  rider.position.y = (legLen + look.bodyHeight) * DOG_SCALE - BOARD_PIVOT_Y;
  rider.scale.setScalar(RIDER_SCALE);
  board.add(rider);
  const cloth = mat(clothes, materials);
  const pants = mat('#3a4a6b', materials);
  const skin = mat('#f2c9a0', materials);
  const helm = mat(helmet, materials);
  const riderLegs: THREE.Group[] = [];
  for (const z of [-0.12, 0.12]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.62, z);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.6, 8), pants);
    thigh.position.y = -0.3;
    hip.add(thigh);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.1), dark);
    shoe.position.set(0.04, -0.6, 0);
    hip.add(shoe);
    rider.add(hip);
    riderLegs.push(hip);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.36), cloth);
  torso.position.y = 0.88;
  rider.add(torso);
  const riderArms: THREE.Group[] = [];
  for (const z of [-0.23, 0.23]) {
    const sh = new THREE.Group();
    sh.position.set(0, 1.08, z);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.5, 6), cloth);
    arm.position.y = -0.25;
    sh.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
    hand.position.y = -0.52;
    sh.add(hand);
    sh.rotation.x = z > 0 ? -0.5 : 0.5;
    rider.add(sh);
    riderArms.push(sh);
  }
  const headR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
  headR.position.y = 1.28;
  rider.add(headR);
  const helmet3 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helm);
  helmet3.position.y = 1.31;
  rider.add(helmet3);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.22), helm);
  visor.position.set(0.15, 1.31, 0);
  rider.add(visor);
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0, 1.08, 0.23);
  rider.add(shoulder);

  if (ghost) {
    for (const m of materials) {
      m.transparent = true;
      m.opacity = 0.32;
      m.depthWrite = false;
    }
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
  });
  return { root, board, dog, rider, legs, tail, ears, riderTorso: torso, riderArms, riderLegs, shoulder, nose: noseObj, paw: pawObj, materials, look };
}

export interface RigPose {
  mode: 'ground' | 'air' | 'rail' | 'falling';
  speed: number;
  maxSpeed: number;
  grade: number;
  lean: number;
  /** 足が下を向いて着地に備えるか（R38）。 */
  feetDown: boolean;
  blocked: boolean;
  timeMs: number;
  wag: boolean;
}

/** 走り方に合わせて脚と体を動かす（平地・上りは地面を蹴り、下りは足をたたんで滑る）。 */
export function animateRig(rig: Rig, p: RigPose, phase: number): void {
  const downhill = p.grade < -0.03;
  const uphill = p.grade > 0.03;
  rig.legs.forEach((leg, i) => {
    let a = 0;
    if (p.mode === 'ground' && !downhill && p.speed > 0.3 && !p.blocked) {
      a = Math.sin(phase + (i % 2 === 0 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI / 2)) * 0.7;
    } else if (p.mode === 'ground' && downhill) {
      a = i < 2 ? -1.1 : 1.1; // 足をたたんで滑る
    } else if (p.mode === 'air') {
      a = p.feetDown ? (i < 2 ? -0.5 : 0.5) : i < 2 ? -0.9 : 0.9; // 足が下を向くと四肢を広げる
    } else if (p.mode === 'rail') {
      a = i < 2 ? -0.6 : 0.6;
    } else if (p.blocked) {
      a = i < 2 ? -0.3 : 0.3; // 踏ん張る
    }
    leg.rotation.z = a;
    leg.rotation.x = p.mode === 'air' && p.feetDown ? (i % 2 === 0 ? -0.25 : 0.25) : 0;
  });
  rig.tail.rotation.x = p.wag ? Math.sin(p.timeMs / 70) * 0.6 : Math.sin(p.timeMs / 400) * 0.1;
  const flutter = Math.min(1, p.speed / Math.max(1, p.maxSpeed));
  rig.ears.forEach((e, i) => {
    e.rotation.z = -flutter * 0.5 + Math.sin(p.timeMs / 50 + i) * 0.08 * flutter;
  });
  // 乗り手: 上りは前かがみ、カーブは内側へ傾く、着地前は膝をゆるめる。
  rig.rider.rotation.z = uphill ? -0.25 : downhill ? 0.05 : -0.08 * flutter;
  rig.rider.rotation.x = -p.lean * 0.35;
  const knee = p.mode === 'air' && p.feetDown ? 0.35 : p.blocked ? 0.25 : 0.1;
  rig.riderLegs.forEach((l, i) => (l.rotation.z = (i === 0 ? 1 : 1) * knee));
  rig.riderArms.forEach((a, i) => (a.rotation.x = (i === 0 ? 1 : -1) * (0.5 + (p.mode === 'air' ? 0.6 : 0) + (p.blocked ? 0.4 : 0))));
}
