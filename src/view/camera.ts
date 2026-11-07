import * as THREE from 'three';
import { baseHeight, sampleAt, type PathRt } from '../game/track';

/**
 * 視点。犬の少し後ろ・少し上から、道の接線（道の先）を向く。犬や人の回転は引き継がない。
 * 急カーブでも次の着地点が見えるよう、注視点は道に沿って少し先に置く。
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private shake = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  }

  resize(w: number, h: number): void {
    const portrait = h >= w;
    this.camera.aspect = w / Math.max(1, h);
    // 縦持ちは縦の視野を広げ、犬・次の障害物・着地点が同じ画面に入るようにする。
    this.camera.fov = portrait ? 66 : 52;
    this.camera.updateProjectionMatrix();
  }

  kick(amount: number): void {
    this.shake = Math.min(0.5, this.shake + amount);
  }

  reset(): void {
    this.initialized = false;
  }

  update(path: PathRt, s: number, x: number, y: number, dtMs: number, shakeOn: boolean): void {
    const sc = Math.max(0, Math.min(path.length, s));
    const here = sampleAt(path, sc);
    const aheadS = Math.min(path.length, sc + 11);
    const ahead = sampleAt(path, aheadS);
    const fwd = new THREE.Vector3(Math.cos(here.heading), 0, Math.sin(here.heading));
    const right = new THREE.Vector3(-Math.sin(here.heading), 0, Math.cos(here.heading));
    const dogPos = new THREE.Vector3(here.x, 0, here.z).addScaledVector(right, x);
    const ground = baseHeight(path, sc);
    // 高く跳んだときは半分だけ追い、地平線を保つ。
    const camY = ground + 2.7 + Math.max(0, y - ground) * 0.55;
    const desiredPos = dogPos.clone().addScaledVector(fwd, -5.4).addScaledVector(right, -x * 0.25);
    desiredPos.y = camY;
    const aheadRight = new THREE.Vector3(-Math.sin(ahead.heading), 0, Math.cos(ahead.heading));
    const desiredLook = new THREE.Vector3(ahead.x, 0, ahead.z).addScaledVector(aheadRight, x * 0.5);
    desiredLook.y = baseHeight(path, aheadS) + 0.6 + Math.max(0, y - ground) * 0.35;
    if (!this.initialized) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dtMs / 110);
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, 1 - Math.exp(-dtMs / 90));
    this.camera.position.copy(this.pos);
    if (shakeOn && this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.shake *= Math.exp(-dtMs / 120);
    this.camera.lookAt(this.look);
  }
}
