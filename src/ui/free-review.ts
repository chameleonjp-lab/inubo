import './free-review.css';
import { h } from './dom';
import { FreeArena, type FreeScenario } from '../game/free-arena';
import { FREE_RULES_VERSION, type FreeTarget } from '../game/free-motion';
import { length } from '../game/math';
import { FreePointerController } from '../input/free-pointer';
import { FreeScene } from '../view/free-scene';

export function startFreeReview(root: HTMLElement): void {
  document.title = 'イヌボー｜慣性で自由操作';
  const stage = h('div', { class: 'free-stage', 'data-testid': 'free-stage', 'aria-label': 'この画面をなぞって空中で回転' });
  const canvas = h('canvas', { 'aria-label': '犬と人の実際の姿勢', role: 'img' }); stage.append(canvas);
  const status = h('p', { class: 'free-status', role: 'status', 'data-testid': 'free-status' });
  const meter = h('output', { class: 'free-meter', 'data-testid': 'free-speed' });
  const score = h('output', { 'data-testid': 'free-score' }, '0点');
  const pad = h('div', { class: 'free-pad', 'data-testid': 'free-pad', 'aria-label': 'ここをスワイプして空中で回転' }, h('span', {}, 'ここをスワイプ'), h('small', {}, '横・縦・斜め、自由に動かせます'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true'); pad.append(svg);
  const targets = h('div', { class: 'free-targets', role: 'group', 'aria-label': '回す対象' });
  let target: FreeTarget = 'common', arena = new FreeArena(), scenario: FreeScenario = 'flat';
  let paused = false, half = true, clockUs = 0, lastWall = performance.now(), clockAnchor = lastWall;
  const pointer = new FreePointerController({ right: [0.8320502943, 0, -0.5547001962], up: [0, 1, 0], toward: [0.5547001962, 0, 0.8320502943] }, true);
  const trails = new Map<number, SVGPolylineElement | null>();
  const clearPointers = () => { pointer.clear(); trails.clear(); svg.replaceChildren(); };
  const tickClock = (now: number) => {
    if (!paused && (arena.phase === 'air' || arena.phase === 'settling')) clockUs += Math.max(0, now - lastWall) * 1000 * (half ? 0.5 : 1);
    lastWall = now; clockAnchor = now;
  };
  const sync = () => { tickClock(performance.now()); arena.advance(Math.round(clockUs)); };
  for (const [value, text] of [['common', '一緒'], ['dog', '犬'], ['rider', '人']] as const) {
    const b = h('button', { type: 'button', 'aria-pressed': value === target ? 'true' : 'false', 'data-testid': `target-${value}`, onclick: () => {
      target = value; for (const c of targets.children) c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    } }, text); targets.append(b);
  }
  const jump = h('button', { class: 'free-primary', 'data-testid': 'free-jump', onclick: () => { sync(); clearPointers(); arena.jump(); update(); } }, 'ジャンプ');
  const high = h('button', { 'data-testid': 'free-high', onclick: () => { sync(); clearPointers(); arena.jump(true); update(); } }, '高く跳ぶ');
  const pause = h('button', { 'data-testid': 'free-pause', onclick: () => { sync(); setPause(!paused); } }, '一時停止');
  const setPause = (v: boolean) => { paused = v; clearPointers(); lastWall = performance.now(); update(); };
  const retry = h('button', { 'data-testid': 'free-retry', onclick: () => { arena = new FreeArena(scenario); clockUs = 0; clearPointers(); setPause(false); } }, 'やり直す');
  const slow = h('button', { 'aria-pressed': 'true', 'data-testid': 'free-slow', onclick: () => { sync(); half = !half; slow.setAttribute('aria-pressed', String(half)); slow.textContent = half ? '速さ ½' : '速さ 1'; } }, '速さ ½');
  const select = h('select', { 'aria-label': '確認する場所', onchange: () => {
    scenario = select.value as FreeScenario; scene.setScenario(scenario); retry.click();
  } }, ...([['flat', '平地'], ['wall', '壁あり'], ['rail', 'レールあり']] as const).map(([value, label]) => h('option', { value }, label)));
  const details = h('details', {}, h('summary', {}, '遊び方と確認版の情報'), h('p', {}, '跳んだら、犬が映る画面か操作パッドをなぞります。指を離しても回り続け、逆になぞると勢いを抑えられます。足から着地できるように調整してください。'), h('p', {}, '犬と人を別々に回せます。着地時に足が足置きから離れていると失敗します。点は接触までの動きから計算し、安定した着地の後に確定します。'), h('p', {}, '壁やレールへの接触を試せる確認版です。レールは接触で止まります。'), h('code', {}, `${FREE_RULES_VERSION} / interaction / ${__FREE_SOURCE__} / ${__FREE_BUILD__}`));
  root.className = 'free-review'; root.replaceChildren(
    h('header', { class: 'free-header' }, h('div', {}, h('h1', {}, 'イヌボー 自由操作'), h('p', {}, '慣性で回して、着地を決めよう')), h('span', { class: 'free-badge' }, '操作確認版')),
    h('p', { class: 'free-note' }, '確認版の点は、本番の記録・ランキングに反映しません。'),
    h('div', { class: 'free-work' }, h('div', { class: 'free-viewport' }, stage, h('div', { class: 'free-hud' }, status, h('div', { class: 'free-readings' }, meter, score))), h('section', { class: 'free-control', 'aria-label': '自由操作' }, targets, pad)),
    h('div', { class: 'free-actions' }, jump, high, pause, retry, slow, select), details);
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
      if (paused || (arena.phase !== 'air' && arena.phase !== 'settling')) return;
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
    score.textContent = arena.result ? `${arena.result.points}点` : '着地後に採点';
    score.dataset.points = String(arena.result?.points ?? 0);
    status.textContent = paused ? '停止中 — 再開で続きから動きます' : arena.result ?
      (arena.result.landing === 'crash' ? `転倒・0点｜${arena.result.reason}` : `${arena.result.landing === 'clean' ? 'きれいな着地' : '着地成功'}｜${arena.result.label} ${arena.result.points}点`) :
      arena.phase === 'air' ? '空中 — 指を離しても回り続けます' : arena.phase === 'settling' ? '着地を確認中…' : 'ジャンプしてから、画面をなぞろう';
    pause.textContent = paused ? '再開' : '一時停止';
    jump.disabled = high.disabled = paused || arena.phase === 'air' || arena.phase === 'done';
    pad.dataset.active = String(!paused && (arena.phase === 'air' || arena.phase === 'settling'));
    scene.draw(arena.motion.pose);
  }
  const frame = () => { sync(); update(); requestAnimationFrame(frame); }; frame();
}
