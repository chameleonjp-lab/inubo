import { h, clear, fmtInt } from './dom';
import { renderBoard, renderResults } from './results';
import { PRACTICE_STEPS, PracticeCoach } from './practice';
import { formatTime, homeShareText, officialUrl, resultShareText, shareOnX, shareableResult } from './share';
import { RunSession } from '../game/run';
import { RULES_VERSION } from '../game/rules';
import { Autopilot } from '../game/autopilot';
import { trickScore } from '../game/scoring';
import { uAtS } from '../game/track';
import { foodActive } from '../game/items';
import { maxSpeed } from '../game/motion';
import { GestureRecognizer } from '../input/gestures';
import { COURSE_DEFS, RACE_COURSES, getCourse } from '../content/courses/index';
import { DOGS, DOG_ORDER } from '../content/dogs';
import { GameView } from '../view/scene';
import { CenterText, UI_CUES, cueForEvent, type Cue } from '../view/effects';
import { ReplayRecorder } from '../view/replay';
import { AudioEngine, SoundScheduler } from '../audio/sound';
import { Records, browserStorage, loadProfile, loadSettings, newId, saveProfile, saveSettings, type Profile, type SaveOutcome, type Settings } from '../storage/records';
import { RankingClient, type BoardState } from '../ranking/client';
import { MockRankingServer } from '../ranking/mockServer';
import type { CourseId, DogId } from '../content/types';
import type { GestureFact, RunIdentity, RunResult, SimEvent } from '../game/types';

/**
 * 画面の流れ: ホーム（選択）→ 秒読み → 走行 → 結果。一時停止・再開と、練習広場・遊び方・設定・スタンプ帳。
 */

export interface AppOptions {
  /** 自動操縦で走らせる（検査用）。コースの手順名（safe / short / trick）。 */
  autoplay: string | null;
  /** 自動操縦のときの時間の速さ。 */
  speed: number;
  debug: boolean;
  ranking: 'off' | 'mock';
}

const CLOTHES = ['#e4572e', '#2e86ab', '#f2c14e', '#6a4c93', '#3bb273'];
const HELMETS = ['#2e86ab', '#e4572e', '#ffffff', '#222222', '#f2c14e'];

function nowMs(): number {
  return performance.now();
}

export class App {
  private store = browserStorage();
  readonly records = new Records(this.store);
  settings: Settings;
  profile: Profile;
  readonly ranking: RankingClient;
  readonly audio = new AudioEngine();
  readonly sound: SoundScheduler;
  private view: GameView | null = null;
  private canvas: HTMLCanvasElement;
  private screenEl: HTMLElement;
  game: GameRun | null = null;
  courseId: CourseId;
  dogId: DogId;
  consent = false;
  lastResult: RunResult | null = null;

  constructor(
    private root: HTMLElement,
    readonly opts: AppOptions,
  ) {
    this.settings = loadSettings(this.store);
    this.profile = loadProfile(this.store);
    this.courseId = this.profile.lastCourse;
    this.dogId = this.profile.lastDog;
    this.sound = new SoundScheduler(this.settings);
    this.ranking = new RankingClient(new MockRankingServer(), this.store, opts.ranking === 'mock');
    this.canvas = h('canvas', { class: 'gl', 'aria-hidden': 'true' });
    this.screenEl = h('div', { class: 'screens' });
    root.append(this.canvas, this.screenEl);
    const unlock = () => this.audio.unlock();
    root.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => this.game?.onVisibility(document.hidden));
    this.onResize();
    void this.ranking.flush();
  }

  ensureView(): GameView {
    if (!this.view) {
      this.view = new GameView(this.canvas);
      this.onResize();
    }
    return this.view;
  }

  private lastPortrait: boolean | null = null;

  private onResize(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    this.view?.resize(w, hgt);
    this.game?.recognizer.setViewport(w, hgt);
    const portrait = hgt >= w;
    if (this.lastPortrait !== null && portrait !== this.lastPortrait) this.game?.pauseFor('orientation');
    this.lastPortrait = portrait;
  }

  private setScreen(el: HTMLElement): void {
    clear(this.screenEl);
    this.screenEl.append(el);
  }

  uiSound(name: keyof typeof UI_CUES): void {
    const c = UI_CUES[name];
    for (const cmd of this.sound.onCues([{ effect: c.effect, visual: c.visual, sound: c.sound, atUs: 0, runId: 'ui' }], nowMs())) this.audio.play(cmd);
  }

  saveProfile(): void {
    this.profile.lastCourse = this.courseId;
    this.profile.lastDog = this.dogId;
    saveProfile(this.store, this.profile);
  }

  // ---------------------------------------------------------------- ホーム
  showHome(): void {
    this.game?.destroy();
    this.game = null;
    this.root.classList.remove('in-game');
    const courseCards = RACE_COURSES.map((id) => {
      const def = COURSE_DEFS[id]!;
      const best = this.records.bestScore({ courseId: id, courseVersion: def.version, rulesVersion: RULES_VERSION });
      const fast = this.records.bestTime({ courseId: id, courseVersion: def.version, rulesVersion: RULES_VERSION });
      return h(
        'button',
        {
          class: `card course-card theme-${def.theme}${id === this.courseId ? ' selected' : ''}`,
          'data-testid': `course-${id}`,
          'aria-pressed': id === this.courseId ? 'true' : 'false',
          onclick: () => {
            this.courseId = id;
            this.uiSound('select');
            this.saveProfile();
            this.showHome();
          },
        },
        h('span', { class: 'card-title' }, def.name),
        h('span', { class: 'card-sub' }, best ? `最高 ${fmtInt(best.total)}点` : '記録なし'),
        h('span', { class: 'card-sub' }, fast ? `最速 ${formatTime(fast.recordCs)}（${DOGS[fast.dogId].name}）` : ''),
      );
    });
    const dogCards = DOG_ORDER.map((id) =>
      h(
        'button',
        {
          class: `card dog-card${id === this.dogId ? ' selected' : ''}`,
          'data-testid': `dog-${id}`,
          'aria-pressed': id === this.dogId ? 'true' : 'false',
          onclick: () => {
            this.dogId = id;
            this.uiSound('select');
            this.saveProfile();
            this.showHome();
          },
        },
        dogIcon(id, id === this.dogId),
        h('span', { class: 'card-title' }, DOGS[id].name),
        h('span', { class: 'card-sub' }, `速さ ${DOGS[id].speedIndex}・小回り ${DOGS[id].handlingIndex}`),
      ),
    );
    const swatches = (list: string[], cur: string, set: (c: string) => void, label: string) =>
      h(
        'div',
        { class: 'swatches', role: 'group', 'aria-label': label },
        h('span', { class: 'sw-label' }, label),
        list.map((c) => h('button', { class: `sw${c === cur ? ' selected' : ''}`, style: `background:${c}`, 'aria-label': `${label} ${c}`, onclick: () => (set(c), this.saveProfile(), this.showHome()) })),
      );
    const nameBlock = this.ranking.enabled
      ? h(
          'div',
          { class: 'name-block' },
          h('label', { for: 'player-name' }, '名前（任意・公開順位に参加するときだけ）'),
          (() => {
            const inp = h('input', { id: 'player-name', maxlength: 16, value: this.profile.name, autocomplete: 'off', 'data-testid': 'name' }) as HTMLInputElement;
            inp.addEventListener('input', () => {
              this.profile.name = inp.value.slice(0, 16);
              this.saveProfile();
            });
            return inp;
          })(),
          (() => {
            const cb = h('input', { type: 'checkbox', id: 'consent', 'data-testid': 'consent' }) as HTMLInputElement;
            cb.checked = this.consent;
            cb.addEventListener('change', () => (this.consent = cb.checked));
            return h('label', { class: 'consent' }, cb, '名前を公開順位に載せる');
          })(),
        )
      : null;
    this.setScreen(
      h(
        'section',
        { class: 'screen home', 'data-testid': 'home' },
        h('h1', { class: 'logo' }, 'イヌボー', h('small', {}, '犬のスケボー')),
        h('h2', {}, 'コース'),
        h('div', { class: 'cards' }, courseCards),
        h('h2', {}, '犬'),
        h('div', { class: 'cards' }, dogCards),
        h('h2', {}, '乗り手'),
        swatches(CLOTHES, this.profile.clothes, (c) => (this.profile.clothes = c), '服'),
        swatches(HELMETS, this.profile.helmet, (c) => (this.profile.helmet = c), 'ヘルメット'),
        nameBlock,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary big', 'data-testid': 'start', onclick: () => (this.uiSound('decide'), this.startRun('competition')) }, 'スタート'),
          h('button', { class: 'btn', 'data-testid': 'practice', onclick: () => (this.uiSound('decide'), this.startRun('practice')) }, '練習広場'),
        ),
        h(
          'div',
          { class: 'actions small-row' },
          h('button', { class: 'btn small', onclick: () => this.showHowTo() }, '遊び方'),
          h('button', { class: 'btn small', 'data-testid': 'settings', onclick: () => this.showSettings() }, '設定'),
          h('button', { class: 'btn small', onclick: () => this.showStamps() }, 'スタンプ帳'),
          this.ranking.enabled ? h('button', { class: 'btn small', onclick: () => this.showRanking() }, 'ランキング') : null,
          h('button', { class: 'btn small x-share', onclick: () => void this.share(homeShareText(officialUrl()), null) }, 'Xでシェア'),
        ),
      ),
    );
  }

  private back(): void {
    this.uiSound('back');
    this.showHome();
  }

  showHowTo(): void {
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, '遊び方'),
        h('p', {}, '犬が自動で前へ進みます。指は曲がる・跳ぶ・技を出すために使います。'),
        h('ul', {}, [
          h('li', {}, '地面で左右に払う: 払った幅の分だけ横へ動きます。'),
          h('li', {}, '上へ払う: 1回跳びます。踏切台からは高く跳べます。'),
          h('li', {}, '空中で円を描いて閉じる: 犬だけが回ります。縦長の円は前後、横長や真円は横転。向きは描く向きで変わります。'),
          h('li', {}, '空中で直線を引いて離す: 人と犬が一緒に回ります。上=前宙、下=後宙、左右=ひねり、斜め=組み合わせ。'),
          h('li', {}, '円と線を重ねる（2本指、または片手で円→線）: 複合技。犬が回り終わる前に線を離します。'),
          h('li', {}, '手すりには上から乗ると滑り、前へ払うと跳び降ります。正面や側面に当たると止まります。'),
        ]),
        h('p', {}, '総合点はタイム点（最大5,000）と技点（最大5,000）の合計です。同じ区間で点になるのは、最初に成功した技のジャンプ1回だけです。3区間続けて成功すると100点を加えます。'),
        h('button', { class: 'btn', onclick: () => this.back() }, 'もどる'),
      ),
    );
  }

  showSettings(): void {
    const s = this.settings;
    const apply = () => {
      saveSettings(this.store, this.settings);
      this.sound.setSettings(this.settings);
    };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, testid: string) => {
      const cb = h('input', { type: 'checkbox', 'data-testid': testid }) as HTMLInputElement;
      cb.checked = get();
      cb.addEventListener('change', () => {
        set(cb.checked);
        apply();
      });
      return h('label', { class: 'setting' }, cb, label);
    };
    const vol = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(s.volume * 100), 'data-testid': 'volume', 'aria-label': '音量' }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value) / 100;
      apply();
    });
    const light = h('select', { 'data-testid': 'light', 'aria-label': '光の量' }, h('option', { value: 'normal' }, 'ふつう'), h('option', { value: 'weak' }, '弱い')) as HTMLSelectElement;
    light.value = s.light;
    light.addEventListener('change', () => {
      this.settings.light = light.value === 'weak' ? 'weak' : 'normal';
      apply();
    });
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, '設定'),
        toggle('音を出す', () => this.settings.soundOn, (v) => (this.settings.soundOn = v), 'sound'),
        h('label', { class: 'setting' }, '音量', vol),
        toggle('画面を揺らす', () => this.settings.shake, (v) => (this.settings.shake = v), 'shake'),
        h('label', { class: 'setting' }, '光の量', light),
        toggle('自分の最速の走りを半透明で表示する', () => this.settings.ghost, (v) => (this.settings.ghost = v), 'ghost'),
        h('p', { class: 'note' }, '設定は成績に影響しません。消音・弱い演出でも、成功と失敗は文字と形で見分けられます。'),
        h('button', { class: 'btn', onclick: () => this.back() }, 'もどる'),
      ),
    );
  }

  showStamps(): void {
    const stamps = this.records.stamps();
    const ch = this.records.challenges();
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, 'スタンプ帳'),
        h(
          'table',
          { class: 'stamps' },
          h('tr', {}, h('th', {}, ''), RACE_COURSES.map((c) => h('th', {}, COURSE_DEFS[c]!.name))),
          DOG_ORDER.map((d) => h('tr', {}, h('th', {}, DOGS[d].name), RACE_COURSES.map((c) => h('td', {}, stamps[d]?.[c] ? '🐾' : '・')))),
        ),
        h('h3', {}, '寄り道課題'),
        h(
          'ul',
          {},
          RACE_COURSES.map((c) => {
            const def = COURSE_DEFS[c]!;
            return h('li', {}, `${def.name}: ${def.challenge?.label ?? '―'} ${ch[`${c}|${def.version}`] ? '🐾 達成' : ''}`);
          }),
        ),
        h('button', { class: 'btn', onclick: () => this.back() }, 'もどる'),
      ),
    );
  }

  showRanking(): void {
    const def = COURSE_DEFS[this.courseId]!;
    const board = h('div', { class: 'board' });
    const load = (metric: 'total' | 'time') =>
      void this.ranking.loadBoard({ courseId: this.courseId, courseVersion: def.version, rulesVersion: RULES_VERSION, metric }, (s) => renderBoardInto(board, s, metric, () => load(metric)));
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, `ランキング｜${def.name}`),
        h('div', { class: 'ranking-tabs' }, h('button', { class: 'btn small', onclick: () => load('total') }, '総合'), h('button', { class: 'btn small', onclick: () => load('time') }, 'タイム')),
        board,
        h('button', { class: 'btn', onclick: () => this.back() }, 'もどる'),
      ),
    );
    load('total');
  }

  async share(text: string, fallbackEl: HTMLElement | null): Promise<void> {
    const res = await shareOnX(text, {
      open: (u) => {
        const w = window.open(u, '_blank');
        if (w) w.opener = null;
        return w;
      },
      copy: (t) => navigator.clipboard.writeText(t),
    });
    if (res === 'opened' || !fallbackEl) return;
    fallbackEl.classList.remove('hidden');
    fallbackEl.replaceChildren(
      h('p', {}, res === 'copied' ? '投稿画面を開けなかったので、同じ文をコピーしました。' : '投稿画面を開けませんでした。次の文を写して使ってください。'),
      h('textarea', { readonly: true, rows: 4, 'data-testid': 'share-text' }, text),
    );
  }

  // ---------------------------------------------------------------- 走行
  startRun(mode: 'competition' | 'practice'): void {
    this.game?.destroy();
    const courseId: CourseId = mode === 'practice' ? 'practice' : this.courseId;
    const course = getCourse(courseId);
    const name = this.profile.name.trim();
    const opt = this.ranking.canParticipate(name, mode, this.consent);
    const identity: RunIdentity = {
      runId: newId(),
      courseId,
      courseVersion: course.def.version,
      rulesVersion: RULES_VERSION,
      dogId: this.dogId,
      mode,
      playerName: opt ? name : '',
      rankingOptIn: opt,
      participantId: opt ? this.profile.participantId : null,
      outfit: { clothes: this.profile.clothes, helmet: this.profile.helmet },
    };
    this.ranking.beginRun(identity);
    void this.ranking.flush();
    const view = this.ensureView();
    view.setCourse(course);
    view.setRider(DOGS[this.dogId].look, this.profile.clothes, this.profile.helmet);
    const key = { courseId, courseVersion: course.def.version, rulesVersion: RULES_VERSION };
    const ghost = mode === 'competition' ? this.records.bestTimeReplay(key) : null;
    view.setGhost(ghost, ghost ? DOGS[ghost.dogId].look : null);
    view.resetEffects();
    this.root.classList.add('in-game');
    this.game = new GameRun(this, identity, view);
    this.setScreen(this.game.el);
    this.game.start();
  }

  finishRun(result: RunResult, replay: ReturnType<ReplayRecorder['finish']> | null): void {
    this.lastResult = result;
    const saved: SaveOutcome = this.records.saveLocalResult(result, replay);
    this.ranking.finishRun(result);
    void this.ranking.flush();
    const def = COURSE_DEFS[result.courseId]!;
    const fallbackHolder: { el: HTMLElement | null } = { el: null };
    const el = renderResults(result, def.name, saved, def.challenge?.label ?? null, {
      retry: () => {
        this.uiSound('retry');
        this.startRun('competition');
      },
      home: () => this.back(),
      share: () => {
        if (!shareableResult(result)) return;
        void this.share(resultShareText(result, def.name, DOGS[result.dogId].name, officialUrl()), fallbackHolder.el);
      },
      ranking: this.ranking.enabled
        ? (metric, onState) => void this.ranking.loadBoard({ courseId: result.courseId, courseVersion: result.courseVersion, rulesVersion: result.rulesVersion, metric }, onState)
        : null,
    });
    fallbackHolder.el = el.querySelector('[data-testid="share-fallback"]');
    this.root.classList.remove('in-game');
    this.setScreen(el);
    // 結果発表（E24）: 内訳ごとの小さな決定音、更新したときだけ上向きの三音。
    [200, 450, 700].forEach((ms) => setTimeout(() => this.uiSound('reveal'), ms));
    if (saved.newBestScore || saved.newBestTime) setTimeout(() => this.uiSound('best'), 950);
    if (saved.newStamp || saved.newChallenge) setTimeout(() => this.uiSound('stamp'), 1200);
  }
}

function renderBoardInto(el: HTMLElement, s: BoardState, metric: 'total' | 'time', retry: () => void): void {
  renderBoard(el, s, metric, retry);
}

function dogIcon(id: DogId, wag: boolean): HTMLElement {
  const look = DOGS[id].look;
  const legs = 20 + look.legLength * 40;
  const len = 40 + look.bodyLength * 30;
  const svg = `<svg viewBox="0 0 120 80" width="96" height="64" aria-hidden="true"><g class="${wag ? 'wag' : ''}">
    <rect x="${60 - len / 2}" y="${60 - legs - 16}" width="${len}" height="20" rx="10" fill="${look.body}"/>
    <rect x="${60 - len / 2 + 6}" y="${60 - legs - 6}" width="${len - 20}" height="9" rx="4" fill="${look.belly}"/>
    <circle cx="${60 + len / 2 + 2}" cy="${60 - legs - 20}" r="11" fill="${look.body}"/>
    <polygon points="${60 + len / 2 - 4},${60 - legs - 28} ${60 + len / 2 + 1},${60 - legs - (look.ear === 'big' ? 44 : 38)} ${60 + len / 2 + 6},${60 - legs - 28}" fill="${look.body}"/>
    ${[-0.38, -0.2, 0.22, 0.38].map((f) => `<rect x="${60 + f * len - 3}" y="${60 - legs}" width="6" height="${legs}" rx="3" fill="${look.body}"/>`).join('')}
    <rect class="tail" x="${60 - len / 2 - 14}" y="${60 - legs - 18}" width="16" height="5" rx="2.5" fill="${look.body}"/>
  </g></svg>`;
  const span = document.createElement('span');
  span.className = 'dog-icon';
  span.innerHTML = svg;
  return span;
}

/** 1回の走行の画面（走行中の表示、指の入力、一時停止、練習の手順）。 */
class GameRun {
  readonly el: HTMLElement;
  readonly session: RunSession;
  readonly recognizer = new GestureRecognizer();
  private trails: HTMLCanvasElement;
  private hud: Record<string, HTMLElement> = {};
  private center = new CenterText();
  private recorder = new ReplayRecorder(100);
  private pilot: Autopilot | null = null;
  private coach: PracticeCoach | null = null;
  private raf = 0;
  private lastFrameMs = 0;
  private virtualWallUs = 0;
  private finishedAtMs: number | null = null;
  private destroyed = false;
  private demoStartMs = -1;
  private pauseCover: HTMLElement;
  private practicePanel: HTMLElement | null = null;

  constructor(
    private app: App,
    readonly identity: RunIdentity,
    private view: GameView,
  ) {
    this.session = new RunSession(identity, getCourse(identity.courseId), DOGS[identity.dogId]);
    this.recognizer.setViewport(window.innerWidth, window.innerHeight);
    this.trails = h('canvas', { class: 'trails', 'data-testid': 'surface' });
    const H = (k: string, el: HTMLElement) => (this.hud[k] = el);
    this.pauseCover = h(
      'div',
      { class: 'pause-cover hidden', 'data-testid': 'pause-cover' },
      h('h2', {}, '一時停止'),
      h('p', { class: 'pause-hint' }, '画面から指を離してから「再開」を押してください。'),
      h('button', { class: 'btn primary big', 'data-testid': 'resume', onclick: (e: Event) => this.resume(e) }, '再開'),
      h('button', { class: 'btn', 'data-testid': 'retire', onclick: () => this.retire() }, 'やめる'),
    );
    const isPractice = identity.mode === 'practice';
    if (isPractice) {
      this.coach = new PracticeCoach();
      this.practicePanel = h('div', { class: 'practice-panel', 'data-testid': 'practice-panel' });
    }
    this.el = h(
      'section',
      { class: 'screen game' },
      this.trails,
      h(
        'div',
        { class: 'hud' },
        h(
          'div',
          { class: 'hud-top' },
          H('time', h('span', { class: 'hud-time', 'data-testid': 'hud-time' }, isPractice ? '練習' : '0.00')),
          h('div', { class: 'progress', 'aria-label': 'ゴールまでの進み具合' }, H('progress', h('i', {}))),
          H('trick', h('span', { class: 'hud-trick', 'data-testid': 'hud-trick' }, '技 0')),
          h('button', { class: 'pause-btn', 'aria-label': '一時停止', 'data-testid': 'pause', onclick: () => this.pauseFor('manual') }, 'Ⅱ'),
        ),
        H('streak', h('div', { class: 'streak', 'aria-label': '連続成功' }, '○○○')),
        H('boost', h('div', { class: 'boost hidden' })),
        H('center', h('div', { class: 'center-text', 'data-testid': 'center-text', 'aria-live': 'polite' })),
        H('marks', h('div', { class: 'foot-marks' })),
        H('countdown', h('div', { class: 'countdown' })),
        H('debug', h('pre', { class: 'debug hidden' })),
      ),
      H('fade', h('div', { class: 'fade' })),
      this.practicePanel,
      this.pauseCover,
    );
    if (app.opts.autoplay && identity.mode === 'competition') {
      const steps = getCourse(identity.courseId).def.autoRoutes[app.opts.autoplay];
      if (steps) this.pilot = new Autopilot(steps);
    }
    if (app.opts.debug) this.hud.debug.classList.remove('hidden');
    this.bindPointers();
    this.renderPractice();
  }

  private wallUs(): number {
    return this.app.opts.autoplay ? this.virtualWallUs : nowMs() * 1000;
  }

  start(): void {
    this.lastFrameMs = nowMs();
    this.virtualWallUs = nowMs() * 1000;
    this.resizeTrails();
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
  }

  private resizeTrails(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.trails.width = Math.round(window.innerWidth * dpr);
    this.trails.height = Math.round(window.innerHeight * dpr);
  }

  private submit(facts: GestureFact[]): void {
    if (facts.length) this.session.submit(this.identity.runId, facts);
  }

  private bindPointers(): void {
    const el = this.trails;
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.app.audio.unlock();
      this.session.pointerDown(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 無視 */
      }
      const at = this.session.runClockUs(this.wallUs());
      if (at === null || this.pilot) {
        this.recognizer.ignorePointer(e.pointerId);
        return;
      }
      const [x, y] = pos(e);
      this.submit(this.recognizer.pointerDown(e.pointerId, x, y, at, nowMs()));
    });
    el.addEventListener('pointermove', (e) => {
      const at = this.session.runClockUs(this.wallUs());
      if (at === null) return;
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of list.length ? list : [e]) {
        const [x, y] = pos(ce);
        this.submit(this.recognizer.pointerMove(e.pointerId, x, y, at));
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const at = this.session.runClockUs(this.wallUs()) ?? this.session.sim.simUs;
      const [x, y] = pos(e);
      this.submit(cancelled ? this.recognizer.pointerCancel(e.pointerId, at, nowMs()) : this.recognizer.pointerUp(e.pointerId, x, y, at, nowMs()));
      this.session.pointerUp(e.pointerId, this.wallUs());
      if (!this.session.paused) this.app.sound.setPaused(false, nowMs());
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    // 画面のほかの場所（一時停止の覆いなど）で離した指も数える。
    this.pauseCover.addEventListener('pointerdown', (e) => this.session.pointerDown(e.pointerId));
    this.pauseCover.addEventListener('pointerup', (e) => this.session.pointerUp(e.pointerId, this.wallUs()));
  }

  pauseFor(reason: 'manual' | 'hidden' | 'orientation'): void {
    if (this.session.phase === 'finished' || this.destroyed) return;
    this.session.pause(reason);
    this.submit(this.recognizer.suspend(this.session.sim.simUs, nowMs()));
    this.app.sound.setPaused(true, nowMs());
    this.pauseCover.classList.remove('hidden');
    this.handleCues(this.session.update(this.wallUs()).map(cueForEvent).filter(Boolean) as Cue[]);
  }

  onVisibility(hidden: boolean): void {
    if (hidden) {
      this.pauseFor('hidden');
      this.app.audio.suspend();
    }
    this.session.setHidden(hidden, this.wallUs());
  }

  private resume(e: Event): void {
    e.preventDefault();
    this.app.audio.unlock();
    this.session.requestResume(this.wallUs());
    this.afterResumeCheck();
  }

  private afterResumeCheck(): void {
    if (!this.session.paused) {
      this.pauseCover.classList.add('hidden');
      this.app.sound.setPaused(false, nowMs());
    } else {
      // 指が離れたら進む（再開の指は使い切り、次の新しいタッチから操作を受け取る）。
      setTimeout(() => !this.destroyed && this.session.paused && this.session.resumeRequested && this.afterResumeCheck(), 120);
    }
  }

  private retire(): void {
    this.app.uiSound('back');
    this.app.showHome();
  }

  private handleCues(cues: Cue[]): void {
    const t = nowMs();
    this.center.push(cues, t);
    for (const cmd of this.app.sound.onCues(cues, t)) this.app.audio.play(cmd);
  }

  private frame(): void {
    const t = nowMs();
    const dtMs = Math.min(100, t - this.lastFrameMs);
    this.lastFrameMs = t;
    const sim = this.session.sim;
    let events: SimEvent[] = [];
    if (this.app.opts.autoplay) {
      // 検査用: 時間を速めて、細かく分けて進める。
      let remain = dtMs * 1000 * Math.max(1, this.app.opts.speed);
      while (remain > 0) {
        const step = Math.min(50_000, remain);
        remain -= step;
        this.virtualWallUs += step;
        if (this.pilot && this.session.phase === 'running' && !this.session.paused) this.submit(this.pilot.poll(sim));
        events = events.concat(this.session.update(this.virtualWallUs));
        if (this.session.phase === 'running') this.recorder.sample(sim);
      }
    } else {
      events = this.session.update(this.wallUs());
      if (this.session.phase === 'running') this.recorder.sample(sim);
    }
    const cues = events.map(cueForEvent).filter(Boolean) as Cue[];
    this.handleCues(cues);
    for (const e of events) {
      if (e.kind === 'countdown') this.flashCountdown(String(e.data?.n ?? ''));
      if (e.kind === 'start') this.flashCountdown('スタート');
    }
    if (this.coach) {
      const progressed = this.coach.observe(events, sim);
      if (progressed) {
        this.app.uiSound('stamp');
        this.renderPractice();
      } else if (this.coach.lastHint) this.renderPractice();
    }
    const renderUs = this.session.runClockUs(this.wallUs()) ?? sim.simUs;
    const loops = this.app.sound.loops(
      { mode: sim.mode, speed: sim.forwardSpeed, maxSpeed: maxSpeed(sim), downhill: sim.slopeSign < 0, paused: this.session.paused, finished: sim.finished },
      t,
    );
    this.app.audio.update(this.app.sound.master(t), loops, t);
    this.view.frame(sim, renderUs, cues, this.app.settings, t, dtMs);
    this.updateHud(renderUs, t);
    this.drawTrails(t);
    if (sim.finished && sim.result && this.finishedAtMs === null) this.finishedAtMs = t;
    if (this.finishedAtMs !== null && t - this.finishedAtMs > (this.app.opts.autoplay ? 300 : 1200)) {
      const result = sim.result!;
      const replay = this.identity.mode === 'competition' ? this.recorder.finish(sim) : null;
      this.destroy();
      this.app.finishRun(result, replay);
    }
  }

  private flashCountdown(text: string): void {
    const el = this.hud.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  private updateHud(renderUs: number, t: number): void {
    const sim = this.session.sim;
    if (this.identity.mode === 'competition') {
      const shown = sim.finished && sim.result ? sim.result.recordCs : Math.floor(renderUs / 10_000);
      this.hud.time.textContent = formatTime(shown).replace('秒', '');
    }
    this.hud.trick.textContent = `技 ${fmtInt(trickScore(sim.score))}`;
    const path = sim.course.paths.get(sim.pathId)!;
    const startU = sim.course.def.start.u;
    const prog = sim.course.goal ? Math.max(0, Math.min(1, (uAtS(path, sim.s) - startU) / sim.course.progressLength)) : 0;
    (this.hud.progress as HTMLElement).style.width = `${(prog * 100).toFixed(1)}%`;
    const st = sim.score.streak;
    this.hud.streak.textContent = '●'.repeat(st) + '○'.repeat(Math.max(0, 3 - st));
    if (foodActive(sim.effects, sim.simUs)) {
      const left = (sim.effects.foodUntilUs! - sim.simUs) / 1e6;
      this.hud.boost.classList.remove('hidden');
      this.hud.boost.replaceChildren(boneGauge(left / 5), h('span', {}, `加速 ${left.toFixed(1)}秒`));
    } else this.hud.boost.classList.add('hidden');
    const ct = this.center.current(t);
    this.hud.center.textContent = ct ?? '';
    this.hud.center.classList.toggle('show', !!ct);
    this.hud.marks.replaceChildren(...this.center.footMarks.map((f) => h('span', {}, f.text)));
    (this.hud.fade as HTMLElement).style.opacity = sim.mode === 'falling' ? '0.7' : '0';
    if (this.app.opts.debug) {
      const log = this.recognizer.debugLog.slice(-6).join('\n');
      this.hud.debug.textContent = `path=${sim.pathId} s=${sim.s.toFixed(1)} x=${sim.x.toFixed(2)} mode=${sim.mode} v=${sim.forwardSpeed.toFixed(2)}\n${log}`;
    }
  }

  private drawTrails(t: number): void {
    const c = this.trails;
    const g = c.getContext('2d');
    if (!g) return;
    const dpr = c.width / Math.max(1, window.innerWidth);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.recognizer.pruneTrails(t, 700);
    for (const tr of this.recognizer.trailViews()) {
      const alpha = tr.ended ? Math.max(0, 1 - (t - tr.endedAtMs) / 700) : 1;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = `rgba(255,255,255,${0.55 * alpha})`;
      g.beginPath();
      tr.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      if (tr.circleEnds.length) {
        g.strokeStyle = `rgba(255,170,60,${0.8 * alpha})`;
        g.beginPath();
        const end = tr.circleEnds[tr.circleEnds.length - 1];
        tr.points.slice(0, end + 1).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
      if (this.app.opts.debug && tr.label) {
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.font = '14px system-ui';
        const last = tr.points[tr.points.length - 1];
        g.fillText(tr.label, last.x + 8, last.y - 8);
      }
    }
    // 練習の手本（E22）: 指の跡をゆっくり示す。
    if (this.coach && !this.coach.done && this.demoStartMs >= 0) {
      const demo = this.coach.step.demo;
      const unit = Math.min(window.innerWidth, window.innerHeight);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const prog = ((t - this.demoStartMs) % 2200) / 1600;
      for (const pts of [demo.points, demo.second].filter(Boolean) as [number, number][][]) {
        const n = Math.max(1, Math.floor(Math.min(1, prog) * (pts.length - 1)) + 1);
        g.strokeStyle = 'rgba(255,220,80,.85)';
        g.setLineDash([10, 8]);
        g.lineWidth = 5;
        g.beginPath();
        pts.slice(0, n).forEach(([x, y], i) => (i ? g.lineTo(cx + x * unit, cy + y * unit) : g.moveTo(cx + x * unit, cy + y * unit)));
        g.stroke();
        g.setLineDash([]);
        const [lx, ly] = pts[n - 1];
        g.fillStyle = 'rgba(255,220,80,.95)';
        g.beginPath();
        g.arc(cx + lx * unit, cy + ly * unit, 12, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private renderPractice(): void {
    if (!this.practicePanel || !this.coach) return;
    const c = this.coach;
    if (c.done) {
      this.practicePanel.replaceChildren(
        h('h3', {}, '5つの手順をすべて試しました'),
        h('p', {}, 'このまま練習を続けるか、本番へ進みましょう。練習の記録は競技の記録に入りません。'),
        h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', 'data-testid': 'to-race', onclick: () => this.app.startRun('competition') }, '本番へ'), h('button', { class: 'btn', onclick: () => this.retire() }, 'やめる')),
      );
      this.demoStartMs = -1;
      return;
    }
    const st = c.step;
    this.practicePanel.replaceChildren(
      h('div', { class: 'steps' }, PRACTICE_STEPS.map((_, i) => h('span', { class: `dot${i < c.index ? ' done' : i === c.index ? ' cur' : ''}` }, String(i + 1)))),
      h('h3', { 'data-testid': 'practice-title' }, st.title),
      h('p', {}, st.hint),
      c.lastHint ? h('p', { class: 'retry-hint' }, c.lastHint) : '',
      h(
        'div',
        { class: 'row-btns' },
        h('button', { class: 'btn small', onclick: () => ((this.demoStartMs = nowMs()), this.app.uiSound('demo')) }, 'お手本'),
        h('button', { class: 'btn small', 'data-testid': 'practice-next', onclick: () => (c.next(), this.renderPractice()) }, '次へ'),
        h('button', { class: 'btn small primary', 'data-testid': 'to-race', onclick: () => this.app.startRun('competition') }, '本番へ'),
        h('button', { class: 'btn small', onclick: () => this.retire() }, 'やめる'),
      ),
    );
    this.demoStartMs = nowMs();
  }
}

function boneGauge(f: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 30');
  svg.setAttribute('width', '96');
  svg.setAttribute('height', '24');
  const clipId = `bone-${Math.random().toString(36).slice(2, 7)}`;
  svg.innerHTML = `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${Math.max(0, Math.min(1, f)) * 120}" height="30"/></clipPath></defs>
    <path d="M14 6a7 7 0 0 1 12 3h68a7 7 0 1 1 6 8 7 7 0 1 1-6 8H26a7 7 0 1 1-12-3 7 7 0 1 1 0-16z" fill="#fff8e1" stroke="#7a5a1a" stroke-width="2"/>
    <path clip-path="url(#${clipId})" d="M14 6a7 7 0 0 1 12 3h68a7 7 0 1 1 6 8 7 7 0 1 1-6 8H26a7 7 0 1 1-12-3 7 7 0 1 1 0-16z" fill="#f5a623"/>`;
  return svg;
}
