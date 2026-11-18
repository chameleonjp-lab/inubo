import * as THREE from 'three';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { getCourse } from '../src/content/courses';
import { DOGS } from '../src/content/dogs';
import { baseHeight, sampleAt, sAtU, solidTop, supportGrade, worldXZ, type PathRt } from '../src/game/track';
import { DEFAULT_SETTINGS } from '../src/storage/records';
import { GameView } from '../src/view/scene';
import { TrickLabStage } from '../src/view/trick-lab';
import { newRun } from './helpers';

// 描画装置と文字の画像作成だけを置き換え、ゲームが組み立てる立体・座標・カメラを使う。
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class { setPixelRatio() {} render() {} dispose() {} },
}));
const park = getCourse('park');
let view: GameView;
const labels = new Map<unknown, string>();
beforeAll(() => {
  const ctx = { fillRect() {}, fillText() {}, beginPath() {}, ellipse() {}, fill() {} };
  vi.stubGlobal('document', { createElement: () => {
    const canvas = { getContext: () => ({ ...ctx, fillText: (value: string) => labels.set(canvas, value) }) };
    return canvas;
  } });
  view = new GameView(document.createElement('canvas'));
  view.setCourse(park);
  view.setRider(DOGS.shiba.look, '#112233', '#334455');
  view.scene.updateMatrixWorld(true);
});
afterAll(() => { view.dispose(); vi.unstubAllGlobals(); });

function meshes(...colors: string[]): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  view.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && colors.includes(object.material.color?.getHexString())) found.push(object);
  });
  return found;
}
function surfaceAt(path: PathRt, s: number, x: number, objects: THREE.Object3D[]) {
  const [wx, wz] = worldXZ(path, s, x);
  return new THREE.Raycaster(new THREE.Vector3(wx, 20, wz), new THREE.Vector3(0, -1, 0))
    .intersectObjects(objects, false)[0];
}

test('全105基で台の上面・踏切高・走行中の傾きが路面に沿う', () => {
  const ramps = meshes('f08a24');
  let count = 0;
  for (const path of park.paths.values()) for (const so of path.solids.filter((s) => s.kind === 'kicker')) {
    count++;
    const length = so.s1 - so.s0;
    const x = (so.x0 + so.x1) / 2;
    expect(solidTop(path, so, so.s1, 0) - baseHeight(path, so.s1), so.id).toBeCloseTo(so.height, 6);
    for (const fraction of [0.13, 0.41, 0.73, 0.97]) {
      const s = so.s0 + length * fraction;
      const top = solidTop(path, so, s, 0);
      expect(surfaceAt(path, s, x, ramps)?.point.y, so.id).toBeCloseTo(top, 3);
      const next = solidTop(path, so, s + 0.001, 0);
      expect(supportGrade(path, s, x, top, 0), so.id).toBeCloseTo((next - top) / 0.001, 4);
    }
  }
  expect(count).toBe(105);
});

test('全階段で進入側・中央・出口側から踏み面が見え、路面と同じ高さで着地する', () => {
  const roads = meshes('d9cdb4');
  const stairs = meshes('cfc6b3', 'bdb3a0');
  for (const path of park.paths.values()) for (const stair of path.stairs) {
    const depth = (stair.s1 - stair.s0) / stair.steps;
    for (let i = 0; i < stair.steps; i++) for (const fraction of [0.05, 0.5, 0.95]) {
      const s = stair.s0 + (i + fraction) * depth;
      for (const x of [-0.65, 0, 0.65]) {
        const hit = surfaceAt(path, s, x, [...roads, ...stairs]);
        expect(stairs.includes(hit?.object as THREE.Mesh), stair.id).toBe(true);
        expect(hit.point.y, stair.id).toBeCloseTo(baseHeight(path, s), 4);
      }
    }
  }
});

test('坂の柵と壁は前端から後端まで越える高さと見える高さが一致する', () => {
  const obstacles = meshes('f4f1ea', '6d9c4f', '9aa5b1');
  for (const path of park.paths.values()) for (const so of path.solids.filter((s) => s.kind === 'fence' || s.kind === 'wall')) {
    for (const f of [0.05, 0.35, 0.95]) {
      const s = so.s0 + f * (so.s1 - so.s0);
      const hit = surfaceAt(path, s, (so.x0 + so.x1) / 2, obstacles);
      expect(hit?.point.y, so.id).toBeCloseTo(solidTop(path, so, s, 0), 3);
    }
  }
});

test('3基のゲートは予告・下降中を含めて両端と中央が判定の高さで見える', () => {
  const bones = meshes('f5f0e1');
  const run = newRun(park);
  for (const path of park.paths.values()) for (const so of path.solids.filter((s) => s.kind === 'gate')) {
    const s = (so.s0 + so.s1) / 2;
    const [cx, cz] = worldXZ(path, s, (so.x0 + so.x1) / 2);
    const bar = bones.find((mesh) => {
      const pos = mesh.getWorldPosition(new THREE.Vector3());
      return Math.hypot(pos.x - cx, pos.z - cz) < 0.05;
    })!.parent!;
    for (const [phaseUs, height] of [[0, 0], [1_050_000, 0.45], [1_500_000, 0.9], [2_950_000, 0.45], [3_500_000, 0]]) {
      run.simUs = (phaseUs - so.gate!.offsetUs + so.gate!.periodUs) % so.gate!.periodUs;
      view.frame(run, run.simUs, [], DEFAULT_SETTINGS, run.simUs / 1000, 0);
      view.scene.updateMatrixWorld(true);
      expect(bar.visible, so.id).toBe(height > 0);
      if (height === 0) continue;
      const expected = baseHeight(path, so.s0) + height;
      expect(new THREE.Box3().setFromObject(bar, true).max.y, so.id).toBeCloseTo(expected, 4);
      for (const x of [so.x0 + 0.02, (so.x0 + so.x1) / 2, so.x1 - 0.02]) {
        expect(surfaceAt(path, s, x, bar.children)?.point.y, so.id).toBeCloseTo(expected, 3);
      }
    }
  }
});

test('16枚のカーブ矢印と高い壁の案内を進入側から正しい左右で読める', () => {
  const signs: THREE.Mesh[] = [];
  view.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && ['›››', '‹‹‹', '◢ 踏切台'].includes(labels.get(o.material.map?.image) ?? '')) signs.push(o);
  });
  const expected = [...park.paths.values()].flatMap((path) => [
    ...path.arrows.map((a) => ({ path, s: a.s, text: a.dir === 'right' ? '›››' : '‹‹‹' })),
    ...path.solids.filter((so) => so.kind === 'wall' && so.height >= 1.2)
      .map((so) => ({ path, s: so.s0 - 0.02, text: '◢ 踏切台' })),
  ]);
  expect(signs).toHaveLength(expected.length);
  for (const { path, s, text } of expected) {
    const { x, z, heading } = sampleAt(path, s);
    const sign = signs.find((m) => {
      const pos = m.getWorldPosition(new THREE.Vector3());
      return labels.get((m.material as THREE.MeshBasicMaterial).map!.image) === text && Math.hypot(pos.x - x, pos.z - z) < 8;
    })!;
    const towardRider = new THREE.Vector3(-Math.cos(heading), 0, -Math.sin(heading));
    const roadRight = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading));
    expect(sign.getWorldDirection(new THREE.Vector3()).dot(towardRider), text).toBeGreaterThan(0.99);
    expect(new THREE.Vector3(1, 0, 0).transformDirection(sign.matrixWorld).dot(roadRight), text).toBeGreaterThan(0.99);
  }
});

function assets(root: THREE.Object3D) {
  const found = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh>();
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) found.add(o);
    if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
      found.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        found.add(mat);
        if (mat.map) found.add(mat.map);
      }
    }
  });
  return found;
}

function watchResources(root: THREE.Object3D) {
  const counts = new Map([...assets(root)].map((resource) => [resource, 0]));
  for (const resource of counts.keys()) {
    const emitter: THREE.EventDispatcher<{ dispose: object }> = resource;
    emitter.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
  }
  return (remaining?: THREE.Object3D) => {
    const live = remaining ? assets(remaining) : new Set();
    for (const [res, n] of counts) expect(n, res.constructor.name).toBe(live.has(res) ? 0 : 1);
  };
}

test('公園を再挑戦してから広場へ移ると、使い終えた立体・材質・画像を一度ずつ解放する', () => {
  const game = new GameView(document.createElement('canvas'));
  game.setCourse(park);
  game.setRider(DOGS.shiba.look, '#224466', '#334455');
  game.setGhost({ runId: 'replay', courseId: 'park', courseVersion: park.def.version, rulesVersion: 'rules-1',
    dogId: 'shiba', stepMs: 10, frames: [] }, DOGS.shiba.look);
  const courseAssets = watchResources(game.scene);
  game.setCourse(park);
  game.resetEffects();
  game.setCourse(getCourse('practice'));
  game.setRider(DOGS.corgi.look, '#335577', '#001122');
  game.setGhost(null, null);
  courseAssets(game.scene);
  const last = watchResources(game.scene);
  game.dispose();
  last();
});

test('技の練習で台や犬を切り替え、練習を閉じると使い終えた描画資源を解放する', () => {
  const lab = new TrickLabStage();
  lab.setRider(DOGS.shiba.look, '#224466', '#334455');
  lab.setFixture('stairs', null);
  const previous = watchResources(lab.scene);
  lab.setRider(DOGS.whippet.look, '#224466', '#334455');
  lab.setFixture('flat', null);
  previous(lab.scene);
  const final = watchResources(lab.scene);
  lab.dispose();
  final();
});

test.each([[402, 700], [700, 402]])('画面 %i×%i で階段、袋、着地点とゲートの空き側が進入時に見える', (width, height) => {
  const targets: [string, string, number, number, number, number, number][] = [
    // 名称・道・犬のu・犬の横位置・見るu・見る横位置・路面からの高さ。
    ['階段の踏み面', 'f1-stairs', 247, 0, 254.3, 0, 0],
    ['空中の袋', 'extension', 986, 2.4, 994, 2.4, 3.8],
    ['袋の先の着地点', 'extension', 991, 2.4, 1004, 2.4, 0],
    ['左ゲートの右の道', 'extension', 938, 0, 948, 1, 0],
    ['右ゲートの左の道', 'extension', 1343, 0, 1353, -1, 0],
  ];
  view.cam.resize(width, height);
  for (const [label, pathId, fromU, dogX, toU, x, h] of targets) {
    const path = park.paths.get(pathId)!;
    const from = sAtU(path, fromU), to = sAtU(path, toU);
    view.cam.reset();
    view.cam.update(path, from, dogX, baseHeight(path, from), 16, false);
    const camera = view.cam.camera;
    camera.updateMatrixWorld(true);
    const [wx, wz] = worldXZ(path, to, x);
    const target = new THREE.Vector3(wx, baseHeight(path, to) + h, wz);
    const screen = target.clone().project(camera);
    expect(Math.abs(screen.x), label).toBeLessThan(0.95);
    expect(Math.abs(screen.y), label).toBeLessThan(0.95);
    expect(screen.z, label).toBeGreaterThan(-1);
    expect(screen.z, label).toBeLessThan(1);
    const ray = new THREE.Raycaster(camera.position, target.clone().sub(camera.position).normalize());
    const hits = ray.intersectObjects(meshes('d9cdb4', 'cfc6b3', 'bdb3a0', 'f08a24', '9aa5b1', '6d9c4f', 'f4f1ea'), false);
    expect(hits[0]?.distance ?? Infinity, label).toBeGreaterThanOrEqual(camera.position.distanceTo(target) - 0.01);
  }
});

test('同じ公園の再挑戦では、前の走行で上がった旗がスタート時に降りる', () => {
  const checkpoint = park.paths.get('start')!.checkpoints[0];
  const run = newRun(park);
  const frame = (t: number) => view.frame(run, run.simUs, [], DEFAULT_SETTINGS, t, 0);
  view.frame(run, run.simUs, [{ effect: 'E17', visual: 'flagUp', sound: null, objId: checkpoint.id, atUs: 0, runId: run.id.runId }], DEFAULT_SETTINGS, 100, 0);
  frame(900);
  const flags = meshes('f2c94c').map((m) => m.parent!);
  const raised = flags.find((flag) => flag.userData.raiseAt === 100)!;
  expect(raised.position.y).toBeCloseTo(1.85);
  view.setCourse(park);
  view.resetEffects();
  frame(1000);
  expect(raised.position.y).toBeCloseTo(0.2);
});
