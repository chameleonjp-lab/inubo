import { DOG_EFFECT_COLORS, dogEffectStyle, type DogEffectColors } from '../content/dog-effects';
import { TrickImpact } from './trick-impact';
import { helpParagraphs, initLanguage, LANGUAGES, setLanguage, t as tx, language } from './i18n';
import { showTrickLanding, TrickNameFlow } from './trick-landing';
import { h, clear, fmtInt } from './dom';
import { renderBoard, renderResults } from './results';
import { PRACTICE_STEPS, PracticeCoach, PracticeDemo, practiceGuide, practiceRate, type PracticePoint, type PracticeStepId } from './practice';
import { TrickLabScreen } from './trick-lab';
import { formatTime, homeShareText, officialUrl, resultShareText, shareOnX, shareTextWithLink, shareableResult, xShareUrl } from './share';
import { RunSession } from '../game/run';
import { RULES_VERSION } from '../game/rules';
import { FREE_RULES_VERSION, SWITCH_FREE_RULES_VERSION, PREVIOUS_FREE_RULES_VERSION, isFreestyleVersion, type FreeTarget } from '../game/free-motion';
import { Autopilot } from '../game/autopilot';
import { trickScore } from '../game/scoring';
import { sampleAt, uAtS } from '../game/track';
import { foodActive } from '../game/items';
import { maxSpeed } from '../game/motion';
import { GestureRecognizer } from '../input/gestures';
import { FreePointerController } from '../input/free-pointer';
import { keyLabel, ROTATION_TARGETS, targetKeyFromEvent } from '../input/target-keys';
import { renderTargetKeySettings } from './target-key-settings';
import { COURSE_DEFS, getCourse } from '../content/courses/index';
import { parkFreestyle } from '../content/courses/park-freestyle';
import { DOGS, DOG_ORDER } from '../content/dogs';
import { GameView } from '../view/scene';
import { CenterText, UI_CUES, cueForEvent, type Cue } from '../view/effects';
import { FREE_REPLAY_STEP_MS, ReplayRecorder } from '../view/replay';
import { AudioEngine, SoundScheduler } from '../audio/sound';
import { Records, browserStorage, loadProfile, loadSettings, newId, saveProfile, saveSettings, type Profile, type SaveOutcome, type Settings, type StorageLike } from '../storage/records';
import { RankingClient, type BoardState, type SubmissionStatus, type Transport } from '../ranking/client';
import type { PlayOptions } from '../app-options';
import type { CourseId, DogId } from '../content/types';
import type { GestureFact, RunIdentity, RunResult, SimEvent } from '../game/types';

/**
 * 画面の流れ: ホーム（犬の選択）→ 秒読み → 走行 → 結果。一時停止・再開と、遊び方・設定。
 */

const PARK_ID = 'park';
const AIR_SWIPE_GAIN = 1.25;

function nowMs(): number {
  return performance.now();
}

function traceLayout(w: number, h: number) {
  const landscape = w > h;
  return { cx: w * (landscape ? 0.67 : 0.50), cy: h * (landscape ? 0.36 : 0.39), unit: Math.min(w, h) };
}

function drawReference(g: CanvasRenderingContext2D, points: readonly PracticePoint[], { cx, cy, unit }: ReturnType<typeof traceLayout>, faint: boolean, colors: DogEffectColors): void {
  g.beginPath();
  points.forEach(([x, y], i) => i ? g.lineTo(cx + x * unit, cy + y * unit) : g.moveTo(cx + x * unit, cy + y * unit));
  g.setLineDash([6, 6]);
  g.strokeStyle = colors.ink + (faint ? '73' : 'ff');
  g.lineWidth = 5;
  g.stroke();
  g.strokeStyle = colors.glint + (faint ? 'b3' : 'ff');
  g.lineWidth = 2.5;
  g.stroke();
  g.setLineDash([]);
  if (faint) {
    const [x, y] = points[0];
    g.beginPath();
    g.arc(cx + x * unit, cy + y * unit, 5, 0, 2 * Math.PI);
    g.stroke();
    const i = Math.min(4, points.length - 1);
    const [ax, ay] = points[i];
    const [bx, by] = points[i - 1];
    const direction = Math.atan2(ay - by, ax - bx);
    const tipX = cx + ax * unit, tipY = cy + ay * unit;
    g.beginPath();
    g.moveTo(tipX - 10 * Math.cos(direction - 0.55), tipY - 10 * Math.sin(direction - 0.55));
    g.lineTo(tipX, tipY);
    g.lineTo(tipX - 10 * Math.cos(direction + 0.55), tipY - 10 * Math.sin(direction + 0.55));
    g.stroke();
  }
}

export class App {
  private store: StorageLike;
  readonly records: Records;
  settings: Settings;
  profile: Profile;
  readonly ranking: RankingClient;
  readonly audio = new AudioEngine();
  readonly sound: SoundScheduler;
  private view: GameView | null = null;
  private canvas: HTMLCanvasElement;
  private screenEl: HTMLElement;
  game: GameRun | null = null;
  /** 練習広場から開く「技の練習」。競技の走行とは別の画面で、記録や送信には触れない。 */
  lab: TrickLabScreen | null = null;
  /** 技の練習から戻ったときに復元する、練習広場の段階（メモリーだけに持つ）。 */
  practiceMemory: { index: number; completed: PracticeStepId[] } | null = null;
  dogId: DogId;
  lastResult: RunResult | null = null;
  private updateRankingStatus: (() => void) | null = null;

  constructor(
    private root: HTMLElement,
    readonly opts: PlayOptions,
    transport: Transport | null,
  ) {
    this.store = browserStorage(opts.testBuild ? 'inubo-test:' : '');
    initLanguage(this.store);
    this.records = new Records(this.store);
    this.settings = loadSettings(this.store);
    this.profile = loadProfile(this.store);
    this.dogId = this.profile.lastDog;
    this.sound = new SoundScheduler(this.settings);
    this.ranking = new RankingClient(transport, this.store, transport !== null);
    this.canvas = h('canvas', { class: 'gl', 'aria-hidden': 'true' });
    this.screenEl = h('div', { class: 'screens' });
    root.append(this.canvas, this.screenEl);
    const unlock = () => this.audio.unlock();
    root.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('resize', () => this.onResize());
    if (this.ranking.enabled) {
      const retryPending = () => {
        if (!document.hidden && navigator.onLine && this.ranking.pendingCount() > 0) {
          void this.ranking.flush().then(() => this.updateRankingStatus?.());
        }
      };
      window.addEventListener('online', retryPending);
      document.addEventListener('visibilitychange', retryPending);
      window.setInterval(retryPending, 15_000);
    }
    document.addEventListener('visibilitychange', () => {
      // 現在の画面にだけ通知する。
      if (this.lab) this.lab.onVisibility(document.hidden);
      else this.game?.onVisibility(document.hidden);
    });
    // iPhone の Safari でページを離れるとき（アプリ切替・タブ切替）も、隠れたときと同じく一時停止する。
    window.addEventListener('pagehide', () => {
      if (this.lab) this.lab.onVisibility(true);
      else this.game?.onVisibility(true);
    });
    this.onResize();
    void this.ranking.flush();
  }

  private rankingFor(courseId: CourseId, rulesVersion = FREE_RULES_VERSION): boolean {
    return this.ranking.enabled && courseId === PARK_ID && (rulesVersion === FREE_RULES_VERSION || rulesVersion === RULES_VERSION);
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
    this.game?.setInputViewport(w, hgt);
    const portrait = hgt >= w;
    if (this.lastPortrait !== null && portrait !== this.lastPortrait) {
      if (this.lab) this.lab.onOrientationChange();
      else this.game?.pauseFor('orientation');
    }
    this.lastPortrait = portrait;
  }

  private setScreen(el: HTMLElement): void {
    this.updateRankingStatus = null;
    clear(this.screenEl);
    this.screenEl.append(el);
  }

  uiSound(name: keyof typeof UI_CUES): void {
    const c = UI_CUES[name];
    for (const cmd of this.sound.onCues([{ effect: c.effect, visual: c.visual, sound: c.sound, atUs: 0, runId: 'ui' }], nowMs())) this.audio.play(cmd);
  }

  saveProfile(): void {
    this.profile.lastDog = this.dogId;
    saveProfile(this.store, this.profile);
  }

  // ---------------------------------------------------------------- ホーム
  showHome(): void {
    this.closeTrickLab();
    this.practiceMemory = null;
    this.game?.destroy();
    this.game = null;
    this.root.classList.remove('in-game');
    const parkRecords = { courseId: PARK_ID, courseVersion: COURSE_DEFS[PARK_ID]!.version } as const;
    const records = [
      [FREE_RULES_VERSION, '公園の自己ベスト', parkFreestyle.version],
      [SWITCH_FREE_RULES_VERSION, '前の自由操作の自己ベスト', parkRecords.courseVersion],
      [PREVIOUS_FREE_RULES_VERSION, '初代の自由操作の自己ベスト', parkRecords.courseVersion],
    ].flatMap(([rulesVersion, label, courseVersion]) => {
      const key = { ...parkRecords, rulesVersion, courseVersion };
      const best = this.records.bestScore(key);
      const fast = this.records.bestTime(key);
      if (!best && !fast) return [];
      return [h('dt', {}, tx(label)), h('dd', {}, [
        best && tx('最高 {n}', { n: `${fmtInt(best.total)} ${tx('点')}` }),
        fast && tx('最速 {n}', { n: `${formatTime(fast.recordCs)}（${tx(DOGS[fast.dogId].name)}）` }),
      ].filter(Boolean).join('　'))];
    });
    const dogCards = DOG_ORDER.map((id) =>
      h(
        'button',
        {
          class: `card dog-card${id === this.dogId ? ' selected' : ''}`,
          'data-testid': `dog-${id}`,
          style: dogEffectStyle(id),
          'aria-pressed': id === this.dogId ? 'true' : 'false',
          onclick: () => {
            this.dogId = id;
            this.uiSound('select');
            this.saveProfile();
            this.showHome();
          },
        },
        dogIcon(id, id === this.dogId),
        h('span', { class: 'card-title' }, tx(DOGS[id].name)),
        h('span', { class: 'card-sub' }, tx('小回り {n}', { n: DOGS[id].handlingIndex })),
      ),
    );
    const hasRanking = this.rankingFor(PARK_ID);
    const shareFallback = h('div', { class: 'share-fallback hidden', 'data-testid': 'home-share-fallback', 'aria-live': 'polite' });
    const nameBlock = hasRanking
      ? h(
          'div',
          { class: 'name-block' },
          h('label', { for: 'player-name' }, tx('名前（任意）')),
          (() => {
            const inp = h('input', { id: 'player-name', maxlength: 16, value: this.profile.name, autocomplete: 'off', 'data-testid': 'name', 'aria-describedby': 'ranking-name-note' }) as HTMLInputElement;
            inp.addEventListener('input', () => {
              this.profile.name = inp.value.slice(0, 16);
              this.saveProfile();
            });
            return inp;
          })(),
          h('p', { id: 'ranking-name-note' }, tx('名前を入れてスタートすると、完走時に名前と記録がランキングに公開されます。')),
        )
      : null;
    this.setScreen(
      h(
        'section',
        { class: 'screen home', 'data-testid': 'home' },
        this.languagePicker(),
        h('h1', { class: 'logo' }, tx('イヌボー'), h('small', {}, tx('犬のスケボー'))),
        h('h2', {}, tx('犬')),
        h('div', { class: 'cards' }, dogCards),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary big', 'data-testid': 'start', onclick: () => (this.uiSound('decide'), this.startRun('competition')) }, tx('スタート')),
        ),
        nameBlock,
        h(
          'div',
          { class: 'actions small-row' },
          h('button', { class: 'btn small', onclick: () => this.showHowTo() }, tx('遊び方')),
          h('button', { class: 'btn small', 'data-testid': 'settings', onclick: () => this.showSettings() }, tx('設定')),
          hasRanking ? h('button', { class: 'btn small', onclick: () => this.showRanking() }, tx('ランキング')) : null,
          h('button', { class: 'btn small x-share', onclick: () => void this.share(homeShareText(null), shareFallback) }, tx('Xでシェア')),
        ),
        shareFallback,
        records.length ? h('dl', { class: 'home-records', 'aria-label': tx('自己ベスト'), 'data-testid': 'home-records' }, records) : null,
      ),
    );
  }

  private languagePicker(): HTMLElement {
    const select = h('select', { 'aria-label': tx('言語'), 'data-testid': 'language' },
      LANGUAGES.map(([id, label]) => h('option', { value: id, lang: id }, label)));
    select.value = language();
    select.addEventListener('change', () => {
      const next = LANGUAGES.find(([id]) => id === select.value);
      if (!next) return;
      setLanguage(next[0]);
      // 明示的なURL指定が、利用者自身の選択を次の読み込みで上書きしないようにする。
      const url = new URL(window.location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.set('lang', next[0]);
        window.history.replaceState(null, '', url);
      }
      this.showHome();
      this.root.querySelector<HTMLElement>('[data-testid="language"]')?.focus();
    });
    return h('label', { class: 'home-language' }, h('span', { 'aria-hidden': 'true' }, '🌐'), select);
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
        h('h2', {}, tx('遊び方')),
        h('p', {}, tx(helpParagraphs[0])),
        h('ul', {}, helpParagraphs.slice(1, 5).map(key => h('li', {}, tx(key)))),
        ...helpParagraphs.slice(5).map(key => h('p', {}, tx(key))),
        h('p', {}, tx('PCではマウスの左ボタンを押しながらドラッグします。A・S・Dで回す対象を切り替えられます。キーは設定で変更できます。')),
        h('button', { class: 'btn', onclick: () => this.back() }, tx('もどる')),
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
    const vol = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(s.volume * 100), 'data-testid': 'volume', 'aria-label': tx('音量') }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value) / 100;
      apply();
    });
    const light = h('select', { 'data-testid': 'light', 'aria-label': tx('光の量') }, h('option', { value: 'normal' }, tx('ふつう')), h('option', { value: 'weak' }, tx('弱い'))) as HTMLSelectElement;
    light.value = s.light;
    light.addEventListener('change', () => {
      this.settings.light = light.value === 'weak' ? 'weak' : 'normal';
      apply();
    });
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, tx('設定')),
        toggle(tx('音を出す'), () => this.settings.soundOn, (v) => (this.settings.soundOn = v), 'sound'),
        h('label', { class: 'setting' }, tx('音量'), vol),
        toggle(tx('画面を揺らす'), () => this.settings.shake, (v) => (this.settings.shake = v), 'shake'),
        h('label', { class: 'setting' }, tx('光の量'), light),
        toggle(tx('自分の最速の走りを半透明で表示する'), () => this.settings.ghost, (v) => (this.settings.ghost = v), 'ghost'),
        renderTargetKeySettings(s, apply),
        h('p', { class: 'note' }, tx('設定は成績に影響しません。')),
        h('button', { class: 'btn', onclick: () => this.back() }, tx('もどる')),
      ),
    );
  }

  showRanking(): void {
    const def = parkFreestyle;
    const board = h('div', { class: 'board' });
    let boardRequest = 0;
    const load = (metric: 'total' | 'time') => {
      const current = ++boardRequest;
      void this.ranking.loadBoard({ courseId: PARK_ID, courseVersion: def.version, rulesVersion: FREE_RULES_VERSION, metric }, (s) => {
        if (current === boardRequest) renderBoardInto(board, s, metric, () => load(metric));
      });
    };
    this.setScreen(
      h(
        'section',
        { class: 'screen text-screen' },
        h('h2', {}, `${tx('ランキング')}｜${tx(def.name)}`),
        h('div', { class: 'ranking-tabs' }, h('button', { class: 'btn small', onclick: () => load('total') }, tx('総合')), h('button', { class: 'btn small', onclick: () => load('time') }, tx('タイム'))),
        board,
        h('button', { class: 'btn', onclick: () => this.back() }, tx('もどる')),
      ),
    );
    load('total');
  }

  async share(text: string, fallbackEl: HTMLElement | null): Promise<void> {
    const url = xShareUrl(officialUrl());
    const res = await shareOnX(text, {
      open: (u) => {
        const w = window.open(u, '_blank');
        if (w) w.opener = null;
        return w;
      },
      copy: (t) => navigator.clipboard.writeText(t),
    }, url);
    if (res === 'opened' || !fallbackEl) return;
    fallbackEl.classList.remove('hidden');
    fallbackEl.replaceChildren(
      h('p', {}, language() === 'ja' ? (res === 'copied' ? '投稿画面を開けなかったので、同じ文をコピーしました。' : '投稿画面を開けませんでした。次の文を写して使ってください。') : tx('投稿用の文章')),
      h('textarea', { readonly: true, rows: 4, 'data-testid': 'share-text' }, shareTextWithLink(text, url)),
    );
  }

  // ---------------------------------------------------------------- 走行
  startRun(mode: 'competition' | 'practice', rulesVersion = FREE_RULES_VERSION): void {
    this.closeTrickLab();
    if (mode === 'competition') this.practiceMemory = null;
    this.game?.destroy();
    this.game = null;
    const courseId: CourseId = mode === 'practice' ? 'practice' : PARK_ID;
    const course = getCourse(courseId, rulesVersion === FREE_RULES_VERSION ? parkFreestyle.version : undefined);
    const name = this.profile.name.trim();
    const opt = this.rankingFor(courseId, rulesVersion) && this.ranking.canParticipate(name, mode, true);
    const identity: RunIdentity = {
      runId: newId(),
      courseId,
      courseVersion: course.def.version,
      rulesVersion,
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
    const key = { courseId, courseVersion: course.def.version, rulesVersion };
    const ghost = mode === 'competition' ? this.records.bestTimeReplay(key) : null;
    view.setGhost(ghost, ghost ? DOGS[ghost.dogId].look : null);
    view.resetEffects();
    this.root.classList.add('in-game');
    this.game = new GameRun(this, identity, view);
    this.setScreen(this.game.el);
    this.game.start();
  }

  // ---------------------------------------------------------------- 技の練習
  /**
   * 練習広場から「技の練習」を開く。競技の走行（startRun・finishRun）とは別の経路で、
   * 走行番号・自己ベスト・スタンプ・送信待ちを作らない。
   */
  startTrickLab(memory: { index: number; completed: PracticeStepId[] } | null): void {
    this.practiceMemory = memory;
    // 旧画面の描画予約・入力・音を終えてから新しい画面を始める。
    this.game?.destroy();
    this.game = null;
    this.closeTrickLab();
    this.sound.setPaused(false, nowMs());
    const view = this.ensureView();
    const lab = new TrickLabScreen({
      view,
      dogId: this.dogId,
      look: DOGS[this.dogId].look,
      clothes: this.profile.clothes,
      helmet: this.profile.helmet,
      uiSound: (name) => this.uiSound(name),
      exit: () => this.startRun('practice', memory ? RULES_VERSION : FREE_RULES_VERSION),
    });
    this.lab = lab;
    this.root.classList.add('in-game');
    this.setScreen(lab.el);
    lab.start();
  }

  private closeTrickLab(): void {
    if (!this.lab) return;
    this.lab.destroy();
    this.lab = null;
  }

  finishRun(result: RunResult, replay: ReturnType<ReplayRecorder['finish']> | null): void {
    this.lastResult = result;
    const saved: SaveOutcome = this.records.saveLocalResult(result, replay);
    this.ranking.finishRun(result);
    const sent = this.ranking.flush();
    const def = getCourse(result.courseId, result.courseVersion).def;
    const fallbackHolder: { el: HTMLElement | null } = { el: null };
    const el = renderResults(result, def.name, saved, def.challenge?.label ?? null, {
      retry: () => {
        this.uiSound('retry');
        this.startRun('competition', result.rulesVersion);
      },
      home: () => this.back(),
      share: () => {
        if (!shareableResult(result)) return;
        void this.share(resultShareText(result, def.name, DOGS[result.dogId].name, null), fallbackHolder.el);
      },
      ranking: this.rankingFor(result.courseId, result.rulesVersion)
        ? (metric, onState) => {
            onState({ kind: 'loading' });
            void sent.then(() => this.ranking.loadBoard({ courseId: result.courseId, courseVersion: result.courseVersion, rulesVersion: result.rulesVersion, metric }, onState));
          }
        : null,
    });
    fallbackHolder.el = el.querySelector('[data-testid="share-fallback"]');
    this.root.classList.remove('in-game');
    this.setScreen(el);
    const status = el.querySelector<HTMLElement>('.ranking-status')!;
    if (this.ranking.submissionStatus(result.runId) !== 'idle') {
      let previous: SubmissionStatus = 'idle';
      this.updateRankingStatus = () => {
        const state = this.ranking.submissionStatus(result.runId);
        if (state === previous) return;
        previous = state;
        status.textContent = state === 'accepted' ? tx('ランキングに登録しました。')
          : state === 'rejected' ? tx('この走行はランキングに登録できませんでした。')
          : tx('集計中…');
        if (state === 'accepted') el.querySelector('[data-testid="board"]')?.dispatchEvent(new Event('ranking-updated'));
      };
      this.updateRankingStatus();
      void sent.then(() => { if (status.isConnected) this.updateRankingStatus?.(); });
    }
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
  readonly recognizer: GestureRecognizer;
  private readonly freePointer: FreePointerController | null;
  private readonly freePractice: boolean;
  private readonly freeStrokes = new Map<number, { id: number; atUs: number }>();
  private shownLanding: CenterText['landingText'];
  private readonly trickNames: TrickNameFlow | null;
  private freeTarget: FreeTarget = 'common';
  private readonly targetButtons = new Map<FreeTarget, HTMLButtonElement>();
  private trails: HTMLCanvasElement;
  private impact: TrickImpact | null = null;
  private readonly colors: DogEffectColors;
  private hud: Record<string, HTMLElement> = {};
  private center = new CenterText();
  private readonly recorder: ReplayRecorder;
  private pilot: Autopilot | null = null;
  private coach: PracticeCoach | null = null;
  private raf = 0;
  private lastFrameMs = 0;
  private virtualWallUs = 0;
  private finishedAtMs: number | null = null;
  private destroyed = false;
  private practiceDemo: PracticeDemo | null = null;
  private demoButton: HTMLButtonElement | null = null;
  private demoStatus: HTMLElement | null = null;
  private demoFinished = false;
  private demoReducedMotion: MediaQueryList | null = null;
  private pauseCover: HTMLElement;
  private practicePanel: HTMLElement | null = null;
  private wasSteering = false;
  private wasSharp = false;

  constructor(
    private app: App,
    readonly identity: RunIdentity,
    private view: GameView,
  ) {
    this.colors = DOG_EFFECT_COLORS[identity.dogId];
    const freestyle = isFreestyleVersion(identity.rulesVersion);
    this.trickNames = freestyle ? new TrickNameFlow() : null;
    this.freePractice = freestyle && identity.mode === 'practice';
    this.recognizer = new GestureRecognizer({}, 1, !freestyle);
    this.freePointer = freestyle ? new FreePointerController(undefined, true, false) : null;
    this.recorder = new ReplayRecorder(freestyle ? FREE_REPLAY_STEP_MS : 100, () => this.freeTarget);
    this.session = new RunSession(identity, getCourse(identity.courseId, identity.courseVersion), DOGS[identity.dogId],
      identity.mode === 'competition' ? state => this.recorder.sample(state) : undefined);
    this.setInputViewport(window.innerWidth, window.innerHeight);
    this.trails = h('canvas', { class: 'trails', 'data-testid': 'surface', tabindex: -1 });
    const impactCanvas = identity.rulesVersion === FREE_RULES_VERSION
      ? h('canvas', { class: 'trick-impact', 'aria-hidden': 'true', 'data-testid': 'trick-impact' }) : null;
    if (impactCanvas) this.impact = new TrickImpact(impactCanvas, this.colors);
    const H = (k: string, el: HTMLElement) => (this.hud[k] = el);
    this.pauseCover = h(
      'div',
      { class: 'pause-cover hidden', 'data-testid': 'pause-cover' },
      h('h2', {}, tx('一時停止')),
      h('p', { class: 'pause-hint' }, tx('指を離してから再開を押してください。')),
      h('button', { class: 'btn primary big', 'data-testid': 'resume', onclick: (e: Event) => this.resume(e) }, tx('再開')),
      h('button', { class: 'btn', 'data-testid': 'retire', onclick: () => this.retire() }, tx('やめる')),
    );
    const isPractice = identity.mode === 'practice';
    if (isPractice && !freestyle) {
      this.coach = new PracticeCoach();
      const memory = app.practiceMemory;
      if (memory) {
        this.coach.index = memory.index;
        this.coach.completed = [...memory.completed];
        app.practiceMemory = null;
      }
      this.practicePanel = h('div', { class: 'practice-panel', 'data-testid': 'practice-panel' });
      this.demoReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    }
    this.el = h(
      'section',
      { class: 'screen game', style: dogEffectStyle(identity.dogId) },
      impactCanvas,
      this.trails,
      h(
        'div',
        { class: 'hud' },
        h(
          'div',
          { class: 'hud-top' },
          H('time', h('span', { class: 'hud-time', 'data-testid': 'hud-time' }, isPractice ? tx('練習') : '0.00')),
          h('div', { class: 'progress', 'aria-label': tx('ゴールまでの進み具合') }, H('progress', h('i', {}))),
          H('trick', h('span', { class: 'hud-trick', 'data-testid': 'hud-trick' }, `${tx('技')} 0`)),
          h('button', { class: 'pause-btn', 'aria-label': tx('一時停止'), 'data-testid': 'pause', onclick: () => this.pauseFor('manual') }, 'Ⅱ'),
        ),
        H('streak', h('div', { class: 'streak', 'aria-label': tx('連続成功') }, '○○○')),
        H('boost', h('div', { class: 'boost hidden' })),
        this.trickNames?.element,
        H('center', h('div', { class: 'center-text', 'data-testid': 'center-text', 'aria-live': 'polite' })),
        H('marks', h('div', { class: 'foot-marks' })),
        H('countdown', h('div', { class: 'countdown' })),
        H('debug', h('pre', { class: 'debug hidden' })),
      ),
      H('fade', h('div', { class: 'fade' })),
      freestyle ? this.freeControls() : null,
      this.practicePanel,
      this.pauseCover,
    );
    if (app.opts.autoplay && identity.mode === 'competition') {
      const steps = getCourse(identity.courseId, identity.courseVersion).def.autoRoutes[app.opts.autoplay];
      if (steps) this.pilot = new Autopilot(steps);
    }
    if (app.opts.debug) this.hud.debug.classList.remove('hidden');
    this.bindPointers();
    if (freestyle) window.addEventListener('keydown', this.handleTargetKey);
    this.renderPractice();
  }

  private wallUs(): number {
    return this.app.opts.autoplay || this.coach || this.freePractice ? this.virtualWallUs : nowMs() * 1000;
  }

  setInputViewport(width: number, height: number): void {
    this.trickNames?.resize();
    this.recognizer.setViewport(width, height);
    this.freePointer?.setSurface(width, height);
  }

  private freeControls(): HTMLElement {
    const targets = h('div', { class: 'free-run-targets', role: 'group', 'aria-label': tx('空中で回す対象') });
    for (const [target, label] of ROTATION_TARGETS) {
      const key = keyLabel(this.app.settings.targetKeys[target]);
      const select = () => this.selectFreeTarget(target);
      const button = h('button', {
        type: 'button', 'aria-pressed': String(target === this.freeTarget), 'data-testid': `run-target-${target}`,
        'aria-keyshortcuts': key === '+' ? 'Plus' : key,
        onpointerdown: event => { if ((event as PointerEvent).button === 0) select(); },
        // 指を離す時の click で、別の指が選んだ新しい対象を上書きしない。
        onclick: event => { if ((event as MouseEvent).detail === 0) select(); },
      }, tx(label), h('kbd', { class: 'run-target-key', 'aria-hidden': 'true', 'data-key-label': key }));
      this.targetButtons.set(target, button);
      targets.append(button);
    }
    this.hud.freeStatus = h('p', { class: 'free-run-hint' });
    return h('div', { class: 'free-run-controls', 'data-testid': 'free-run-controls' }, this.hud.freeStatus, targets,
      this.freePractice ? h('div', { class: 'free-run-lessons' },
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'legacy-practice', onclick: () => this.app.startRun('practice', RULES_VERSION) }, '基本操作のお手本'),
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'free-trick-guide', onclick: () => this.app.startTrickLab(null) }, '38技のお手本'),
      ) : null);
  }

  private selectFreeTarget(target: FreeTarget): void {
    if (this.freeTarget === target) return;
    this.freeTarget = target;
    this.freePointer?.retargetAll(target);
    for (const [id, button] of this.targetButtons) button.setAttribute('aria-pressed', String(id === target));
  }

  private readonly handleTargetKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || this.session.paused || this.session.phase === 'finished') return;
    const focused = event.target instanceof HTMLElement ? event.target : null;
    if (focused?.closest('input, textarea, select, [contenteditable]')) return;
    if ((event.key === 'Enter' || event.key === ' ') && focused?.closest('button, a[href]')) return;
    const key = targetKeyFromEvent(event);
    if (!key) return;
    const binding = ROTATION_TARGETS.find(([target]) => this.app.settings.targetKeys[target] === key);
    if (!binding) return;
    event.preventDefault();
    this.selectFreeTarget(binding[0]);
  };

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
    window.removeEventListener('keydown', this.handleTargetKey);
    cancelAnimationFrame(this.raf);
    this.trickNames?.clear();
    this.app.audio.stopTrickLanding();
    this.app.audio.stopRaceMusic();
    this.stopPracticeDemo(false);
    this.freePointer?.clear();
    this.freeStrokes.clear();
    if (this.session.paused) this.app.sound.setPaused(false, nowMs());
  }

  private resizeTrails(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.trails.width !== w) this.trails.width = w;
    if (this.trails.height !== h) this.trails.height = h;
  }

  private submit(facts: GestureFact[]): void {
    if (facts.length) this.session.submit(this.identity.runId, facts);
  }

  private bindPointers(): void {
    const el = this.trails;
    const sampleTime = (e: PointerEvent, at: number, now: number) => {
      const stroke = this.freeStrokes.get(e.pointerId);
      if (!stroke) return at;
      const lag = Math.max(0, Math.min(100, now - e.timeStamp));
      const atUs = Math.max(stroke.atUs, this.session.sim.simUs, Math.round(at - lag * (this.freePractice ? 500 : 1000)));
      stroke.atUs = atUs;
      return atUs;
    };
    const queueMovement = (id: number, x: number, y: number, atUs: number, facts: GestureFact[]) => {
      const stroke = this.freeStrokes.get(id);
      if (!stroke || !this.freePointer) { this.submit(facts); return; }
      // 踏切と直後の回転が一緒に届いても、その順で計算する。
      if (!this.session.sim.freeFlight && facts.some(fact => fact.kind === 'forward')) {
        this.freePointer.recenter(id, x, y);
        this.submit(facts);
        return;
      }
      const inputs = this.freePointer.move(id, x, y, atUs);
      if (inputs.length) {
        const rotation: [number, number, number] = [0, 0, 0];
        for (const input of inputs) {
          for (const axis of [0, 1, 2] as const) rotation[axis] += input.rotation[axis] * AIR_SWIPE_GAIN;
        }
        const { seq, target } = inputs[inputs.length - 1];
        // 離す直前の移動も、その指を閉じる前に回転へ渡す。
        const insertAt = facts.at(-1)?.kind === 'up' ? facts.length - 1 : facts.length;
        facts.splice(insertAt, 0, { kind: 'freeRotate', atUs, strokeId: stroke.id, seq, rotation, target });
      }
      this.submit(facts);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (this.practiceDemo) return;
      if (e.pointerType === 'mouse') el.focus({ preventScroll: true });
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
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const [fact] = this.recognizer.pointerDown(e.pointerId, x, y, at, nowMs());
      if (this.freePointer?.down(e.pointerId, x, y, this.freeTarget)) {
        this.freeStrokes.set(e.pointerId, { id: fact.strokeId, atUs: at });
        fact.freeTarget = this.freeTarget;
      }
      this.submit([fact]);
    });
    el.addEventListener('pointermove', (e) => {
      const at = this.session.runClockUs(this.wallUs());
      if (at === null) return;
      const now = nowMs();
      const list = e.getCoalescedEvents?.() ?? [];
      const last = list[list.length - 1];
      if (!last || last.clientX !== e.clientX || last.clientY !== e.clientY) list.push(e);
      const rect = el.getBoundingClientRect();
      for (const ce of list) {
        const x = ce.clientX - rect.left, y = ce.clientY - rect.top;
        const atUs = sampleTime(ce, at, now);
        queueMovement(e.pointerId, x, y, atUs, this.recognizer.pointerMove(e.pointerId, x, y, atUs));
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const clock = this.session.runClockUs(this.wallUs());
      const at = clock ?? this.session.sim.simUs;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const now = nowMs();
      if (cancelled || clock === null) this.submit(this.recognizer.pointerCancel(e.pointerId, at, now));
      else {
        const atUs = sampleTime(e, at, now);
        queueMovement(e.pointerId, x, y, atUs, this.recognizer.pointerUp(e.pointerId, x, y, atUs, now));
      }
      this.freePointer?.up(e.pointerId);
      this.freeStrokes.delete(e.pointerId);
      this.session.pointerUp(e.pointerId, this.wallUs());
      if (!this.session.paused) this.app.sound.setPaused(false, nowMs());
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('lostpointercapture', (e) => end(e, true));
    // 画面のほかの場所（一時停止の覆いなど）で離した指も数える。
    this.pauseCover.addEventListener('pointerdown', (e) => this.session.pointerDown(e.pointerId));
    this.pauseCover.addEventListener('pointerup', (e) => this.session.pointerUp(e.pointerId, this.wallUs()));
    this.pauseCover.addEventListener('pointercancel', (e) => this.session.pointerUp(e.pointerId, this.wallUs()));
  }

  pauseFor(reason: 'manual' | 'hidden' | 'orientation'): void {
    if (this.session.phase === 'finished' || this.destroyed) return;
    if (this.practiceDemo) {
      this.stopPracticeDemo(false);
    }
    this.session.pause(reason);
    this.center.setPaused(true, nowMs());
    this.trickNames?.setPaused(true);
    this.app.audio.stopTrickLanding();
    this.app.audio.stopRaceMusic(false);
    this.freePointer?.clear();
    this.freeStrokes.clear();
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
      this.center.setPaused(false, nowMs());
      this.trickNames?.setPaused(false);
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
    for (const cue of cues) if (cue.landingText) this.trickNames?.push(cue.landingText, cue.trickTier ?? 1);
    this.center.push(cues, t);
    for (const cmd of this.app.sound.onCues(cues, t)) this.app.audio.play(cmd);
  }

  private frame(): void {
    const t = nowMs();
    const dtMs = Math.min(100, t - this.lastFrameMs);
    this.lastFrameMs = t;
    if (this.practiceDemo) {
      this.renderDemoFrame(this.practiceDemo, t, dtMs);
      return;
    }
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
      }
    } else {
      if (this.coach || this.freePractice) {
        const rate = this.session.phase !== 'running' ? 1 : this.freePractice ? 0.5 :
          this.coach!.done ? 1 : practiceRate(this.coach!.step.id);
        this.virtualWallUs += dtMs * 1000 * rate;
      }
      events = this.session.update(this.wallUs());
    }
    const cues = events.map(cueForEvent).filter(Boolean) as Cue[];
    // 左右移動の踏み替えと、強いカーブのすれ音（E04）は、計算の状態の変わり目から出す。
    const moving = sim.lateralSpeed !== 0 && sim.mode === 'ground';
    if (moving && !this.wasSteering) cues.push({ effect: 'E04', visual: 'weightShift', sound: 'stepSwitch', atUs: sim.simUs, runId: sim.id.runId });
    this.wasSteering = moving;
    const kappa = Math.abs(sampleAt(sim.course.paths.get(sim.pathId)!, sim.s).kappa);
    const sharp = kappa > 0.025 && sim.forwardSpeed > 5 && sim.mode === 'ground';
    if (sharp && !this.wasSharp) cues.push({ effect: 'E04', visual: 'leanSand', sound: 'skid', atUs: sim.simUs, runId: sim.id.runId });
    this.wasSharp = sharp;
    this.handleCues(cues);
    for (const e of events) {
      if (e.kind === 'countdown') this.flashCountdown(String(e.data?.n ?? ''));
      if (e.kind === 'start') this.flashCountdown(tx('スタート'));
    }
    if (this.coach) {
      const lastHint = this.coach.lastHint;
      const progressed = this.coach.observe(events, sim);
      if (progressed) {
        this.demoFinished = false;
        this.app.uiSound('stamp');
        this.renderPractice();
      } else if (lastHint !== this.coach.lastHint) this.renderPractice();
    }
    const renderUs = this.session.runClockUs(this.wallUs()) ?? sim.simUs;
    const loops = this.app.sound.loops(
      { mode: sim.mode, speed: sim.forwardSpeed, maxSpeed: maxSpeed(sim), downhill: sim.slopeSign < 0, paused: this.session.paused, finished: sim.finished },
      t,
    );
    this.app.audio.update(this.app.sound.master(t), loops, t, this.session.phase === 'running' && !this.session.paused && !sim.finished);
    this.view.setFxSelectedTarget(this.freeTarget);
    this.view.setFxPaused(this.session.paused);
    this.view.frame(sim, renderUs, cues, this.app.settings, t, dtMs);
    if (this.impact) {
      for (const event of events) {
        if (event.kind !== 'land' || event.data?.plain) continue;
        const landing = cueForEvent(event)?.landingText;
        if (landing?.fxTarget) this.impact.landAt(landing.fxTarget, landing.landingLevel,
          this.view.projectTrack(event.pathId, event.sMm / 1000, event.x, event.y));
      }
      const air = this.view.airImpact(sim);
      const pivot = air ? this.view.projectTrack(sim.pathId, sim.s, sim.x, sim.y + 0.9) : { x: 0.5, y: 0.5 };
      this.impact.frame(window.innerWidth, window.innerHeight, this.session.paused ? 0 : dtMs,
        this.app.settings.light === 'weak', air, pivot);
    }
    // 連携が実際に成立した瞬間だけ、足元に短く「連携」を出す（ボタンの連打では出ない）。
    if (this.view.takeFxCombo()) this.center.footMarks.push({ text: tx('連携'), untilMs: t + 700 });
    if (this.hud.freeStatus) {
      const text = tx(sim.freeFlight ? '画面をなぞって回る。反対へ払うと減速' : '上へ払ってジャンプ。指を離さずそのまま回転できます');
      if (this.hud.freeStatus.textContent !== text) this.hud.freeStatus.textContent = text;
    }
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
      this.hud.time.textContent = formatTime(shown, false);
    }
    this.hud.trick.textContent = `${tx('技')} ${fmtInt(trickScore(sim.score, sim.id.rulesVersion))}`;
    const path = sim.course.paths.get(sim.pathId)!;
    const startU = sim.course.def.start.u;
    const prog = sim.course.goal ? Math.max(0, Math.min(1, (uAtS(path, sim.s) - startU) / sim.course.progressLength)) : 0;
    (this.hud.progress as HTMLElement).style.width = `${(prog * 100).toFixed(1)}%`;
    const st = sim.score.streak;
    this.hud.streak.textContent = '●'.repeat(st) + '○'.repeat(Math.max(0, 3 - st));
    const boost = (label: string, until: number) => {
      const left = (until - sim.simUs) / 1e6;
      return h('div', { class: 'boost-line' }, boneGauge(left / 5), h('span', {}, `${tx(label)} ${left.toFixed(1)}${tx('秒')}`));
    };
    const boosts: HTMLElement[] = [];
    if (foodActive(sim.effects, sim.simUs)) boosts.push(boost('加速', sim.effects.foodUntilUs!));
    const jumpUntilUs = sim.effects.jumpUntilUs;
    if (jumpUntilUs !== null && jumpUntilUs > sim.simUs) boosts.push(boost('ジャンプ力1.3倍', jumpUntilUs));
    this.hud.boost.classList.toggle('hidden', boosts.length === 0);
    this.hud.boost.replaceChildren(...boosts);
    const ct = this.center.current(t);
    const landing = ct ? this.center.landingText : undefined;
    const center = this.hud.center;
    if (landing && this.shownLanding !== landing) showTrickLanding(center, landing, !this.trickNames);
    if (!landing && center.textContent !== (ct ?? '')) center.textContent = ct ?? '';
    this.shownLanding = landing;
    center.dataset.trickTier = ct ? String(this.center.trickTier) : '0';
    center.dataset.paused = String(this.session.paused);
    center.classList.toggle('show', !!ct);
    this.hud.marks.replaceChildren(...this.center.footMarks.map((f) => h('span', {}, f.text)));
    (this.hud.fade as HTMLElement).style.opacity = sim.mode === 'falling' ? '0.7' : '0';
    if (this.app.opts.debug) {
      const log = this.recognizer.debugLog.slice(-6).join('\n');
      this.hud.debug.textContent = `path=${sim.pathId} s=${sim.s.toFixed(1)} x=${sim.x.toFixed(2)} mode=${sim.mode} v=${sim.forwardSpeed.toFixed(2)}\n${log}`;
    }
  }

  private drawTrails(t: number): void {
    this.resizeTrails();
    const c = this.trails;
    const g = c.getContext('2d');
    if (!g) return;
    const dpr = c.width / Math.max(1, window.innerWidth);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (this.coach && !this.coach.done && !this.session.paused) {
      const layout = traceLayout(window.innerWidth, window.innerHeight);
      g.lineCap = g.lineJoin = 'round';
      for (const stroke of practiceGuide(this.coach.step.id, this.session.sim.mode === 'air')) drawReference(g, stroke.points, layout, true, this.colors);
    }
    g.save();
    this.recognizer.pruneTrails(t, 700);
    for (const tr of this.recognizer.trailViews()) {
      const alpha = tr.ended ? Math.max(0, 1 - (t - tr.endedAtMs) / 700) : 1;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = this.colors.glint;
      g.globalAlpha = 0.55 * alpha;
      g.beginPath();
      tr.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      if (tr.circleEnds.length) {
        g.strokeStyle = this.colors.main;
        g.globalAlpha = 0.8 * alpha;
        g.beginPath();
        const end = tr.circleEnds[tr.circleEnds.length - 1];
        tr.points.slice(0, end + 1).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
      g.globalAlpha = 1;
      if (this.app.opts.debug && tr.label) {
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.font = '14px system-ui';
        const last = tr.points[tr.points.length - 1];
        g.fillText(tr.label, last.x + 8, last.y - 8);
      }
    }
    g.restore();
  }

  private startPracticeDemo(): void {
    if (!this.coach || this.coach.done || this.session.paused || this.session.pointersDown > 0) return;
    this.demoFinished = false;
    const { course, dog } = this.session.sim;
    this.practiceDemo = new PracticeDemo(this.coach.step.id, this.identity, course, dog);
    this.el.classList.add('practice-demo-playing');
    this.app.uiSound('demo');
    this.session.pause('manual');
    this.submit(this.recognizer.suspend(this.session.sim.simUs, nowMs()));
    this.app.sound.setPaused(true, nowMs());
    this.view.resetEffects();
    this.syncDemoControls();
  }

  private stopPracticeDemo(resume: boolean): void {
    if (!this.practiceDemo) return;
    this.practiceDemo = null;
    this.el.classList.remove('practice-demo-playing');
    this.view.resetEffects();
    this.syncDemoControls();
    if (!resume) return;
    this.session.requestResume(this.wallUs());
    if (!this.session.paused) this.app.sound.setPaused(false, nowMs());
  }

  private syncDemoControls(): void {
    if (this.demoButton) this.demoButton.textContent = this.practiceDemo ? 'お手本を止める' : 'お手本を見る';
    const message = this.practiceDemo?.status ?? (this.demoFinished ? 'お手本のあと、自分の指で試してみましょう。' : '');
    if (this.demoStatus && this.demoStatus.textContent !== message) this.demoStatus.textContent = message;
  }

  private renderDemoFrame(demo: PracticeDemo, t: number, dtMs: number): void {
    const cues = demo.advanceTo(demo.elapsedUs + dtMs * 1000 * practiceRate(demo.step)).map(cueForEvent).filter(Boolean) as Cue[];
    const reduced = this.demoReducedMotion?.matches ?? false;
    this.app.audio.update(0, { steps: null, wind: null, grind: null }, t);
    this.view.setFxPaused(false);
    this.view.frame(demo.state, demo.elapsedUs, reduced ? [] : cues, { ...this.app.settings, shake: false }, t, dtMs);
    if (this.demoStatus && this.demoStatus.textContent !== demo.status) this.demoStatus.textContent = demo.status;
    this.drawDemoTraces(demo, reduced);
    if (demo.done) {
      this.demoFinished = true;
      this.stopPracticeDemo(true);
    }
  }

  private drawDemoTraces(demo: PracticeDemo, reduced: boolean): void {
    this.resizeTrails();
    const g = this.trails.getContext('2d');
    if (!g) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = this.trails.width / Math.max(1, w);
    const layout = traceLayout(w, h);
    const { cx, cy, unit } = layout;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = g.lineJoin = 'round';
    for (const { points, progress } of demo.traces) {
      drawReference(g, points, layout, false, this.colors);

      const n = points.length - 1;
      const pos = n * (reduced && progress > 0 ? 1 : progress);
      const i = Math.floor(pos);
      const [x, y] = points[i];
      const [x2, y2] = points[Math.min(i + 1, n)];
      const endX = cx + (x + (x2 - x) * (pos - i)) * unit;
      const endY = cy + (y + (y2 - y) * (pos - i)) * unit;
      if (progress > 0) {
        g.beginPath();
        points.slice(0, i + 1).forEach(([px, py], j) => j ? g.lineTo(cx + px * unit, cy + py * unit) : g.moveTo(cx + px * unit, cy + py * unit));
        g.lineTo(endX, endY);
        g.strokeStyle = this.colors.ink;
        g.lineWidth = 8;
        g.stroke();
        g.strokeStyle = this.colors.partner;
        g.lineWidth = 5;
        g.stroke();
      }
      if (!reduced && progress < 1) {
        g.beginPath();
        g.arc(endX, endY, 8, 0, 2 * Math.PI);
        g.fillStyle = this.colors.partner;
        g.fill();
        g.strokeStyle = this.colors.ink;
        g.lineWidth = 2;
        g.stroke();
      }
    }
  }

  /** 練習広場の各段階と完了画面から「技の練習」を開く。 */
  private trickLabButton(): HTMLButtonElement {
    return h('button', { class: 'btn small', 'data-testid': 'trick-lab', onclick: () => {
      const c = this.coach!;
      this.app.uiSound('decide');
      this.app.startTrickLab({ index: c.index, completed: [...c.completed] });
    } }, '技の練習');
  }

  private renderPractice(): void {
    if (!this.practicePanel || !this.coach) return;
    const c = this.coach;
    if (c.done) {
      this.demoButton = null;
      this.demoStatus = null;
      this.practicePanel.replaceChildren(
        h('h3', {}, '練習の手順はここまで'),
        h('p', {}, 'このまま練習を続けるか、本番へ進みましょう。練習の記録は競技の記録に入りません。'),
        h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', 'data-testid': 'to-race', onclick: () => this.app.startRun('competition') }, '本番へ'), this.trickLabButton(), h('button', { class: 'btn', onclick: () => this.retire() }, tx('やめる'))),
      );
      return;
    }
    const st = c.step;
    this.demoButton = h('button', { class: 'btn small', 'data-testid': 'practice-demo', onclick: () => this.practiceDemo ? this.stopPracticeDemo(true) : this.startPracticeDemo() });
    this.demoStatus = h('p', { class: 'practice-demo-status', 'data-testid': 'practice-demo-status', 'aria-live': 'polite' });
    this.syncDemoControls();
    this.practicePanel.replaceChildren(
      h('div', { class: 'steps' }, PRACTICE_STEPS.map((_, i) => h('span', { class: `dot${i < c.index ? ' done' : i === c.index ? ' cur' : ''}` }, String(i + 1)))),
      h('h3', { 'data-testid': 'practice-title' }, st.title),
      h('p', {}, st.hint),
      c.lastHint ? h('p', { class: 'retry-hint' }, c.lastHint) : '',
      this.demoStatus,
      h(
        'div',
        { class: 'row-btns' },
        this.demoButton,
        h('button', { class: 'btn small', 'data-testid': 'practice-next', onclick: () => {
          this.stopPracticeDemo(true);
          this.demoFinished = false;
          c.next();
          this.renderPractice();
        } }, '次へ'),
        h('button', { class: 'btn small primary', 'data-testid': 'to-race', onclick: () => this.app.startRun('competition') }, '本番へ'),
        this.trickLabButton(),
        h('button', { class: 'btn small', onclick: () => this.retire() }, tx('やめる')),
      ),
    );
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
    <path d="M14 6a7 7 0 0 1 12 3h68a7 7 0 1 1 6 8 7 7 0 1 1-6 8H26a7 7 0 1 1-12-3 7 7 0 1 1 0-16z" style="fill:var(--effect-glint);stroke:var(--effect-shade)" stroke-width="2"/>
    <path clip-path="url(#${clipId})" d="M14 6a7 7 0 0 1 12 3h68a7 7 0 1 1 6 8 7 7 0 1 1-6 8H26a7 7 0 1 1-12-3 7 7 0 1 1 0-16z" style="fill:var(--effect-main)"/>`;
  return svg;
}
