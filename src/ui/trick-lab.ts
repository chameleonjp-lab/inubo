import { h } from './dom';
import { LAB_GROUP_NAMES, TRICK_LAB_LESSONS, labDemo, type LabButtonId, type LabLesson, type LabSetupField } from '../content/trick-lab';
import {
  LabDemoRunner,
  NEUTRAL_SETUP,
  abortLab,
  advanceLab,
  aimFromSwipe,
  AIM_STEP_M,
  createLabAttempt,
  handName,
  handleName,
  solveLabPose,
  type LabAction,
  type LabInput,
  type LabSetup,
  type LabState,
  type Stance,
} from '../game/trick-lab';
import { LAB_FIXTURES, labEdge, type LabFixtureId } from '../game/trick-lab-terrain';
import type { DogId, DogLook } from '../content/types';
import type { GameView } from '../view/scene';

/**
 * 練習広場から開く「技の練習」。競技の走行・記録・順位とは別の試行を管理する。
 * 操作は親指1本で順に押せるボタンを基本にし、スワイプでも同じ命令を送れる。
 */

export interface TrickLabHost {
  view: GameView;
  dogId: DogId;
  look: DogLook;
  clothes: string;
  helmet: string;
  uiSound(name: 'decide' | 'retry' | 'back' | 'stamp' | 'demo'): void;
  /** 「練習広場へ戻る」。 */
  exit(): void;
}

const BUTTON_LABEL: Record<Exclude<LabButtonId, 'grab' | 'start'>, string> = {
  left: '左',
  right: '右',
  pop: '跳ぶ',
  catch: '足を戻す',
  plant: '前足を着く',
  loadFront: '前',
  loadCenter: '中',
  loadBack: '後',
  brake: '止める',
  exit: '抜ける',
};

const FIELD_OPTIONS: Record<LabSetupField, { label: string; options: [string, string][] }> = {
  dogYaw: {
    label: '犬の水平回転',
    options: [['0', '0°'], ['45', 'FS 45°'], ['-45', 'BS 45°'], ['90', 'FS 90°'], ['-90', 'BS 90°'], ['180', 'FS 180°'], ['-180', 'BS 180°'], ['360', 'FS 360°'], ['-360', 'BS 360°']],
  },
  flip: { label: '犬の裏返り', options: [['none', 'なし'], ['kick', 'キック'], ['heel', 'ヒール']] },
  riderYaw: { label: '人の水平回転', options: [['0', '0°'], ['90', 'FS 90°'], ['-90', 'BS 90°'], ['180', 'FS 180°'], ['-180', 'BS 180°']] },
  tilt: { label: '犬の先端の傾き', options: [['level', '水平'], ['up', '上'], ['down', '下']] },
  exitMotion: { label: '脱出の動き', options: [['straight', '直進'], ['revert', '姿勢を戻す'], ['backward', 'そのまま後退'], ['bsHalf', 'BSへ半回転'], ['fsHalf', 'FSへ半回転']] },
  hand: { label: 'つかむ手', options: [['front', '前の手'], ['back', '後ろの手']] },
  handle: { label: '持ち手', options: [['nose', '前端'], ['tail', '後端'], ['toe', 'つま先側（両足の間）'], ['heel', 'かかと側（両足の間）']] },
};

const REASON_LABEL: Record<string, string> = {
  wrongRotation: '回転が違います',
  wrongSupport: '支え方が違います',
  wrongOrder: '順番が違います',
  earlyRelease: '離すのが早すぎます',
  collision: 'ぶつかりました',
  unstableLanding: '着地が乱れました',
  timeout: '時間切れです',
};

function nowMs(): number {
  return performance.now();
}

let attemptCounter = 0;
function newAttemptId(prefix: string): string {
  attemptCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${attemptCounter}`;
}

/** お手本の操作を、押す順に短い言葉で並べる。 */
export function demoOrderText(lesson: LabLesson, fixture: LabFixtureId): string {
  const steps = labDemo(lesson, fixture);
  const parts: string[] = [];
  let holding = false;
  for (const s of steps) {
    if (!s.button) continue;
    if (s.button === 'start') parts.push('走り出す');
    else if (s.button === 'grab') {
      parts.push(holding ? 'はなす' : 'つかむ');
      holding = !holding;
    } else parts.push(BUTTON_LABEL[s.button]);
  }
  if (fixture === 'kicker' && lesson.req.kind === 'air') parts.splice(1, 0, '（踏切台の上端で跳び出す）');
  return parts.join(' → ');
}

export class TrickLabScreen {
  readonly el: HTMLElement;
  lesson: LabLesson;
  fixtureId: LabFixtureId;
  stance: Stance = 'regular';
  rate = 0.5;
  /** プレイヤーの準備。再試行では再利用し、技を変えたら中立に戻す。 */
  setup: LabSetup = { ...NEUTRAL_SETUP };
  state: LabState;
  readonly inputs: LabInput[] = [];
  demo: LabDemoRunner | null = null;
  paused = false;
  /** 練習時計（プレイヤーの試行の時刻、マイクロ秒）。 */
  labUs = 0;
  private demoUs = 0;
  private demoEndMs: number | null = null;
  private seq = 0;
  private raf = 0;
  private lastFrameMs = 0;
  private destroyed = false;
  private resultShown = false;
  private surface: HTMLElement;
  private status: HTMLElement;
  private info: HTMLElement;
  private setupPanel: HTMLElement;
  private pauseCover: HTMLElement;
  private resultPanel: HTMLElement;
  private buttons = new Map<LabButtonId, HTMLButtonElement>();
  private demoBtn: HTMLButtonElement;
  private rateBtn: HTMLButtonElement;
  private lessonSel: HTMLSelectElement;
  private fixtureSel: HTMLSelectElement;
  private swipe: { id: number; x: number; y: number; popped: boolean } | null = null;
  private reduced: MediaQueryList | null;

  constructor(private host: TrickLabHost) {
    this.lesson = TRICK_LAB_LESSONS[0];
    this.fixtureId = this.lesson.fixtureIds[0];
    this.state = this.newAttempt();
    this.reduced = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    this.lessonSel = h('select', { class: 'lab-select', 'data-testid': 'lab-lesson', 'aria-label': '技を選ぶ', onchange: () => this.selectLesson(this.lessonSel.value) });
    let group = '';
    let og: HTMLOptGroupElement | null = null;
    for (const l of TRICK_LAB_LESSONS) {
      if (l.group !== group) {
        group = l.group;
        og = h('optgroup', { label: LAB_GROUP_NAMES[l.group] });
        this.lessonSel.append(og);
      }
      og!.append(h('option', { value: l.id }, `${l.id} ${l.ja}（難度${l.difficulty}）`));
    }
    this.fixtureSel = h('select', { class: 'lab-select', 'data-testid': 'lab-fixture', 'aria-label': '練習地形', onchange: () => this.selectFixture(this.fixtureSel.value as LabFixtureId) });
    this.demoBtn = h('button', { class: 'btn small', 'data-testid': 'lab-demo', onclick: () => (this.demo ? this.stopDemo() : this.startDemo()) }, 'お手本を見る');
    this.rateBtn = h('button', { class: 'btn small', 'data-testid': 'lab-rate', 'aria-pressed': 'true', onclick: () => this.toggleRate() }, '半速');
    this.info = h('div', { class: 'lab-info', 'data-testid': 'lab-info' });
    this.setupPanel = h('div', { class: 'lab-setup', 'data-testid': 'lab-setup' });
    this.status = h('p', { class: 'lab-status', 'data-testid': 'lab-status', 'aria-live': 'polite' });
    this.resultPanel = h('div', { class: 'lab-result hidden', 'data-testid': 'lab-result' });
    this.surface = h('div', { class: 'lab-surface', 'data-testid': 'lab-surface', 'aria-label': 'スワイプ操作面' });
    this.pauseCover = h(
      'div',
      { class: 'pause-cover hidden', 'data-testid': 'lab-pause-cover' },
      h('h2', {}, '一時停止'),
      h('p', { class: 'pause-hint' }, '画面から指を離してから「再開」を押してください。'),
      h('button', { class: 'btn primary big', 'data-testid': 'lab-resume', onclick: (e: Event) => this.resume(e) }, '再開'),
      h('button', { class: 'btn', onclick: () => this.leave() }, '練習広場へ戻る'),
    );

    const btn = (id: LabButtonId, label: string, extra = '') => {
      const b = h('button', { class: `lab-btn ${extra}`, 'data-testid': `lab-btn-${id}`, 'data-btn': id, onpointerdown: (e: Event) => this.press(id, e as PointerEvent) }, label);
      // キーボードでも押せるようにする（pointerdown を出さない click だけを拾う）。
      b.addEventListener('click', (e) => {
        if ((e as MouseEvent).detail === 0) this.press(id, e);
      });
      this.buttons.set(id, b);
      return b;
    };

    this.el = h(
      'section',
      { class: 'screen trick-lab', 'data-testid': 'trick-lab' },
      this.surface,
      h(
        'div',
        { class: 'lab-top' },
        h(
          'div',
          { class: 'lab-row' },
          h('button', { class: 'btn small', 'data-testid': 'lab-exit', 'aria-label': '練習広場へ戻る', onclick: () => this.leave() }, '戻る'),
          this.lessonSel,
          h('button', { class: 'pause-btn', 'aria-label': '一時停止', 'data-testid': 'lab-pause', onclick: () => this.pause() }, 'Ⅱ'),
        ),
        this.info,
        this.setupPanel,
        this.status,
        this.resultPanel,
      ),
      h(
        'div',
        { class: 'lab-controls', 'data-testid': 'lab-controls' },
        h('div', { class: 'lab-row lab-meta' }, btn('start', '走り出す', 'start'), this.demoBtn, this.rateBtn),
        h('div', { class: 'lab-grid' },
          btn('left', '左'), btn('pop', '跳ぶ'), btn('right', '右'), btn('catch', '足を戻す'),
          btn('grab', 'つかむ', 'grab'), btn('plant', '前足を着く'), btn('brake', '止める'), btn('exit', '抜ける'),
          h('span', { class: 'lab-load-label', 'aria-hidden': 'true' }, '荷重'), btn('loadFront', '前'), btn('loadCenter', '中'), btn('loadBack', '後'),
        ),
      ),
      this.pauseCover,
    );
    this.bindSurface();
    this.renderLesson();
  }

  // ------------------------------------------------------------ 試行

  private newAttempt(): LabState {
    return createLabAttempt({ attemptId: newAttemptId('lab'), lessonId: this.lesson.id, fixtureId: this.fixtureId, stance: this.stance, dogId: this.host.dogId });
  }

  /** やり直し・技や地形の変更。古い入力と接触を捨て、新しい試行を作る。 */
  restart(): void {
    if (this.state && !this.state.outcome) abortLab(this.state);
    this.state = this.newAttempt();
    this.inputs.length = 0;
    this.labUs = 0;
    this.resultShown = false;
    this.resultPanel.classList.add('hidden');
    this.resultPanel.replaceChildren();
    this.swipe = null;
    // 停止中の準備を、新しい試行の最初の入力として送る。
    this.send({ type: 'setup', setup: { ...this.setup } });
    this.host.view.setTrickLabStage(this.fixtureId, labEdge(this.fixtureId, this.edgeSide()), this.host.look, this.host.clothes, this.host.helmet);
    this.renderSetup();
    this.syncButtons();
  }

  private edgeSide(): 1 | -1 {
    const req = this.lesson.req;
    const side = req.kind === 'edge' ? req.edge.side : 1;
    return (side * (this.stance === 'regular' ? 1 : -1)) as 1 | -1;
  }

  selectLesson(id: string): void {
    const l = TRICK_LAB_LESSONS.find((x) => x.id === id);
    if (!l) return;
    this.stopDemo();
    this.lesson = l;
    this.fixtureId = l.fixtureIds[0];
    this.setup = { ...NEUTRAL_SETUP };
    this.renderLesson();
  }

  selectFixture(id: LabFixtureId): void {
    if (!this.lesson.fixtureIds.includes(id)) return;
    this.stopDemo();
    this.fixtureId = id;
    this.renderLesson();
  }

  private toggleRate(): void {
    this.rate = this.rate === 0.5 ? 1 : 0.5;
    this.rateBtn.textContent = this.rate === 0.5 ? '半速' : '通常速度';
    this.rateBtn.setAttribute('aria-pressed', String(this.rate === 0.5));
  }

  /** ボタンを押した瞬間の練習時計。描画の間隔に左右されないよう、押した時刻から換算する。 */
  private clockAt(eventMs: number | null): number {
    if (this.paused || this.state.phase === 'ready') return Math.max(this.labUs, this.state.timeUs);
    const ahead = eventMs === null ? 0 : Math.max(0, eventMs - this.lastFrameMs);
    return Math.max(this.state.timeUs, Math.round(this.labUs + ahead * 1000 * this.rate));
  }

  send(action: LabAction, eventMs: number | null = null): LabInput | null {
    if (this.demo || this.paused) return null;
    const input: LabInput = { attemptId: this.state.attemptId, atUs: this.clockAt(eventMs), seq: ++this.seq, action };
    this.inputs.push(input);
    // その時刻までを進め、ボタンの表示をすぐに合わせる。
    advanceLab(this.state, input.atUs, this.inputs);
    this.syncButtons();
    return input;
  }

  press(id: LabButtonId, e: Event): void {
    e.preventDefault();
    if (this.demo || this.paused) return;
    const at = (e as PointerEvent).timeStamp ?? null;
    if (this.state.outcome && id !== 'start') return;
    switch (id) {
      case 'start':
        if (this.state.outcome || this.state.phase !== 'ready') {
          this.host.uiSound('retry');
          this.restart();
          return;
        }
        this.host.uiSound('decide');
        this.send({ type: 'start' }, at);
        this.renderSetup();
        return;
      case 'left':
        this.send({ type: 'aim', dx: -AIM_STEP_M }, at);
        return;
      case 'right':
        this.send({ type: 'aim', dx: AIM_STEP_M }, at);
        return;
      case 'pop':
        this.send({ type: 'pop' }, at);
        return;
      case 'catch':
        this.send({ type: 'catch' }, at);
        return;
      case 'grab':
        // 同じ位置のボタンが、届いた後は「はなす」になる。
        this.send(this.state.hand.state === 'holding' ? { type: 'release' } : { type: 'grab' }, at);
        return;
      case 'plant':
        this.send({ type: 'plant' }, at);
        return;
      case 'loadFront':
        this.send({ type: 'load', load: 'front' }, at);
        return;
      case 'loadCenter':
        this.send({ type: 'load', load: 'center' }, at);
        return;
      case 'loadBack':
        this.send({ type: 'load', load: 'back' }, at);
        return;
      case 'brake':
        this.send({ type: 'brake' }, at);
        return;
      case 'exit':
        this.send({ type: 'exit' }, at);
        return;
    }
  }

  // ------------------------------------------------------------ スワイプ

  private bindSurface(): void {
    const el = this.surface;
    const unit = () => Math.max(1, Math.min(window.innerWidth, window.innerHeight));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.demo || this.paused || this.swipe) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 無視 */
      }
      this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, popped: false };
    });
    el.addEventListener('pointermove', (e) => {
      const sw = this.swipe;
      if (!sw || sw.id !== e.pointerId || sw.popped) return;
      // 上への払いは、指を離す前に跳ぶ（「跳ぶ」と同じ命令）。
      const dy = (e.clientY - sw.y) / unit();
      const dx = (e.clientX - sw.x) / unit();
      if (dy < -0.06 && Math.abs(dy) > Math.abs(dx)) {
        sw.popped = true;
        this.send({ type: 'pop' }, e.timeStamp);
      }
    });
    el.addEventListener('pointerup', (e) => {
      const sw = this.swipe;
      if (!sw || sw.id !== e.pointerId) return;
      this.swipe = null;
      if (sw.popped) return;
      const dx = (e.clientX - sw.x) / unit();
      const dy = (e.clientY - sw.y) / unit();
      if (Math.abs(dx) >= 0.04 && Math.abs(dx) > Math.abs(dy)) this.send({ type: 'aim', dx: aimFromSwipe(dx) }, e.timeStamp);
    });
    el.addEventListener('pointercancel', (e) => {
      if (this.swipe?.id === e.pointerId) this.pause();
    });
    el.addEventListener('lostpointercapture', (e) => {
      // 指を離した後の通知は無視し、操作中に捕捉を失ったときだけ止める。
      if (this.swipe?.id === e.pointerId) this.pause();
    });
  }

  // ------------------------------------------------------------ お手本

  startDemo(): void {
    if (this.paused) return;
    this.demo = new LabDemoRunner({ attemptId: newAttemptId('demo'), lessonId: this.lesson.id, fixtureId: this.fixtureId, stance: this.stance, dogId: this.host.dogId });
    this.demoUs = 0;
    this.demoEndMs = null;
    this.el.classList.add('lab-demo-playing');
    this.demoBtn.textContent = 'お手本を止める';
    this.host.uiSound('demo');
    this.syncButtons();
  }

  stopDemo(): void {
    if (!this.demo) return;
    this.demo = null;
    this.el.classList.remove('lab-demo-playing');
    this.demoBtn.textContent = 'お手本を見る';
    this.syncButtons();
    this.showStatus();
  }

  // ------------------------------------------------------------ 一時停止

  pause(): void {
    if (this.destroyed || this.paused) return;
    // 手本を中断した場合はプレイヤー試行へ戻って停止を続ける。
    this.stopDemo();
    this.paused = true;
    this.swipe = null;
    this.pauseCover.classList.remove('hidden');
  }

  private resume(e: Event): void {
    e.preventDefault();
    this.paused = false;
    this.lastFrameMs = nowMs();
    this.pauseCover.classList.add('hidden');
    this.syncButtons();
  }

  onVisibility(hidden: boolean): void {
    if (hidden) this.pause();
  }

  onOrientationChange(): void {
    this.pause();
  }

  // ------------------------------------------------------------ 描画

  start(): void {
    this.lastFrameMs = nowMs();
    const loop = () => {
      if (this.destroyed) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.demo = null;
    this.host.view.clearTrickLabStage();
  }

  private leave(): void {
    this.host.uiSound('back');
    this.host.exit();
  }

  private frame(): void {
    const t = nowMs();
    const dtMs = Math.min(100, t - this.lastFrameMs);
    this.lastFrameMs = t;
    const reduced = this.reduced?.matches ?? false;
    if (this.demo) {
      if (!this.paused) {
        this.demoUs += dtMs * 1000 * this.rate;
        this.demo.advanceTo(this.demoUs);
      }
      const next = this.demo.nextButton();
      this.highlight(next);
      const pose = solveLabPose(this.demo.state);
      this.host.view.frameTrickLab(pose, this.demo.state.hand.state !== 'idle' ? this.demo.state.setup.handle : null, dtMs, reduced, this.viewBand());
      this.status.textContent = this.demoStatus(this.demo);
      if (this.demo.done) {
        if (this.demoEndMs === null) this.demoEndMs = t;
        else if (t - this.demoEndMs > 1200) this.stopDemo();
      }
      return;
    }
    if (!this.paused && this.state.phase !== 'ready' && !this.state.outcome) {
      this.labUs += dtMs * 1000 * this.rate;
      advanceLab(this.state, this.labUs, this.inputs);
      this.syncButtons();
    }
    this.highlight(null);
    this.host.view.frameTrickLab(solveLabPose(this.state), null, dtMs, reduced, this.viewBand());
    if (this.state.outcome && !this.resultShown) this.showResult();
    else if (!this.state.outcome) this.showStatus();
  }

  /** パネルに隠れていない場所。犬と人がここに映るようにカメラを合わせる。 */
  private viewBand(): { left: number; top: number; right: number; bottom: number } {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const top = this.el.querySelector('.lab-top')?.getBoundingClientRect();
    const ctl = this.el.querySelector('.lab-controls')?.getBoundingClientRect();
    if (!top || !ctl) return { left: 0, top: 0, right: w, bottom: hh };
    if (w > hh && top.bottom > hh * 0.7) return { left: top.right, top: 0, right: ctl.left > top.right + 80 ? ctl.left : w, bottom: hh };
    return { left: 0, top: top.bottom, right: w, bottom: Math.max(top.bottom + 80, ctl.top) };
  }

  private demoStatus(d: LabDemoRunner): string {
    const o = d.state.outcome;
    if (o) return o.kind === 'success' ? `お手本：${o.detail}` : `お手本：${o.detail}`;
    const next = d.nextButton(10_000_000);
    if (!next) return 'お手本：着地して走り抜けます';
    if (next === 'grab') return d.state.hand.state === 'holding' ? 'お手本：次は「はなす」' : 'お手本：次は「つかむ」';
    return `お手本：次は「${next === 'start' ? '走り出す' : BUTTON_LABEL[next]}」`;
  }

  private highlight(id: LabButtonId | null): void {
    for (const [k, b] of this.buttons) b.classList.toggle('demo-next', k === id);
  }

  /** 「つかむ」「はなす」は同じ位置と大きさのまま、実際の保持状態に表示を合わせる。 */
  syncButtons(): void {
    const st = this.demo ? this.demo.state : this.state;
    const grab = this.buttons.get('grab')!;
    const holding = st.hand.state === 'holding';
    const label = holding ? 'はなす' : 'つかむ';
    if (grab.textContent !== label) grab.textContent = label;
    grab.classList.toggle('holding', holding);
    grab.setAttribute('aria-busy', String(st.hand.state === 'reaching'));
    const start = this.buttons.get('start')!;
    const startLabel = this.state.phase === 'ready' && !this.state.outcome ? '走り出す' : 'やり直す';
    if (start.textContent !== startLabel) start.textContent = startLabel;
    for (const b of this.buttons.values()) b.disabled = !!this.demo || this.paused;
  }

  private showStatus(): void {
    const st = this.state;
    let text = '';
    if (st.phase === 'ready') text = '準備を選んで「走り出す」を押します。';
    else if (st.hand.state === 'reaching') text = `${handName(st.setup.hand)}を${handleName(st.setup.handle)}へ伸ばしています…`;
    else if (st.hand.state === 'holding') text = `${handleName(st.setup.handle)}を持っています。指を離しても保持が続きます。`;
    else {
      const miss = [...st.events].reverse().find((e) => e.kind === 'grabMiss');
      if (miss && st.timeUs - miss.atUs < 1_200_000) text = miss.detail ?? '';
      else if (st.events.some((e) => e.kind === 'zone') && st.supports.length === 0 && this.lesson.id === '31') text = 'いまが跳べる範囲です（縁の手前0.5〜1.2 m）。';
    }
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private showResult(): void {
    const o = this.state.outcome!;
    this.resultShown = true;
    this.resultPanel.classList.remove('hidden');
    if (o.kind === 'success') this.host.uiSound('stamp');
    this.resultPanel.replaceChildren(
      h('h3', { 'data-testid': 'lab-outcome', 'data-outcome': o.kind }, o.kind === 'success' ? '成功' : o.kind === 'fail' ? `失敗：${REASON_LABEL[o.reason]}` : '中止'),
      h('p', {}, o.detail),
      h('p', { class: 'lab-note' }, '練習の結果は競技の記録・ランキングには入りません。'),
    );
    this.status.textContent = '';
    this.syncButtons();
  }

  // ------------------------------------------------------------ 表示

  private renderLesson(): void {
    const l = this.lesson;
    this.lessonSel.value = l.id;
    this.fixtureSel.replaceChildren(...l.fixtureIds.map((f) => h('option', { value: f }, LAB_FIXTURES[f].name)));
    this.fixtureSel.value = this.fixtureId;
    this.info.replaceChildren(
      h('details', {},
        h('summary', { 'data-testid': 'lab-title' }, `${l.ja}`, h('span', { class: 'lab-en' }, ` ${l.en}・イヌボー版`)),
        l.alias ? h('p', { class: 'lab-tag' }, `別名：${l.alias}`) : '',
        h('p', {}, l.motion),
        h('p', {}, l.pass),
      ),
      h('p', { class: 'lab-order', 'data-testid': 'lab-order' }, `押す順：${demoOrderText(l, this.fixtureId)}`),
    );
    this.restart();
  }

  private renderSetup(): void {
    const ready = this.state.phase === 'ready';
    const fields = this.lesson.setupFields;
    const rows: HTMLElement[] = [h('label', {}, '地形', this.fixtureSel)];
    this.fixtureSel.disabled = !ready && !this.state.outcome;
    const stanceSel = h('select', { 'data-testid': 'lab-stance', disabled: !ready, onchange: () => {
      this.stance = stanceSel.value as Stance;
      this.restart();
    } }, h('option', { value: 'regular' }, '左足前'), h('option', { value: 'goofy' }, '右足前'));
    stanceSel.value = this.stance;
    rows.push(h('label', {}, '構え', stanceSel));
    for (const f of fields) {
      const def = FIELD_OPTIONS[f];
      const sel = h('select', { 'data-testid': `lab-setup-${f}`, disabled: !ready, onchange: () => {
        const v = sel.value;
        const value = f === 'dogYaw' || f === 'riderYaw' ? Number(v) : v;
        (this.setup as unknown as Record<string, unknown>)[f] = value;
        this.send({ type: 'setup', setup: { [f]: value } as Partial<LabSetup> });
      } }, ...def.options.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = String(this.setup[f]);
      rows.push(h('label', {}, def.label, sel));
    }
    this.setupPanel.replaceChildren(...rows);
    this.setupPanel.classList.toggle('locked', !ready);
  }
}
