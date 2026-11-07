import {
  COUNTDOWN_US,
  FALL_US,
  FOOT_FRONT,
  FOOT_HALF_WIDTH,
  JUMP_VY,
  KICKER_VY,
  MAX_FRAME_US,
  RAIL_JUMP_VY,
  STEER_GAIN,
  STEP_UP,
  TICK_US,
} from './rules';
import { createEffects, nextEffectEnd, stepPoop, takeFood } from './items';
import {
  currentPath,
  forwardSpeedAt,
  pointAt,
  segmentMotion,
  setTarget,
  surfaceGradeAt,
  updateAttitude,
  updateBaseSpeed,
  type SegmentMotion,
} from './motion';
import { blocksAt, findContacts, insideExpanded, orderContacts, sMmOf, type Contact } from './contacts';
import { breakStreak, createScore, exitSection, finishRun, settleLanding } from './scoring';
import { leaveRail, loseRail, mountRail } from './rails';
import { resolveTricks, type TrickResolution } from './tricks';
import {
  baseHeight,
  gatePhase,
  railGrade,
  railTopAt,
  supportGrade,
  supportHeight,
  type CourseRt,
} from './track';
import type { DogSpec } from '../content/types';
import type { GestureFact, JumpRec, RunIdentity, SimEvent, SimState, StrokeRec } from './types';

/**
 * 走行の計算。入力・接触・採点を画面描画から切り離し、走行時計（整数 µs）だけで順番を決める。
 * 動きは 5ms の一定の刻みで進め、描画の回数を時間・距離・得点の単位にしない。
 */

type Emit = (kind: SimEvent['kind'], atUs: number, data?: SimEvent['data'], objId?: string) => void;

const EMPTY_RESOLUTION: TrickResolution = { rotations: [], held: [], rejected: [], composite: false };
const COLLIDE_COOLDOWN_US = 600_000;
const POSITION_ONLY = new Set<Contact['type']>(['sectionEnd', 'checkpoint', 'item', 'pathEnd', 'goal']);
const MOTION_CHANGING = new Set<Contact['type']>(['lip', 'land', 'railMount', 'solid', 'railEnd', 'ledge', 'dropOff', 'fallDepth']);

export function createRun(identity: RunIdentity, course: CourseRt, dog: DogSpec): SimState {
  const p = course.paths.get(course.start.pathId)!;
  const s = course.start.s;
  const y = supportHeight(p, s, 0, baseHeight(p, s), 0);
  return {
    id: identity,
    course,
    dog,
    simUs: 0,
    finished: false,
    result: null,
    pathId: p.id,
    s,
    x: 0,
    targetX: 0,
    y,
    vy: 0,
    mode: 'ground',
    baseSpeed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    blocked: null,
    ghostGates: [],
    basePitch: 0,
    lastCheckpoint: { pathId: p.id, s, x: 0, id: 'start' },
    fallUntilUs: null,
    effects: createEffects(),
    consumed: {},
    guide: { active: false, forkId: null },
    jump: null,
    jumpCounter: 0,
    rail: null,
    pendingRail: null,
    railsCompleted: [],
    strokes: {},
    score: createScore(),
    inputQueue: [],
    inputLog: [],
    events: [],
    eventSeq: 0,
    route: [],
    forkStack: [],
    gatePhases: {},
    slopeSign: 0,
    collideAt: {},
    exitedSection: null,
  };
}

function makeEmit(run: SimState, out: SimEvent[]): Emit {
  return (kind, atUs, data, objId) => {
    const ev: SimEvent = { runId: run.id.runId, seq: ++run.eventSeq, atUs, kind, pathId: run.pathId, sMm: sMmOf(run.s), x: run.x, y: run.y, objId, data };
    run.events.push(ev);
    out.push(ev);
  };
}

/** 入力を時刻順の待ち行列へ入れる。すでに計算済みの時刻より前の入力は、計算済みの時刻に揃える。 */
export function enqueueFacts(run: SimState, facts: GestureFact[]): void {
  for (const f0 of facts) {
    const f = f0.atUs < run.simUs ? { ...f0, atUs: run.simUs } : f0;
    let i = run.inputQueue.length;
    while (i > 0 && run.inputQueue[i - 1].atUs > f.atUs) i--;
    run.inputQueue.splice(i, 0, f);
  }
}

/**
 * 走行を untilUs まで進める（実際には直前の刻みの境目まで）。描画の回数や間隔によらず、同じ入力なら同じ結果になる。
 * 返す events は、この呼び出しで確定した出来事だけ。
 */
export function advanceRun(run: SimState, untilUs: number, orderedInputs: GestureFact[] = []): { state: SimState; events: SimEvent[] } {
  const out: SimEvent[] = [];
  const emit = makeEmit(run, out);
  enqueueFacts(run, orderedInputs);
  const target = Math.floor(untilUs / TICK_US) * TICK_US;
  while (run.simUs < target && !run.finished) {
    const t0 = run.simUs;
    const t1 = t0 + TICK_US;
    tickStart(run, t0, emit);
    const sBefore = run.s;
    const pathBefore = run.pathId;
    let t = t0;
    while (t < t1 && !run.finished) {
      while (run.inputQueue.length > 0 && run.inputQueue[0].atUs <= t) applyFact(run, run.inputQueue.shift()!, t, emit);
      const nextIn = run.inputQueue.length > 0 && run.inputQueue[0].atUs < t1 ? run.inputQueue[0].atUs : t1;
      moveSegment(run, t, nextIn, emit);
      t = nextIn;
    }
    run.simUs = t1;
    // 空中で壁・柵・ゲートの上を越えた（E11）。演出用で、採点には使わない。
    if (!run.finished && run.mode === 'air' && run.pathId === pathBefore) {
      for (const so of currentPath(run).solids) {
        if (so.kind === 'kicker' || so.kind === 'rail') continue;
        if (so.s1 > sBefore && so.s1 <= run.s && run.x > so.x0 - FOOT_HALF_WIDTH && run.x < so.x1 + FOOT_HALF_WIDTH) emit('clear', t1, { kind: so.kind }, so.id);
      }
    }
  }
  return { state: run, events: out };
}

function tickStart(run: SimState, t0: number, emit: Emit): void {
  if (run.mode === 'falling') return;
  const p = currentPath(run);
  updateBaseSpeed(run, TICK_US);
  updateAttitude(run, TICK_US);
  if (run.mode !== 'rail') setTarget(run, run.targetX);

  // 塞がっていた前方が開いたら、その瞬間に自動で再発進する。
  if (run.blocked) {
    const so = run.course.solidsById.get(run.blocked.solidId);
    let still = false;
    if (so && so.pathId === run.pathId) {
      const plane = so.s0 - FOOT_FRONT;
      const probe = Math.min(Math.max(run.s, plane), so.s1);
      const lateral = run.x > so.x0 - FOOT_HALF_WIDTH - 1e-9 && run.x < so.x1 + FOOT_HALF_WIDTH + 1e-9;
      if (run.blocked.face === 'front') still = lateral && run.s <= so.s1 && blocksAt(run, so, probe, run.y, t0);
      else still = (run.targetX - run.x) * run.blocked.side > 1e-9 && run.s > plane && run.s < so.s1 && blocksAt(run, so, run.s, run.y, t0);
    }
    if (!still) {
      run.blocked = null;
      emit('relaunch', t0);
    }
  }

  // ゲートが足元で上がった場合は、そのゲートの中を抜けるまで当たりにしない。
  for (const so of p.solids) {
    if (so.kind !== 'gate') continue;
    const inside = insideExpanded(so, run.s, run.x);
    const gi = run.ghostGates.indexOf(so.id);
    if (!inside) {
      if (gi >= 0) run.ghostGates.splice(gi, 1);
    } else if (gi < 0 && run.blocked?.solidId !== so.id) {
      const top = baseHeight(p, so.s0) + so.height * gatePhase(so.gate!, t0).raise;
      if (top - run.y > STEP_UP) run.ghostGates.push(so.id);
    }
    // 合図音とランプ（E16）。見える距離のゲートだけ知らせる。
    if (so.s0 > run.s - 5 && so.s0 < run.s + 80) {
      const ph = gatePhase(so.gate!, t0).phase;
      const prev = run.gatePhases[so.id];
      if (prev !== ph) {
        run.gatePhases[so.id] = ph;
        if (prev !== undefined) {
          if (ph === 'lamp') emit('gateLamp', t0, undefined, so.id);
          else if (ph === 'rising') emit('gateRise', t0, undefined, so.id);
          else if (ph === 'falling') emit('gateFall', t0, undefined, so.id);
        }
      }
    }
  }

  if (run.mode === 'ground') {
    const g = surfaceGradeAt(run);
    const sign = g > 0.02 ? 1 : g < -0.02 ? -1 : 0;
    if (sign !== run.slopeSign) {
      run.slopeSign = sign;
      emit('slope', t0, { sign });
    }
  }
}

function moveSegment(run: SimState, ta: number, tb: number, emit: Emit): void {
  let t = ta;
  let guard = 0;
  while (t < tb && !run.finished) {
    if (run.mode === 'falling') {
      const until = run.fallUntilUs ?? tb;
      const end = Math.min(tb, until);
      run.y -= (4 * (end - t)) / 1e6;
      t = end;
      if (until <= tb) respawn(run, t, emit);
      continue;
    }
    let te = tb;
    const eff = nextEffectEnd(run.effects, t, te);
    if (eff !== null) te = eff;
    const m = segmentMotion(run, t);
    if (t + m.reachUs < te) te = Math.min(te, t + Math.max(1, Math.ceil(m.reachUs - 1e-6)));
    const span = te - t;
    if (++guard > 64) {
      // 同じ時刻の接触が続いて進めない場合は、その場で止める（接触を調べずに進めることはしない）。
      t = tb;
      break;
    }
    const found = findContacts(run, m, span);
    const tau = found ? found.tau : span;
    applyMotion(run, m, tau, t + tau);
    t += tau;
    if (found) {
      // 動き方を変える接触（跳ぶ・着く・止まる・落ちる）のあとは、同じ時刻に見つけた残りの接触のうち
      // 位置だけで決まるもの（区間・復帰地点・取得・道の終わり・ゴール）だけを処理する。
      const modeBefore = run.mode;
      let changed = false;
      for (const c of found.contacts) {
        if (run.finished) break;
        if (changed && !POSITION_ONLY.has(c.type)) continue;
        processContact(run, c, t, emit);
        if (run.mode !== modeBefore || MOTION_CHANGING.has(c.type)) changed = true;
      }
    }
    postSegment(run, t, emit);
  }
}

function applyMotion(run: SimState, m: SegmentMotion, tau: number, tUs: number): void {
  const pt = pointAt(m, tau, run);
  run.s = pt.s;
  run.x = pt.x;
  run.forwardSpeed = m.dsdt;
  run.lateralSpeed = tau > 0 ? m.latV : run.lateralSpeed;
  if (m.air) {
    run.y = pt.y;
    run.vy = pt.vy;
  } else if (m.rail) {
    run.y = pt.y;
  } else {
    const sup = supportHeight(m.path, pt.s, pt.x, run.y, tUs);
    if (sup >= run.y - 0.25 - 1e-9) run.y = sup;
  }
}

function postSegment(run: SimState, t: number, emit: Emit): void {
  const e = run.effects;
  if (e.foodUntilUs !== null && t >= e.foodUntilUs) {
    e.foodUntilUs = null;
    emit('boostEnd', t);
  }
  if (e.poopUntilUs !== null && t >= e.poopUntilUs) {
    e.poopUntilUs = null;
    emit('slowEnd', t);
  }
}

function onKicker(run: SimState): boolean {
  const p = currentPath(run);
  for (const so of p.solids) {
    if (so.kind !== 'kicker') continue;
    if (run.s >= so.s0 && run.s <= so.s1 && run.x >= so.x0 && run.x <= so.x1) return true;
  }
  return false;
}

function takeoff(run: SimState, t: number, kind: JumpRec['kind'], vy: number, emit: Emit, fromRail: string | null = null): void {
  run.jumpCounter += 1;
  run.jump = { jumpId: run.jumpCounter, takeoffUs: t, kind, fromRail, strokes: [], resolution: EMPTY_RESOLUTION };
  run.mode = 'air';
  run.vy = vy;
  if (kind !== 'drop') emit('jump', t, { jumpId: run.jumpCounter, kind });
}

function landedInsideCheck(run: SimState, t: number): void {
  const p = currentPath(run);
  for (const so of p.solids) {
    if (so.kind === 'gate' && run.ghostGates.includes(so.id)) continue;
    if (insideExpanded(so, run.s, run.x) && blocksAt(run, so, Math.max(run.s, so.s0 - FOOT_FRONT), run.y, t)) {
      run.blocked = { solidId: so.id, face: 'front', side: 0, sinceUs: t };
      run.baseSpeed = 0;
      return;
    }
  }
}

function emitCollide(run: SimState, solidId: string, face: string, t: number, emit: Emit): void {
  const last = run.collideAt[solidId];
  run.collideAt[solidId] = t;
  if (last !== undefined && t - last < COLLIDE_COOLDOWN_US) return;
  emit('collide', t, { face, kind: run.course.solidsById.get(solidId)?.kind ?? 'wall' }, solidId);
}

function processContact(run: SimState, c: Contact, t: number, emit: Emit): void {
  const p = currentPath(run);
  switch (c.type) {
    case 'sectionEnd':
      run.exitedSection = { key: c.section.key, atUs: t };
      exitSection(run.score, c.section, t, emit);
      break;
    case 'goal':
      if (!run.finished) {
        run.finished = true;
        run.result = finishRun(run, t);
        emit('goal', t, { recordCs: run.result.recordCs, total: run.result.total });
      }
      break;
    case 'pathEnd':
      transition(run, t, emit);
      break;
    case 'checkpoint':
      run.lastCheckpoint = { pathId: p.id, s: c.cp.s, x: c.cp.x, id: c.cp.id };
      emit('checkpoint', t, undefined, c.cp.id);
      break;
    case 'item': {
      const it = c.item;
      run.consumed[it.id] = true;
      if (it.kind === 'food') {
        takeFood(run.effects, t);
        emit('food', t, { untilUs: run.effects.foodUntilUs }, it.id);
      } else if (it.kind === 'poop') {
        stepPoop(run.effects, t);
        emit('poop', t, { untilUs: run.effects.poopUntilUs }, it.id);
      } else {
        run.guide.active = true;
        emit('guide', t, undefined, it.id);
      }
      break;
    }
    case 'lip':
      takeoff(run, t, 'kicker', KICKER_VY, emit);
      break;
    case 'solid': {
      const so = c.solid;
      if (c.face === 'front') {
        run.s = Math.min(run.s, so.s0 - FOOT_FRONT);
        run.blocked = { solidId: so.id, face: 'front', side: 0, sinceUs: t };
      } else {
        run.x = c.side > 0 ? so.x0 - FOOT_HALF_WIDTH : so.x1 + FOOT_HALF_WIDTH;
        run.blocked = { solidId: so.id, face: 'side', side: c.side, sinceUs: t };
      }
      run.baseSpeed = 0;
      breakStreak(run.score);
      emitCollide(run, so.id, c.face, t, emit);
      break;
    }
    case 'railMount': {
      const r = c.rail;
      run.s = Math.max(run.s, r.s0);
      run.y = railTopAt(r, run.s);
      settleLanding(run, { atUs: t, pathId: p.id, sMm: sMmOf(run.s), surfacePitch: Math.atan(railGrade(r)), onRail: r.id }, emit);
      run.jump = null;
      mountRail(run, r, t, sMmOf(run.s), emit);
      run.basePitch = Math.atan(railGrade(r));
      break;
    }
    case 'land': {
      const sup = supportHeight(p, run.s, run.x, run.y, t);
      run.y = sup;
      const pitch = Math.atan(supportGrade(p, run.s, run.x, run.y, t));
      if (run.jump) settleLanding(run, { atUs: t, pathId: p.id, sMm: sMmOf(run.s), surfacePitch: pitch, onRail: null }, emit);
      run.jump = null;
      run.mode = 'ground';
      run.vy = 0;
      run.basePitch = pitch;
      landedInsideCheck(run, t);
      break;
    }
    case 'railEnd': {
      const r = c.rail;
      const v = forwardSpeedAt(run, t);
      leaveRail(run, t, sMmOf(Math.min(run.s, r.s1)), 'end', emit);
      takeoff(run, t, 'drop', v * railGrade(r), emit, r.id);
      break;
    }
    case 'ledge':
    case 'dropOff':
      takeoff(run, t, 'drop', 0, emit);
      break;
    case 'fallDepth':
      startFall(run, t, emit);
      break;
  }
}

/** 試験用: その時刻にコース外へ落ちたことにする（落下の扱いを検査するため）。 */
export function forceFall(run: SimState, t: number): SimEvent[] {
  const out: SimEvent[] = [];
  startFall(run, t, makeEmit(run, out));
  return out;
}

function startFall(run: SimState, t: number, emit: Emit): void {
  run.mode = 'falling';
  run.fallUntilUs = t + FALL_US;
  if (run.rail) {
    // 滑っている途中で落ちた手すりも、無事に降りる前なので 0 点。
    loseRail(run, { railId: run.rail.railId, distMm: Math.max(0, sMmOf(run.s) - run.rail.entryMm), fullLength: false }, t, emit);
  }
  if (run.pendingRail) loseRail(run, run.pendingRail, t, emit);
  run.pendingRail = null;
  run.rail = null;
  run.jump = null;
  run.blocked = null;
  breakStreak(run.score);
  emit('fall', t);
}

function respawn(run: SimState, t: number, emit: Emit): void {
  const cp = run.lastCheckpoint;
  const p = run.course.paths.get(cp.pathId)!;
  run.pathId = cp.pathId;
  run.s = cp.s;
  run.x = cp.x;
  run.targetX = cp.x;
  run.y = supportHeight(p, cp.s, cp.x, baseHeight(p, cp.s) + 0.01, t);
  run.vy = 0;
  run.mode = 'ground';
  run.baseSpeed = 0;
  run.fallUntilUs = null;
  run.ghostGates = [];
  run.basePitch = 0;
  emit('respawn', t, undefined, cp.id);
  landedInsideCheck(run, t);
}

function transition(run: SimState, t: number, emit: Emit): void {
  const p = currentPath(run);
  const next = p.next;
  if (next.kind === 'end') {
    run.s = p.length;
    run.blocked = { solidId: '__end__', face: 'front', side: 0, sinceUs: t };
    return;
  }
  let toId: string;
  let forkInfo: { forkId: string; index: number; label: string; trick: boolean } | null = null;
  if (next.kind === 'path') {
    toId = next.to;
  } else {
    const opts = next.options;
    let idx = opts.findIndex((o) => run.x >= o.xMin && run.x < o.xMax);
    if (idx < 0) idx = run.x < opts[0].xMin ? 0 : opts.length - 1;
    toId = opts[idx].to;
    forkInfo = { forkId: next.forkId, index: idx, label: opts[idx].label, trick: !!opts[idx].trick };
  }
  // 道の最後の採点区間を、まだ抜けていなければここで抜ける。
  const last = p.sections[p.sections.length - 1];
  if (last && !(run.exitedSection && run.exitedSection.key === last.key && t - run.exitedSection.atUs < 100_000)) {
    run.exitedSection = { key: last.key, atUs: t };
    exitSection(run.score, last, t, emit);
  }
  const np = run.course.paths.get(toId)!;
  const dx = p.offEnd - np.offStart;
  if (run.rail) leaveRail(run, t, sMmOf(run.s), 'end', emit);
  run.pathId = toId;
  run.s = Math.max(0, run.s - p.length);
  run.x += dx;
  setTarget(run, run.targetX + dx);
  if (forkInfo) {
    run.forkStack.push(forkInfo.forkId);
    run.guide.forkId = run.guide.active ? forkInfo.forkId : null;
    emit('fork', t, { forkId: forkInfo.forkId, option: forkInfo.index, label: forkInfo.label, trick: forkInfo.trick });
  } else if (p.def.route && !np.def.route) {
    run.forkStack.pop();
    emit('merge', t);
    if (run.guide.active) {
      run.guide.active = false;
      run.guide.forkId = null;
      emit('guideClose', t);
    }
  }
  if (np.def.route && np.id !== p.id) run.route.push(np.def.route);
}

function resolveCurrentJump(run: SimState, atUs: number, emit: Emit): void {
  const j = run.jump;
  if (!j) return;
  const prev = j.resolution;
  const strokes = j.strokes.map((id) => run.strokes[id]).filter(Boolean);
  const res = resolveTricks(strokes, atUs);
  const key = (r: { channel: string; strokeId: number; establishedUs: number }) => `${r.channel}:${r.strokeId}:${r.establishedUs}`;
  const before = new Set(prev.rotations.map(key));
  for (const r of res.rotations) {
    if (!before.has(key(r))) emit('trickStart', Math.max(atUs, r.startUs), { name: r.name, channel: r.channel, startUs: r.startUs, durUs: r.durUs, jumpId: j.jumpId });
  }
  const heldBefore = new Set(prev.held.map((c) => `${c.strokeId}:${c.establishedUs}`));
  for (const c of res.held) if (!heldBefore.has(`${c.strokeId}:${c.establishedUs}`)) emit('trickHeld', atUs, { kind: c.kind, jumpId: j.jumpId });
  if (res.composite && !prev.composite) emit('composite', atUs, { jumpId: j.jumpId });
  j.resolution = res;
}

function applyFact(run: SimState, f: GestureFact, t: number, emit: Emit): void {
  run.inputLog.push(f);
  const atUs = Math.max(f.atUs, t);
  if (f.kind === 'down') {
    let tag: StrokeRec['tag'] = 'ignored';
    if (!run.finished && run.mode !== 'falling') tag = run.mode === 'air' ? 'air' : 'ground';
    const rec: StrokeRec = {
      strokeId: f.strokeId,
      downUs: atUs,
      upUs: null,
      cancelled: false,
      tag,
      jumpId: tag === 'air' ? run.jump?.jumpId ?? null : null,
      baseTargetX: run.targetX,
      consumed: false,
      candidates: [],
    };
    run.strokes[f.strokeId] = rec;
    if (tag === 'air' && run.jump) {
      run.jump.strokes.push(f.strokeId);
      resolveCurrentJump(run, atUs, emit);
    }
    return;
  }
  const rec = run.strokes[f.strokeId];
  if (!rec) return;
  switch (f.kind) {
    case 'steer':
      if (rec.tag === 'ground' && !rec.consumed && run.mode !== 'rail' && run.mode !== 'falling') setTarget(run, rec.baseTargetX + f.dx * STEER_GAIN);
      break;
    case 'forward':
      if (rec.tag !== 'ground' || rec.consumed) break;
      rec.consumed = true;
      if (run.mode === 'ground') {
        takeoff(run, atUs, onKicker(run) ? 'kicker' : 'flat', onKicker(run) ? KICKER_VY : JUMP_VY, emit);
      } else if (run.mode === 'rail' && run.rail) {
        const railId = run.rail.railId;
        leaveRail(run, atUs, sMmOf(run.s), 'jump', emit);
        takeoff(run, atUs, 'rail', RAIL_JUMP_VY, emit, railId);
      }
      break;
    case 'circle':
    case 'line':
      if (rec.tag !== 'air' || !run.jump || rec.jumpId !== run.jump.jumpId || rec.upUs !== null) break;
      if (f.kind === 'circle') rec.candidates.push({ kind: 'dog', strokeId: f.strokeId, establishedUs: atUs, vertical: f.vertical, clockwise: f.clockwise });
      else rec.candidates.push({ kind: 'body', strokeId: f.strokeId, establishedUs: atUs, dir8: f.dir8, afterCircle: f.afterCircle });
      resolveCurrentJump(run, atUs, emit);
      break;
    case 'reject':
      emit('trickReject', atUs, { reason: f.reason, air: rec.tag === 'air' });
      break;
    case 'up':
      if (rec.upUs !== null) break;
      rec.upUs = atUs;
      rec.cancelled = f.cancelled;
      if (rec.tag === 'air' && run.jump && rec.jumpId === run.jump.jumpId) resolveCurrentJump(run, atUs, emit);
      break;
  }
}

/** 計算済みの時刻ちょうどの入力（指の取り消しなど）を、時刻を進めずに反映する。 */
function flushAt(run: SimState, t: number): void {
  const out: SimEvent[] = [];
  const emit = makeEmit(run, out);
  while (run.inputQueue.length > 0 && run.inputQueue[0].atUs <= t) applyFact(run, run.inputQueue.shift()!, t, emit);
}

/** 外から通知された接触の形（試験と、通知の到着順を入れ替える検査に使う）。 */
export type DeliveredContact =
  | { type: 'land'; atUs: number; seq?: number }
  | { type: 'goal'; atUs: number; seq?: number }
  | { type: 'sectionEnd'; atUs: number; sectionKey: string; seq?: number };

/**
 * 通知の到着順にかかわらず、実際に触れた時刻（整数 µs）→ 同時刻の処理順で処理する。
 * ゴールのあとに届いた着地は採点しない。同じ通知を2回受け取っても1回分しか数えない。
 */
export function deliverContacts(run: SimState, list: DeliveredContact[]): SimEvent[] {
  const out: SimEvent[] = [];
  const emit = makeEmit(run, out);
  for (const d of orderContacts(list)) {
    if (run.finished) break;
    if (d.type === 'land') processContact(run, { type: 'land' }, d.atUs, emit);
    else if (d.type === 'goal') processContact(run, { type: 'goal' }, d.atUs, emit);
    else {
      const sec = currentPath(run).sections.find((x) => x.key === d.sectionKey);
      if (sec) processContact(run, { type: 'sectionEnd', section: sec }, d.atUs, emit);
    }
  }
  return out;
}

/** 描画用: 計算済みの時刻より少し先の位置を、今の速さで外挿する。 */
export function extrapolate(run: SimState, renderUs: number): { s: number; x: number; y: number } {
  const dt = Math.max(0, Math.min(TICK_US, renderUs - run.simUs)) / 1e6;
  if (run.finished || run.mode === 'falling') return { s: run.s, x: run.x, y: run.y };
  const s = run.s + run.forwardSpeed * dt;
  const x = run.x + run.lateralSpeed * dt;
  let y = run.y;
  if (run.mode === 'air') y = run.y + run.vy * dt - 7 * dt * dt;
  return { s: Math.min(s, currentPath(run).length), x, y };
}

// ---------------------------------------------------------------------------
// 走行の進行役: 秒読み、時計、一時停止と再開。
// ---------------------------------------------------------------------------

export type RunPhase = 'countdown' | 'running' | 'finished';
export type PauseReason = 'manual' | 'hidden' | 'orientation';

/**
 * 開始・一時停止・再開・終了を、同じ時刻を2回通知されても一度だけ実行する。
 * 中断の理由はまとめて保持し、「画面が見えている」「指がすべて離れた」「再開を押した」がそろったときだけ進める。
 */
export class RunSession {
  readonly sim: SimState;
  phase: RunPhase = 'countdown';
  paused = false;
  readonly pauseReasons = new Set<PauseReason>();
  hidden = false;
  resumeRequested = false;
  countdownUs = 0;
  /** 走行時計（計算を進める目標の時刻）。 */
  runTargetUs = 0;
  private lastWallUs: number | null = null;
  private pending: GestureFact[] = [];
  private activePointers = new Set<number>();
  private countdownShown = -1;
  private sessionEvents: SimEvent[] = [];
  private seq = 0;

  constructor(identity: RunIdentity, course: CourseRt, dog: DogSpec) {
    this.sim = createRun(identity, course, dog);
  }

  get runId(): string {
    return this.sim.id.runId;
  }

  private sessionEvent(kind: SimEvent['kind'], data?: SimEvent['data']): void {
    this.sessionEvents.push({ runId: this.runId, seq: -++this.seq, atUs: this.sim.simUs, kind, pathId: this.sim.pathId, sMm: sMmOf(this.sim.s), x: this.sim.x, y: this.sim.y, data });
  }

  /** 秒読みが終わった瞬間に走行時計を 0 にして発進する。2回目以降は何もしない。 */
  begin(overflowUs = 0): boolean {
    if (this.phase !== 'countdown') return false;
    this.phase = 'running';
    this.runTargetUs = Math.max(0, overflowUs);
    this.sessionEvent('start');
    return true;
  }

  /** 入力の時刻（走行時計）を決める。秒読み中・中断中・終了後は null（ゲーム操作として受け取らない）。 */
  runClockUs(wallUs: number): number | null {
    if (this.phase !== 'running' || this.paused) return null;
    const ahead = this.lastWallUs === null ? 0 : Math.max(0, Math.min(MAX_FRAME_US, wallUs - this.lastWallUs));
    return Math.max(this.sim.simUs, Math.round(this.runTargetUs + ahead));
  }

  /** 入力を受け取る。前の走行の遅れた入力は走行番号で捨てる。 */
  submit(runId: string, facts: GestureFact[]): void {
    if (runId !== this.runId) return;
    if (this.phase !== 'running') return;
    if (this.paused) {
      // 中断中は、指の取り消し（描きかけの指を捨てる通知）だけを、止まった時刻で受け取る。
      for (const f of facts) if (f.kind === 'up') this.pending.push({ ...f, atUs: this.sim.simUs, cancelled: true });
      return;
    }
    this.pending.push(...facts);
  }

  pointerDown(pointerId: number): void {
    this.activePointers.add(pointerId);
  }

  pointerUp(pointerId: number, wallUs: number): void {
    this.activePointers.delete(pointerId);
    this.tryResume(wallUs);
  }

  get pointersDown(): number {
    return this.activePointers.size;
  }

  pause(reason: PauseReason): void {
    if (this.phase === 'finished') return;
    this.pauseReasons.add(reason);
    this.resumeRequested = false;
    if (!this.paused) {
      this.paused = true;
      // 描きかけの指は捨てる。計算済みの状態（物理・確定済みの角度）はそのまま保持する。
      this.pending = this.pending.filter((f) => f.kind === 'up').map((f) => ({ ...f, atUs: this.sim.simUs, cancelled: true }));
      this.sessionEvent('pause', { reason });
    }
  }

  setHidden(hidden: boolean, wallUs: number): void {
    this.hidden = hidden;
    if (hidden) this.pause('hidden');
    else this.tryResume(wallUs);
  }

  requestResume(wallUs: number): void {
    if (!this.paused) return;
    this.resumeRequested = true;
    this.tryResume(wallUs);
  }

  private tryResume(wallUs: number): void {
    if (!this.paused || !this.resumeRequested || this.hidden || this.activePointers.size > 0) return;
    this.paused = false;
    this.resumeRequested = false;
    this.pauseReasons.clear();
    // 中断していた実時間は計算へ渡さない。
    this.lastWallUs = wallUs;
    this.sessionEvent('resume');
  }

  /** 毎フレーム呼ぶ。実時間の進みを走行時計へ渡し、確定した出来事を返す。 */
  update(wallUs: number): SimEvent[] {
    if (this.lastWallUs === null) this.lastWallUs = wallUs;
    const delta = Math.max(0, Math.min(MAX_FRAME_US, wallUs - this.lastWallUs));
    this.lastWallUs = wallUs;
    const out: SimEvent[] = this.sessionEvents;
    this.sessionEvents = [];
    if (this.phase === 'finished') return out;
    if (this.paused) {
      if (this.pending.length > 0) {
        enqueueFacts(this.sim, this.pending);
        this.pending = [];
        // 時刻を進めずに、取り消しだけを反映する。
        const { events } = advanceRun(this.sim, this.sim.simUs, []);
        out.push(...events);
        flushAt(this.sim, this.sim.simUs);
      }
      return out;
    }
    if (this.phase === 'countdown') {
      this.countdownUs += delta;
      const n = 3 - Math.floor(this.countdownUs / 1_000_000);
      if (n >= 1 && n !== this.countdownShown) {
        this.countdownShown = n;
        out.push({ runId: this.runId, seq: -++this.seq, atUs: 0, kind: 'countdown', pathId: this.sim.pathId, sMm: sMmOf(this.sim.s), x: 0, y: this.sim.y, data: { n } });
      }
      if (this.countdownUs < COUNTDOWN_US) return out;
      this.begin(this.countdownUs - COUNTDOWN_US);
      out.push(...this.sessionEvents);
      this.sessionEvents = [];
    } else {
      this.runTargetUs += delta;
    }
    const facts = this.pending;
    this.pending = [];
    const { events } = advanceRun(this.sim, this.runTargetUs, facts);
    out.push(...events);
    if (this.sim.finished) this.phase = 'finished';
    return out;
  }
}
