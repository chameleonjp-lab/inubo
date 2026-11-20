import * as THREE from 'three';
import type { DecalShape, FxSink } from './trick-fx-pen';

/**
 * 演出の命令を Three.js で描く受け口。線・光の点・床の印の入れ物は最初に一度だけ作り、毎フレーム中身だけを書き換える。
 * 明るい空や地面の上でも見えるよう、加算ではなく通常の半透明で重ねる（濃さは頂点の不透明度）。
 * 細い線は端末によって1画素になるため、線に沿って小さな光の粒を並べて太く見せる。
 * 深度は読むが書かない（体の後ろの光は体で隠れる）。
 */

const LINE_CAP = 6000;
const DOT_SIZES = [0.07, 0.13, 0.24] as const;
const DOT_CAP = 360;
const BEAD_CAP = 4000;
const BEAD_SIZE = 0.11;
const SHADE_SIZE = 0.17;
const DECAL_CAP = 48;

export type BurstHandler = (n: number, at: THREE.Vector3, color: THREE.Color, speed: number, up: number, life: number,
  dirX: number, dirZ: number, spread: number) => void;

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const g = canvas.getContext('2d');
  // 描けない環境（検査用の簡易な canvas など）でも、ゲームは止めずに無地の印で続ける。
  try {
    if (g) { g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; draw(g, s); }
  } catch { /* 無地のまま */ }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DECAL_DRAW: Record<DecalShape, (g: CanvasRenderingContext2D, s: number) => void> = {
  0: (g, s) => {
    // 肉球：大きな掌球と4つの指球。
    g.beginPath(); g.ellipse(s * 0.5, s * 0.62, s * 0.2, s * 0.16, 0, 0, Math.PI * 2); g.fill();
    for (const [x, y] of [[0.26, 0.38], [0.42, 0.26], [0.58, 0.26], [0.74, 0.38]]) {
      g.beginPath(); g.ellipse(s * x, s * y, s * 0.07, s * 0.09, 0, 0, Math.PI * 2); g.fill();
    }
  },
  1: (g, s) => {
    // 靴底：細長い楕円と、かかとの区切り。
    g.lineWidth = s * 0.08;
    g.beginPath(); g.ellipse(s * 0.5, s * 0.5, s * 0.16, s * 0.38, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(s * 0.36, s * 0.66); g.lineTo(s * 0.64, s * 0.66); g.stroke();
  },
  2: (g, s) => {
    // 手のひら：細長い掌と指の線。
    g.beginPath(); g.ellipse(s * 0.5, s * 0.62, s * 0.14, s * 0.18, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = s * 0.06; g.lineCap = 'round';
    for (const x of [0.38, 0.46, 0.54, 0.62]) { g.beginPath(); g.moveTo(s * x, s * 0.44); g.lineTo(s * x, s * 0.18); g.stroke(); }
  },
  3: (g, s) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.18 : s * 0.44, a = -Math.PI / 2 + i * Math.PI / 5;
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  },
};

/** 使った範囲だけを描画装置へ送る。前も今も空なら何も送らない。 */
function upload(attr: THREE.BufferAttribute, used: number, previous: number): void {
  if (used === 0 && previous === 0) return;
  attr.clearUpdateRanges();
  if (used > 0) attr.addUpdateRange(0, used * attr.itemSize);
  attr.needsUpdate = true;
}

class DotBucket {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  n = 0;
  private sent = 0;
  constructor(size: number, sprite: THREE.Texture, readonly cap = DOT_CAP) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: sprite, vertexColors: true, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  add(x: number, y: number, z: number, r: number, g: number, b: number, a: number): void {
    if (this.n >= this.cap) return;
    const i = this.n * 3, j = this.n * 4;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b; this.col[j + 3] = Math.min(1, a);
    this.n++;
  }
  flush(): void {
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    upload(geo.attributes.position as THREE.BufferAttribute, this.n, this.sent);
    upload(geo.attributes.color as THREE.BufferAttribute, this.n, this.sent);
    this.sent = this.n;
  }
}

export class ThreeFxSink implements FxSink {
  readonly group = new THREE.Group();
  /** このフレームで描いた数（検査と負荷の確認用）。 */
  stats = { lines: 0, dots: 0, decals: 0, bursts: 0 };
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(LINE_CAP * 6);
  private lineCol = new Float32Array(LINE_CAP * 8);
  private lineCount = 0;
  private linesSent = 0;
  private decalsSent = [0, 0, 0, 0];
  private dots: DotBucket[];
  private beads: DotBucket;
  /** 明るい空や地面でも線が見えるよう、光の下に敷く薄い影。 */
  private shade: DotBucket;
  private decals: THREE.InstancedMesh[];
  private decalCount = [0, 0, 0, 0];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private at = new THREE.Vector3();
  private textures: THREE.Texture[] = [];

  constructor(private onBurst: BurstHandler | null = null) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 4));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.group.add(this.lines);
    const sprite = canvasTexture((g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, '#ffffffcc'); grad.addColorStop(1, '#ffffff00');
      g.fillStyle = grad; g.fillRect(0, 0, s, s);
    });
    this.textures.push(sprite);
    this.dots = DOT_SIZES.map(size => new DotBucket(size, sprite));
    this.beads = new DotBucket(BEAD_SIZE, sprite, BEAD_CAP);
    this.shade = new DotBucket(SHADE_SIZE, sprite, BEAD_CAP);
    this.shade.points.renderOrder = 4;
    for (const d of [...this.dots, this.beads, this.shade]) this.group.add(d.points);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.decals = ([0, 1, 2, 3] as const).map(shape => {
      const tex = canvasTexture(DECAL_DRAW[shape]);
      this.textures.push(tex);
      const mesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.85, depthWrite: false,
      }), DECAL_CAP);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_CAP * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      return mesh;
    });
  }

  begin(): void {
    this.lineCount = 0;
    for (const d of this.dots) d.n = 0;
    this.beads.n = 0;
    this.shade.n = 0;
    this.decalCount.fill(0);
    this.stats = { lines: 0, dots: 0, decals: 0, bursts: 0 };
  }

  end(): void {
    const geo = this.lines.geometry;
    geo.setDrawRange(0, this.lineCount * 2);
    upload(geo.attributes.position as THREE.BufferAttribute, this.lineCount * 2, this.linesSent * 2);
    upload(geo.attributes.color as THREE.BufferAttribute, this.lineCount * 2, this.linesSent * 2);
    this.linesSent = this.lineCount;
    for (const d of this.dots) d.flush();
    this.beads.flush();
    this.shade.flush();
    this.decals.forEach((mesh, i) => {
      mesh.count = this.decalCount[i];
      if (this.decalCount[i] || this.decalsSent[i]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      this.decalsSent[i] = this.decalCount[i];
    });
  }

  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, a: number): void {
    if (this.lineCount >= LINE_CAP) return;
    const i = this.lineCount * 6, j = this.lineCount * 8;
    this.lineCount++;
    this.linePos[i] = ax; this.linePos[i + 1] = ay; this.linePos[i + 2] = az;
    this.linePos[i + 3] = bx; this.linePos[i + 4] = by; this.linePos[i + 5] = bz;
    const alpha = Math.min(1, a);
    this.lineCol[j] = this.lineCol[j + 4] = r;
    this.lineCol[j + 1] = this.lineCol[j + 5] = g;
    this.lineCol[j + 2] = this.lineCol[j + 6] = b;
    this.lineCol[j + 3] = this.lineCol[j + 7] = alpha;
    // 線に沿って光の粒を置き、1画素の線でも見えるようにする。
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.min(4, Math.max(1, Math.round(len / 0.05)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      this.shade.add(x, y, z, r * 0.25, g * 0.25, b * 0.3, alpha * 0.35);
      this.beads.add(x, y, z, r, g, b, alpha * 0.95);
    }
    this.stats.lines++;
  }

  dot(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
    const k = size < 0.1 ? 0 : size < 0.18 ? 1 : 2;
    // 段の大きさとの差は濃さで補う（大きすぎる光で顔を隠さない）。
    this.dots[k].add(x, y, z, r, g, b, a * Math.min(1.3, size / DOT_SIZES[k]));
    this.stats.dots++;
  }

  decal(x: number, y: number, z: number, yaw: number, shape: DecalShape, size: number, r: number, g: number, b: number, a: number): void {
    const n = this.decalCount[shape];
    if (n >= DECAL_CAP || a <= 0.02) return;
    const mesh = this.decals[shape];
    this.dummy.position.set(x, y, z);
    // 印の上側（画像の上）を進行方向へ向ける。消えるときは小さくする（1件ごとの不透明度を持てないため）。
    this.dummy.rotation.set(0, -yaw - Math.PI / 2, 0);
    this.dummy.scale.setScalar(size * (0.55 + 0.45 * Math.min(1, a / 0.6)));
    this.dummy.updateMatrix();
    mesh.setMatrixAt(n, this.dummy.matrix);
    mesh.setColorAt(n, this.color.setRGB(r, g, b));
    this.decalCount[shape] = n + 1;
    this.stats.decals++;
  }

  burst(n: number, x: number, y: number, z: number, r: number, g: number, b: number, speed: number, up: number, life: number,
    dirX: number, dirZ: number, spread: number): void {
    this.stats.bursts++;
    this.onBurst?.(Math.min(72, n), this.at.set(x, y, z), this.color.setRGB(r, g, b), speed, up, life, dirX, dirZ, spread);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    for (const d of [...this.dots, this.beads, this.shade]) { d.points.geometry.dispose(); (d.points.material as THREE.Material).dispose(); }
    this.decals[0]?.geometry.dispose();
    for (const m of this.decals) { (m.material as THREE.Material).dispose(); m.dispose(); }
    for (const t of this.textures) t.dispose();
    this.group.removeFromParent();
  }
}
