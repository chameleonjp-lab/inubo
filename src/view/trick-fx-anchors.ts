import * as THREE from 'three';
import type { FreePart } from '../game/free-geometry';
import type { FreePose } from '../game/free-motion';
import type { FxBody } from './trick-fx-context';
import type { FxBodySource } from './trick-fx-engine';
import type { BodyAnchorKey } from './trick-fx-81';
import type { Quat, Vec } from './trick-fx-math';
import type { Rig } from './models';

/**
 * 同じ計測点の名前を、2種類の身体の模型から読む。
 * - 競技：立体模型（models.ts の Rig）の見えない計測点。呼ぶ前に root.updateMatrixWorld(true) を1回済ませておく。
 * - 操作確認版：球の模型（free-geometry.ts の freeParts）。球の位置や半径は変えずに読むだけ。
 */

export class RigFxSource implements FxBodySource {
  rig: Rig | null = null;
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();

  anchor(key: BodyAnchorKey, out: Vec): boolean {
    const o = this.rig?.anchors[key];
    if (!o || !this.rig!.root.visible) return false;
    o.getWorldPosition(this.v);
    out.x = this.v.x; out.y = this.v.y; out.z = this.v.z;
    return true;
  }

  quat(body: FxBody, out: Quat): boolean {
    if (!this.rig || !this.rig.root.visible) return false;
    (body === 'dog' ? this.rig.dog : this.rig.rider).getWorldQuaternion(this.q);
    out.x = this.q.x; out.y = this.q.y; out.z = this.q.z; out.w = this.q.w;
    return true;
  }
}

/** 球の模型の部品名と、計測点の名前の対応。犬の足 paw-0..3 は 後左・後右・前左・前右 の順。 */
const FREE_PART_OF: Partial<Record<BodyAnchorKey, string>> = {
  dogNose: 'dog-nose', dogEarL: 'dog-ear-a', dogEarR: 'dog-ear-b', dogTail: 'dog-tail',
  dogPawFL: 'paw-2', dogPawFR: 'paw-3', dogPawBL: 'paw-0', dogPawBR: 'paw-1',
  riderHead: 'head', riderShoulderL: 'arm-0-0', riderShoulderR: 'arm-1-0', riderHandL: 'arm-0-2', riderHandR: 'arm-1-2',
  riderWaist: 'hip', riderShoeL: 'shoe-0', riderShoeR: 'shoe-1',
};

export class FreePartsFxSource implements FxBodySource {
  private parts = new Map<string, FreePart>();
  private pose: FreePose | null = null;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  update(pose: FreePose, parts: readonly FreePart[]): void {
    this.pose = pose;
    this.parts.clear();
    for (const part of parts) this.parts.set(part.id, part);
  }

  anchor(key: BodyAnchorKey, out: Vec): boolean {
    const pose = this.pose;
    if (!pose) return false;
    if (key === 'pivot') { out.x = pose.pivot[0]; out.y = pose.pivot[1]; out.z = pose.pivot[2]; return true; }
    if (key === 'dogBack' || key === 'dogBelly' || key === 'riderHelmet') {
      // 球の模型に無い点は、同じ身体の姿勢から求める（背中・腹は胴の上下、ヘルメットは頭の上）。
      const body = key === 'riderHelmet' ? pose.rider : pose.dog;
      const local: [number, number, number] = key === 'dogBack' ? [0, 0.2, 0] : key === 'dogBelly' ? [0, -0.2, 0] : [0, 0.85, 0];
      this.q.set(body.q[0], body.q[1], body.q[2], body.q[3]);
      this.v.set(local[0], local[1], local[2]).applyQuaternion(this.q);
      out.x = body.p[0] + this.v.x; out.y = body.p[1] + this.v.y; out.z = body.p[2] + this.v.z;
      return true;
    }
    const part = this.parts.get(FREE_PART_OF[key] ?? '');
    if (!part) return false;
    out.x = part.p[0]; out.y = part.p[1]; out.z = part.p[2];
    return true;
  }

  quat(body: FxBody, out: Quat): boolean {
    const pose = this.pose;
    if (!pose) return false;
    const q = (body === 'dog' ? pose.dog : pose.rider).q;
    out.x = q[0]; out.y = q[1]; out.z = q[2]; out.w = q[3];
    return true;
  }
}
