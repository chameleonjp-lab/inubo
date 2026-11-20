import './free-review.css';
import { h } from './dom';
import { FreeArena, type FreeResult, type FreeScenario } from '../game/free-arena';
import { fxTargetOf, landingSoundName } from '../view/trick-fx';
import { TRICK_FX_81, fxProgram, isFxId, type FxId, type FxTarget } from '../view/trick-fx-81';
import { FxTimeline, predictedAirUs, type FxVisualEvent } from '../view/trick-fx-timeline';
import { FREE_RULES_VERSION, type FreeTarget } from '../game/free-motion';
import { length } from '../game/math';
import { FreePointerController } from '../input/free-pointer';
import { FreeScene } from '../view/free-scene';
import { AudioEngine } from '../audio/sound';
import { TRICK_LANDING, trickLandingText } from '../view/trick-landing';
import { showTrickLanding } from './trick-landing';

export function startFreeReview(root: HTMLElement): void {
  document.title = 'イヌボー｜慣性で自由操作';
  const stage = h('div', { class: 'free-stage', 'data-testid': 'free-stage', 'aria-label': 'この画面をなぞって空中で回転' });
  const canvas = h('canvas', { 'aria-label': '犬と人の実際の姿勢', role: 'img' }); stage.append(canvas);
  const status = h('div', { class: 'free-status', role: 'status', 'data-testid': 'free-status' });
  const meter = h('output', { class: 'free-meter', 'data-testid': 'free-speed' });
  const score = h('output', { 'data-testid': 'free-score' }, '0点');
  const pad = h('div', { class: 'free-pad', 'data-testid': 'free-pad', 'aria-label': 'ここをスワイプして空中で回転' }, h('span', {}, 'ここをスワイプ'), h('small', {}, '横・縦・斜め、自由に動かせます'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true'); pad.append(svg);
  const targets = h('div', { class: 'free-targets', role: 'group', 'aria-label': '回す対象' });
  let target: FreeTarget = 'common', arena = new FreeArena(), scenario: FreeScenario = 'flat';
  let paused = false, half = true, clockUs = 0, lastWall = performance.now(), clockAnchor = lastWall;
  const pointer = new FreePointerController({ right: [0.8320502943, 0, -0.5547001962], up: [0, 1, 0], toward: [0.5547001962, 0, 0.8320502943] }, true, false);
  const trails = new Map<number, SVGPolylineElement | null>();
  const clearPointers = () => { pointer.clear(); trails.clear(); svg.replaceChildren(); };
  const tickClock = (now: number) => {
    if (!paused && arena.phase === 'air') clockUs += Math.max(0, now - lastWall) * 1000 * (half ? 0.5 : 1);
    lastWall = now; clockAnchor = now;
  };
  const sync = () => { tickClock(performance.now()); arena.advance(Math.round(clockUs)); };
  const audio = new AudioEngine();
  let soundOn = true;
  let shownResult: FreeResult | null = null;
  let playedResult: FreeResult | null = null;
  let landingShown: ReturnType<typeof trickLandingText> | null = null;
  // 81種類の演出：競技と同じ時間割で段階を決める。
  const timeline = new FxTimeline();
  let jumpId = 0, airUs = 0, landedFor = -1, lastFrameMs = performance.now();
  let galleryId: FxId | null = null, gallerySeq = 1_000_000;
  const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  const syncSound = () => audio.update(soundOn && !paused ? 0.7 : 0, { steps: null, wind: null, grind: null }, lastWall);
  const sound = h('button', { 'aria-pressed': 'true', onclick: () => {
    soundOn = !soundOn;
    sound.setAttribute('aria-pressed', String(soundOn));
    sound.textContent = soundOn ? '音あり' : '消音';
    if (soundOn) audio.unlock();
    syncSound();
  } }, '音あり');
  for (const [value, text] of [['common', '両方'], ['dog', '犬だけ'], ['rider', '人だけ']] as const) {
    const selectTarget = () => {
      if (target === value) return;
      target = value;
      pointer.retargetAll(value);
      for (const c of targets.children) c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    };
    const b = h('button', { type: 'button', 'aria-pressed': value === target ? 'true' : 'false', 'data-testid': `target-${value}`, onpointerdown: selectTarget, onclick: selectTarget }, text); targets.append(b);
  }
  const startJump = (isHigh: boolean) => {
    arena.jump(isHigh);
    jumpId++;
    airUs = predictedAirUs(arena.motion.velocity[1], -arena.motion.acceleration[1]);
  };
  const jump = h('button', { class: 'free-primary', 'data-testid': 'free-jump', onclick: () => { if (soundOn) audio.unlock(); syncSound(); sync(); clearPointers(); galleryId = null; startJump(false); update(); } }, 'ジャンプ');
  const high = h('button', { 'data-testid': 'free-high', onclick: () => { if (soundOn) audio.unlock(); syncSound(); sync(); clearPointers(); galleryId = null; startJump(true); update(); } }, '高く跳ぶ');
  const pause = h('button', { 'data-testid': 'free-pause', onclick: () => { if (paused && soundOn) audio.unlock(); sync(); setPause(!paused); } }, '一時停止');
  const setPause = (v: boolean) => { paused = v; clearPointers(); lastWall = performance.now(); syncSound(); update(); };
  const resetFx = () => { timeline.reset(); scene?.fx.clear(); landedFor = -1; };
  const retry = h('button', { 'data-testid': 'free-retry', onclick: () => { audio.stopTrickLanding(); arena = new FreeArena(scenario); clockUs = 0; resetFx(); galleryId = null; clearPointers(); setPause(false); } }, 'やり直す');
  // 開発・確認用：81種類を1件ずつ選んで再生する（確認版だけに入り、本番の画面には出ない）。
  const gallery = h('select', { 'aria-label': '演出を1件ずつ確認', 'data-testid': 'fx-gallery' },
    ...TRICK_FX_81.map(prog => h('option', { value: prog.id }, `${prog.id} ${prog.name}`)));
  const galleryTargetOf = (target: FxTarget): FreeTarget => target === 'B' ? 'common' : target === 'D' ? 'dog' : 'rider';
  const playGallery = h('button', { 'data-testid': 'fx-gallery-play', onclick: () => {
    if (!isFxId(gallery.value)) return;
    audio.stopTrickLanding(); arena = new FreeArena(scenario); clockUs = 0; resetFx(); clearPointers(); setPause(false);
    const prog = fxProgram(gallery.value);
    galleryId = prog.id;
    startJump(true);
    // 対象の身体を実際に回す（演出は身体の計測点に追従するため、回していない身体では軌跡が出ない）。
    arena.advance(0, [{ seq: gallerySeq++, atUs: 0, target: galleryTargetOf(prog.target), rotation: [0.2, 0.08, 0.75] }]);
    const kind = prog.kind === 'L' ? 'A' : prog.kind;
    const id = (prog.kind === 'L' ? `${prog.target}-A07` : prog.id) as FxId;
    const show = (ev: FxVisualEvent) => scene.applyFx(ev, arena.motion.pose);
    show({ tUs: 0, jumpId, kind, target: prog.target, level: fxProgram(id).level, id });
    if (prog.kind === 'F') show({ tUs: 0, jumpId, kind: 'C', target: prog.target, level: 1, id: null });
    update();
  } }, '演出を見る');
  const slow = h('button', { 'aria-pressed': 'true', 'data-testid': 'free-slow', onclick: () => { sync(); half = !half; slow.setAttribute('aria-pressed', String(half)); slow.textContent = half ? '速さ ½' : '速さ 1'; } }, '速さ ½');
  const select = h('select', { 'aria-label': '確認する場所', onchange: () => {
    scenario = select.value as FreeScenario; scene.setScenario(scenario); retry.click();
  } }, ...([['flat', '平地'], ['wall', '壁あり'], ['rail', 'レールあり']] as const).map(([value, label]) => h('option', { value }, label)));
  const details = h('details', {}, h('summary', {}, '遊び方と確認版の情報'), h('p', {}, '跳んだら、犬が映る画面か操作パッドをなぞります。指を離しても回り続け、逆になぞると勢いを抑えられます。'), h('p', {}, '犬と人を別々に回せます。半回転から技になります。着地までの回転数と方向で技名と点が決まります。'), h('p', {}, '壁やレールへの接触を試せる確認版です。レールは接触で止まります。'), h('code', {}, `${FREE_RULES_VERSION} / interaction / ${__FREE_SOURCE__} / ${__FREE_BUILD__}`));
  root.className = 'free-review'; root.replaceChildren(
    h('header', { class: 'free-header' }, h('div', {}, h('h1', {}, 'イヌボー 自由操作'), h('p', {}, '慣性で回して、着地を決めよう')), h('span', { class: 'free-badge' }, '操作確認版')),
    h('p', { class: 'free-note' }, '確認版の点は、本番の記録・ランキングに反映しません。'),
    h('div', { class: 'free-work' }, h('div', { class: 'free-viewport' }, stage, h('div', { class: 'free-hud' }, status, h('div', { class: 'free-readings' }, meter, score))), h('section', { class: 'free-control', 'aria-label': '自由操作' }, targets, pad)),
    h('div', { class: 'free-actions' }, jump, high, pause, retry, slow, select, sound),
    h('div', { class: 'free-actions free-gallery', 'data-testid': 'fx-gallery-row' }, gallery, playGallery), details);
  let scene: FreeScene;
  try { scene = new FreeScene(canvas); scene.setScenario(scenario); }
  catch { status.textContent = '描画を開始できません。ページを再読み込みしてください。'; jump.disabled = high.disabled = true; return; }
  const resize = () => { const r = pad.getBoundingClientRect(); pointer.setSurface(r.width, r.height); clearPointers(); };
  resize();
  const coords = (e: PointerEvent) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const move = (e: PointerEvent) => {
    if (paused || !trails.has(e.pointerId)) return;
    e.preventDefault(); tickClock(performance.now());
    const samples = e.getCoalescedEvents?.() ?? [];
    const last = samples[samples.length - 1];
    if (!last || last.clientX !== e.clientX || last.clientY !== e.clientY) samples.push(e);
    const inputs = samples.flatMap(sample => {
      const [x, y] = coords(sample);
      const eventUs = clockUs + (sample.timeStamp - clockAnchor) * 1000 * (half ? 0.5 : 1);
      const atUs = Math.max(arena.motion.timeUs, Math.round(Math.min(clockUs, Math.max(0, eventUs))));
      const line = trails.get(e.pointerId);
      if (line) line.setAttribute('points', `${line.getAttribute('points')} ${x},${y}`);
      return pointer.move(e.pointerId, x, y, atUs);
    });
    arena.advance(Math.round(clockUs), inputs); update();
  };
  const release = (e: PointerEvent) => {
    if (e.type === 'pointerup') move(e);
    pointer.up(e.pointerId); trails.get(e.pointerId)?.remove(); trails.delete(e.pointerId);
  };
  for (const surface of [stage, pad]) {
    surface.addEventListener('pointerdown', e => {
      if (paused || arena.phase !== 'air') return;
      const [x, y] = coords(e);
      if (!pointer.down(e.pointerId, x, y, target)) return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch { /* 捕捉できない場合も操作面内の入力は使う。 */ }
      if (surface === pad) {
        const line = document.createElementNS(svg.namespaceURI, 'polyline') as SVGPolylineElement;
        line.setAttribute('points', `${x},${y}`); line.setAttribute('class', `trail-${target}`); svg.append(line);
        trails.set(e.pointerId, line);
      } else trails.set(e.pointerId, null);
    });
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('lostpointercapture', release);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sync(); setPause(true); } });
  window.addEventListener('blur', () => { sync(); setPause(true); });
  window.addEventListener('resize', () => { sync(); resize(); if (arena.phase !== 'ready') setPause(true); });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); sync(); setPause(true); status.textContent = '描画が中断しました。やり直すにはページを再読み込みしてください。'; });
  function update(): void {
    root.dataset.phase = arena.phase; root.dataset.paused = String(paused); root.dataset.timeUs = String(arena.motion.timeUs);
    root.dataset.cutoffUs = String(arena.cutoffUs ?? '');
    const omega = arena.motion.omega;
    const speeds = [omega.common, omega.dog, omega.rider].map(v => length(v) * 180 / Math.PI);
    meter.textContent = `回転の勢い ${speeds.map(v => Math.round(v)).join(' / ')}°/秒`;
    meter.dataset.common = String(speeds[0]); meter.dataset.dog = String(speeds[1]); meter.dataset.rider = String(speeds[2]);
    const result = arena.result;
    // 空中の段階は走行の時計（arena の時刻）で決め、着地は一度だけ。
    if (!galleryId) {
      const flight = arena.phase === 'air' ? { jumpId, takeoffUs: 0, predictedAirUs: airUs, heading: 0, motionTimeUs: arena.motion.timeUs,
        history: arena.motion.history, inputs: arena.motion.seen.values() } : null;
      const events = arena.phase === 'air' ? timeline.observe(arena.motion.timeUs, flight, target) : [];
      if (result && landedFor !== jumpId) {
        landedFor = jumpId;
        events.push(...(result.landing === 'landed'
          ? timeline.land(result.cutoffUs, jumpId, { fxTarget: fxTargetOf(result.scoredTarget), trickBase: result.basePoints, trickPoints: result.points })
          : timeline.end(result.cutoffUs, jumpId)));
      }
      for (const ev of events) scene.applyFx(ev, arena.motion.pose);
    } else if (result && landedFor !== jumpId) {
      landedFor = jumpId;
      const prog = fxProgram(galleryId);
      scene.applyFx(prog.kind === 'L' ? { tUs: result.cutoffUs, jumpId, kind: 'L', target: prog.target, level: prog.level, id: prog.id }
        : { tUs: result.cutoffUs, jumpId, kind: 'X', target: null, level: 0, id: null }, arena.motion.pose);
    }
    root.dataset.fxIds = scene.fx.activeIds().join(' ');
    const stage = result ? TRICK_LANDING[result.tier - 1] : undefined;
    score.textContent = result ? `${result.points}点` : '着地後に採点';
    score.dataset.points = String(result?.points ?? 0);
    score.hidden = !!stage;
    status.dataset.trickTier = String(result?.tier ?? 0);
    if (result && stage) {
      if (shownResult !== result) {
        landingShown = trickLandingText(`着地｜${result.label}`, result.points, result.points, false, {
          basePoints: result.basePoints, switchBonus: result.switchBonus, switchCount: result.switchCount, fxTarget: fxTargetOf(result.scoredTarget),
        });
        showTrickLanding(status, landingShown);
        shownResult = result;
      }
      if (!paused && playedResult !== result) {
        playedResult = result;
        const name = landingShown?.fxTarget && landingShown.landingLevel ? landingSoundName(landingShown.fxTarget, landingShown.landingLevel) : stage.sound;
        if (soundOn) audio.play({ name, gain: 0.7, pitch: 1, reverse: false });
      }
    } else {
      shownResult = null;
      status.textContent = paused ? '停止中 — 再開で続きから動きます' : result?.label ??
        (arena.phase === 'air' ? '空中 — 指を離しても回り続けます' : 'ジャンプしてから、画面をなぞろう');
    }
    pause.textContent = paused ? '再開' : '一時停止';
    jump.disabled = high.disabled = paused || arena.phase === 'air' || arena.phase === 'done';
    pad.dataset.active = String(!paused && arena.phase === 'air');
    const now = performance.now();
    scene.draw(arena.motion.pose, { paused, reduced: reducedQuery?.matches ?? false, dtMs: (now - lastFrameMs) * (half ? 0.5 : 1) });
    lastFrameMs = now;
    root.dataset.fxLines = String(scene.fxStats.lines + scene.fxStats.dots + scene.fxStats.decals);
  }
  const frame = () => { sync(); update(); requestAnimationFrame(frame); }; frame();
}
