import specMarkdown from '../../docs/2026-11-20-81-trick-visual-spec.md?raw';
import { h } from './dom';
import { SoundQueue } from './sound-queue';
import { FREE_RULES_VERSION } from '../game/free-motion';
import { landingSoundName } from '../view/trick-fx';
import { FX_TARGETS, TRICK_FX_81, isFxId, type FxId } from '../view/trick-fx-81';
import { FIXTURE_BACKDROPS, fixtureTimes, type FixtureBackdrop, type FixturePhase, type FixtureResult } from '../view/fx-fixture';
import type { FreeScene } from '../view/free-scene';
import type { AudioEngine } from '../audio/sound';

/**
 * 確認版だけの道具（Q01〜Q09）。本番の画面からは読み込まない。
 * - 結果は端末の中だけに残し、外へ送らない。コピーは人がボタンを押したときだけ。
 * - 人が目・耳・実機で確かめる欄は、初めは「未確認」。自動の検査で合格に書き換えない。
 */

export interface ReviewHost {
  root: HTMLElement;
  scene: () => FreeScene;
  audio: AudioEngine;
  soundOn: () => boolean;
  paused: () => boolean;
  syncSound: () => void;
  gallery: HTMLSelectElement;
  /** 選んでいる演出を再生する（開始からの JS の処理時間 ms を返す）。 */
  playGallery: () => number;
  /** 通常の描画を止め、固定比較の絵を画面に残す。 */
  setFrozen: (frozen: boolean) => void;
  setHalfSpeed: (half: boolean) => void;
}

const STORE = { ledger: 'fxReview:ledger:v1', sounds: 'fxReview:sounds:v1', device: 'fxReview:device:v1' } as const;
/**
 * 端末に残した結果を読む。確認版は、人が道具の欄を開くまで localStorage に一切触れない
 * （遊ぶだけなら保存領域を読みも書きもしない、という従来の約束を守る）。
 */
const load = <T extends object>(key: string, into: T): void => {
  try { const raw = localStorage.getItem(key); if (raw) Object.assign(into, JSON.parse(raw)); } catch { /* 読めなくても画面は使える */ }
};
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても画面は使える */ } };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 正本（81種類の個別描写）の表から、IDごとの名前と動きの説明を読む。 */
export function specRows(markdown = specMarkdown): Map<string, { name: string; text: string }> {
  const rows = new Map<string, { name: string; text: string }>();
  for (const m of markdown.matchAll(/^\| ([BHD]-[FAL]\d{2}) \| \d+ \| ([^|]+?) \| ([^|]+?) \|/gm)) rows.set(m[1], { name: m[2].trim(), text: m[3].trim() });
  return rows;
}

/** 文字をクリップボードへ写す。できない端末では、選んだ状態の欄を出して長押しでコピーできるようにする。 */
async function copyText(host: ReviewHost, label: string, text: string): Promise<void> {
  host.root.dataset.copied = label;
  host.root.dataset.copiedText = text.length > 20_000 ? text.slice(0, 20_000) : text;
  try {
    await navigator.clipboard.writeText(text);
    toast(host, `${label}をコピーしました`);
  } catch {
    const area = h('textarea', { class: 'free-copy', readonly: 'true', 'aria-label': `${label}（長押しでコピー）` }) as HTMLTextAreaElement;
    area.value = text;
    host.root.append(area);
    area.select();
    try { document.execCommand('copy'); toast(host, `${label}をコピーしました`); } catch { toast(host, '下の欄を長押ししてコピーしてください'); }
  }
}
function toast(host: ReviewHost, text: string): void {
  const el = h('div', { class: 'free-toast', role: 'status' }, text);
  host.root.append(el);
  setTimeout(() => el.remove(), 1_800);
}

const LEDGER_CHECKS = [['seen', '見えた'], ['origin', '起点が合う'], ['direction', '向き・動きが合う'], ['ending', '消え方が合う']] as const;
type Verdict = '未確認' | '目視合格' | '要修正';
type LedgerEntry = Record<(typeof LEDGER_CHECKS)[number][0], Verdict> & { auto: '未実施' | '自動描画確認' | '描画なし'; note: string };

const DEVICE_ITEMS = [
  ['portrait', '縦向きで操作・表示に問題がない'], ['landscape', '横向きで操作・表示に問題がない'],
  ['fiveMinutes', '5分続けて遊んでも重くならない'], ['retry3', '「やり直す」を3回押しても重くならない'],
  ['switchInAir', '空中で「両方・犬だけ・人だけ」をすぐ切り替えられる'], ['returnFromApp', '別のアプリから戻ると一時停止している'],
  ['pauseStops', '一時停止で光・粒・足跡・音が止まり、再開でまとめて出ない'],
  ['courseFx', '本番コースで空中の光が体に付き、着地の光が着地した場所に残る'], ['ghostFx', '本番コースのゴーストの着地の光が、ゴーストの着地点に出る'],
  ['notCovering', '技名・点・操作ボタン・犬と人の顔が光で隠れない'],
] as const;

export function mountReviewTools(host: ReviewHost): { element: HTMLElement; stopSounds: (reason: string) => void; onFrame: (now: number) => void; mark: (label: string, jsMs?: number) => void } {
  const spec = specRows();
  const ids = TRICK_FX_81.map(p => p.id);

  // ---------------------------------------------------------------- 版（Q01・Q09）
  const versionLine = h('p', { class: 'free-version', 'data-testid': 'review-version' },
    `ルールの版 ${FREE_RULES_VERSION}・コミット ${__FREE_SOURCE__.slice(0, 7)}・ビルド ${__FREE_BUILD__}`);
  const versionCheck = h('span', { 'data-testid': 'review-version-check' }, '（照合中）');
  versionLine.append(' ', versionCheck);
  void fetch('./review-info.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then((info: { sourceCommit?: string; buildId?: string; rulesVersion?: string } | null) => {
    const ok = !!info && info.sourceCommit === __FREE_SOURCE__ && info.buildId === __FREE_BUILD__ && info.rulesVersion === FREE_RULES_VERSION;
    versionCheck.textContent = !info ? '（review-info.json なし）' : ok ? '（配信の情報と一致）' : `（不一致：${JSON.stringify(info)}）`;
    host.root.dataset.versionMatch = info ? String(ok) : 'missing';
  }).catch(() => { versionCheck.textContent = '（review-info.json を読めない）'; host.root.dataset.versionMatch = 'missing'; });

  // ---------------------------------------------------------------- 81件の照合（Q04）
  const ledger: Record<string, LedgerEntry> = {};
  const soundMemo: Record<string, string> = {};
  const device: Record<string, { verdict: Verdict; note: string }> = {};
  let loaded = false;
  /** 人が道具の欄を開いたとき（または結果を書くとき）に、初めて端末の保存を読む。 */
  const loadAll = () => {
    if (loaded) return;
    loaded = true;
    load(STORE.ledger, ledger); load(STORE.sounds, soundMemo); load(STORE.device, device);
    countLedger(); showSpec(); showMemo(); refreshDevice();
  };
  const store = (key: string, value: unknown) => { loadAll(); save(key, value); };
  const entryOf = (id: string): LedgerEntry => ledger[id] ?? (ledger[id] = { seen: '未確認', origin: '未確認', direction: '未確認', ending: '未確認', auto: '未実施', note: '' });
  const specBox = h('div', { class: 'free-spec', 'data-testid': 'fx-spec' });
  const checks = h('div', { class: 'free-checks', 'data-testid': 'fx-ledger' });
  const ledgerCount = h('output', { 'data-testid': 'fx-ledger-count' });
  const fixtureLine = h('output', { class: 'free-perf', 'data-testid': 'fx-fixture-result' });
  const countLedger = () => {
    let open = 0, needsFix = 0, auto = 0;
    for (const id of ids) {
      const e = entryOf(id);
      for (const [key] of LEDGER_CHECKS) { if (e[key] === '未確認') open++; if (e[key] === '要修正') needsFix++; }
      if (e.auto === '自動描画確認') auto++;
    }
    ledgerCount.textContent = `目視の未確認 ${open}／${ids.length * LEDGER_CHECKS.length}項目・要修正 ${needsFix}・自動描画確認 ${auto}／81件`;
    host.root.dataset.ledgerOpen = String(open);
  };
  const showSpec = () => {
    const id = host.gallery.value;
    const row = spec.get(id);
    const e = entryOf(id);
    specBox.replaceChildren(h('strong', {}, `${id} ${row?.name ?? ''}`), h('p', {}, row?.text ?? '（正本に説明がありません）'));
    checks.replaceChildren(...LEDGER_CHECKS.map(([key, label]) => {
      const sel = h('select', { 'aria-label': label, 'data-testid': `fx-ledger-${key}`, onchange: () => { e[key] = sel.value as Verdict; store(STORE.ledger, ledger); countLedger(); } },
        ...(['未確認', '目視合格', '要修正'] as const).map(v => h('option', { value: v }, v))) as HTMLSelectElement;
      sel.value = e[key];
      return h('label', {}, label, sel);
    }), h('span', { 'data-testid': 'fx-ledger-auto' }, `自動：${e.auto}`));
    host.root.dataset.specId = id;
  };
  host.gallery.addEventListener('change', showSpec);
  const step = (delta: number) => {
    const i = ids.indexOf(host.gallery.value as FxId);
    host.gallery.value = ids[(i + delta + ids.length) % ids.length];
    host.gallery.dispatchEvent(new Event('change'));
  };
  const frozenNote = h('span', { class: 'free-frozen', hidden: true }, '止めた絵を表示中');
  const showPhase = (phase: FixturePhase) => {
    const id = host.gallery.value;
    if (!isFxId(id)) return;
    host.setFrozen(true);
    frozenNote.hidden = false;
    const result = host.scene().renderFixture(id, phase, backdrop.value as FixtureBackdrop);
    recordAuto(result);
    fixtureLine.textContent = describe(result);
    host.root.dataset.fixture = JSON.stringify(result);
  };
  const recordAuto = (r: FixtureResult) => {
    const e = entryOf(r.id);
    // 自動の検査で分かるのは「描けたか」だけ。目視の欄は変えない。
    if (r.status === 'valid') e.auto = '自動描画確認';
    else if (e.auto === '未実施') e.auto = '描画なし';
    store(STORE.ledger, ledger);
    countLedger();
    if (r.id === host.gallery.value) showSpec();
  };
  const backdrop = h('select', { 'aria-label': '確認する背景', 'data-testid': 'fx-backdrop', onchange: () => host.scene().setBackdrop(backdrop.value as FixtureBackdrop) },
    ...([['sky', '明るい空'], ['bright-road', '明るい路面'], ['dark-road', '暗い路面'], ['wall', '壁の前（ぶつからない）']] as const).map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const ledgerSection = h('details', { class: 'free-tool', 'data-testid': 'tool-ledger' }, h('summary', {}, '81件を正本と見比べる'),
    specBox,
    h('div', { class: 'free-actions' },
      h('button', { 'data-testid': 'fx-prev', onclick: () => step(-1) }, '前へ'), h('button', { 'data-testid': 'fx-next', onclick: () => step(1) }, '次へ'),
      h('button', { 'data-testid': 'fx-phase-start', onclick: () => showPhase('start') }, '出始め'), h('button', { 'data-testid': 'fx-phase-peak', onclick: () => showPhase('peak') }, '山'),
      h('button', { 'data-testid': 'fx-phase-end', onclick: () => showPhase('end') }, '消える手前'),
      h('button', { 'data-testid': 'fx-unfreeze', onclick: () => { host.setFrozen(false); frozenNote.hidden = true; } }, '動きに戻る'), backdrop),
    frozenNote, fixtureLine, checks, ledgerCount,
    h('div', { class: 'free-actions' }, h('button', { 'data-testid': 'fx-ledger-copy', onclick: () => void copyText(host, '81件の台帳', ledgerText()) }, '台帳をコピー')));
  const ledgerText = () => ['ID\t名前\t見えた\t起点\t向き・動き\t消え方\t自動\tメモ', ...ids.map(id => {
    const e = entryOf(id);
    return [id, spec.get(id)?.name ?? '', e.seen, e.origin, e.direction, e.ending, e.auto, e.note].join('\t');
  })].join('\n');

  // ---------------------------------------------------------------- 108件の固定比較（Q02）
  const LOW = FX_TARGETS.flatMap(t => ['F01', 'F02', 'F03', 'A01', 'A02', 'A03', 'L01', 'L02', 'L03'].map(k => `${t}-${k}` as FxId));
  let compareResults: FixtureResult[] = [];
  const compareOut = h('output', { class: 'free-perf', 'data-testid': 'fx-compare-summary' });
  const runCompare = async (list: FxId[], backdrops: readonly FixtureBackdrop[]) => {
    host.setFrozen(true);
    frozenNote.hidden = false;
    compareResults = [];
    let n = 0;
    for (const bg of backdrops) for (const id of list) {
      const r = host.scene().renderFixture(id, 'peak', bg);
      compareResults.push(r);
      recordAuto(r);
      if (++n % 6 === 0) { compareOut.textContent = `比較中 ${n}／${list.length * backdrops.length}`; await wait(0); }
    }
    const invalid = compareResults.filter(r => r.status !== 'valid');
    const by = (v: string) => compareResults.filter(r => r.visibility === v).map(r => `${r.backdrop}:${r.id}`);
    const summary = { total: compareResults.length, valid: compareResults.length - invalid.length, invalid: invalid.map(r => `${r.backdrop}:${r.id}:${r.reason}`),
      clear: by('clear').length, weak: by('weak'), buried: by('buried') };
    compareOut.textContent = `有効 ${summary.valid}／${summary.total}・無効 ${invalid.length}・はっきり ${summary.clear}・弱い ${summary.weak.length}・埋もれた ${summary.buried.length}`;
    host.root.dataset.compareSummary = JSON.stringify(summary);
  };
  const compareSection = h('details', { class: 'free-tool', 'data-testid': 'tool-compare' }, h('summary', {}, '低い段階の見え方を固定条件で比べる（108件）'),
    h('p', {}, '同じ姿勢・同じ時刻・同じカメラで「演出あり」「演出なし」を描き、犬と人のまわりの画素の差を数えます。描けなかったものは「無効」、描けたのに差が出ないものは「埋もれた」と分けます。数字は目安で、見えるかどうかの最終判断は人の目です。'),
    h('div', { class: 'free-actions' },
      h('button', { 'data-testid': 'fx-compare-all', onclick: () => void runCompare(LOW, FIXTURE_BACKDROPS) }, '108件を比べる'),
      h('button', { 'data-testid': 'fx-compare-copy', onclick: () => void copyText(host, '108件の比較', JSON.stringify(compareResults)) }, '結果をコピー')),
    compareOut);

  // ---------------------------------------------------------------- 着地音30種（Q05）
  const soundNames = FX_TARGETS.flatMap(t => Array.from({ length: 10 }, (_, i) => landingSoundName(t, i + 1)));
  const soundPick = h('select', { 'aria-label': '着地音を1つずつ確認', 'data-testid': 'fx-sound', onchange: () => showMemo() },
    ...soundNames.map(name => h('option', { value: name }, name.replace('trickLanding', '着地音 ')))) as HTMLSelectElement;
  const soundState = h('output', { class: 'free-perf', 'data-testid': 'fx-sound-state' });
  const memo = h('select', { 'aria-label': 'この音の聞こえ方', 'data-testid': 'fx-sound-memo', onchange: () => { soundMemo[soundPick.value] = memo.value; store(STORE.sounds, soundMemo); } },
    ...['未聴', '区別できる', '隣の段階と似ている', '大きすぎる', '余韻が長すぎる', '聞こえない'].map(v => h('option', { value: v }, v))) as HTMLSelectElement;
  const showMemo = () => { memo.value = soundMemo[soundPick.value] ?? '未聴'; };
  const playSound = (name: string) => {
    host.audio.unlock(); host.syncSound();
    soundPick.value = name; showMemo();
    host.root.dataset.lastSound = name;
    if (host.soundOn() && !host.paused()) host.audio.play({ name, gain: 0.7, pitch: 1, reverse: false });
    showSoundState();
  };
  const queue = new SoundQueue((name) => playSound(name), 1_400, () => showSoundState());
  const showSoundState = () => {
    const where = queue.state === 'playing' ? `順に再生中 ${queue.index + 1}／${queue.total}：${queue.current}` :
      queue.state === 'stopped' ? `止めました（${queue.reason}）` : '待機中';
    soundState.textContent = `${where}・音の装置 ${host.audio.state}・${host.soundOn() ? '音あり' : '消音'}`;
    host.root.dataset.soundQueue = String(queue.pending);
    host.root.dataset.soundState = queue.state;
  };
  const stopSounds = (reason: string) => { queue.stop(reason); host.audio.stopTrickLanding(); showSoundState(); };
  const nudge = (delta: number, sameLevel = false) => {
    const i = soundNames.indexOf(soundPick.value);
    const j = sameLevel ? (i + 10) % 30 : (i + delta + 30) % 30;
    stopSounds('選び直し');
    playSound(soundNames[j]);
  };
  const soundSection = h('details', { class: 'free-tool', 'data-testid': 'tool-sound' }, h('summary', {}, '着地音30種を聞き比べる'),
    h('div', { class: 'free-actions', 'data-testid': 'fx-sound-row' }, soundPick,
      h('button', { 'data-testid': 'fx-sound-play', onclick: () => { stopSounds('1つ鳴らす'); playSound(soundPick.value); } }, '音を鳴らす'),
      h('button', { 'data-testid': 'fx-sound-prev', onclick: () => nudge(-1) }, '前の音'), h('button', { 'data-testid': 'fx-sound-next', onclick: () => nudge(1) }, '次の音'),
      h('button', { 'data-testid': 'fx-sound-other', onclick: () => nudge(0, true) }, '同じ段階の別の対象'),
      h('button', { 'data-testid': 'fx-sound-all', onclick: () => { host.audio.unlock(); queue.start(soundNames); } }, '30種を順に'),
      h('button', { 'data-testid': 'fx-sound-stop', onclick: () => stopSounds('止めるボタン') }, '止める')),
    soundState, h('label', {}, '聞こえ方のメモ ', memo),
    h('div', { class: 'free-actions' }, h('button', { 'data-testid': 'fx-sound-copy', onclick: () => void copyText(host, '着地音のメモ', soundNames.map(n => `${n}\t${soundMemo[n] ?? '未聴'}`).join('\n')) }, 'メモをコピー')));
  showMemo();
  showSoundState();

  // ---------------------------------------------------------------- 計測（Q06・V01）
  const frames: { t: number; gap: number }[] = [];
  const marks: { t: number; label: string; jsMs?: number }[] = [];
  const mountedAt = performance.now();
  let lastFrame = 0;
  const mark = (label: string, jsMs?: number) => { marks.push({ t: performance.now(), label, ...(jsMs !== undefined ? { jsMs: Math.round(jsMs * 10) / 10 } : {}) }); if (marks.length > 2_000) marks.shift(); };
  const onFrame = (now: number) => {
    if (lastFrame) frames.push({ t: now, gap: now - lastFrame });
    lastFrame = now;
    if (frames.length > 30_000) frames.splice(0, 10_000);
    if (quick && now >= quick.until) finishQuick();
  };
  const stats = (list: { t: number; gap: number }[]) => {
    const g = list.map(f => f.gap).sort((a, b) => a - b);
    const q = (p: number) => g.length ? Math.round(g[Math.min(g.length - 1, Math.floor(p * g.length))] * 10) / 10 : null;
    const long = list.filter(f => f.gap >= 100).map(f => {
      const before = marks.filter(m => m.t <= f.t).pop();
      return { atMs: Math.round(f.t - mountedAt), gapMs: Math.round(f.gap), lastAction: before?.label ?? '（操作なし）', sinceActionMs: before ? Math.round(f.t - before.t) : null };
    });
    return { frames: g.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: g.length ? Math.round(g[g.length - 1]) : null, over100ms: long.length, long: long.slice(0, 12) };
  };
  const env = () => ({ userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, rules: FREE_RULES_VERSION, commit: __FREE_SOURCE__, build: __FREE_BUILD__, at: new Date().toISOString() });
  // 10秒計測（以前からの操作）。
  let quick: { from: number; until: number; lines: number; dots: number; decals: number } | null = null;
  const perfOut = h('output', { class: 'free-perf', 'data-testid': 'perf-result' });
  const finishQuick = () => {
    if (!quick) return;
    const s = stats(frames.filter(f => f.t >= quick!.from && f.t <= quick!.until));
    const result = { kind: 'quick10s', fpsMedian: s.p50 ? Math.round(1000 / s.p50) : 0, p95GapMs: s.p95, stallsOver100ms: s.over100ms, ...s, ...env() };
    perfOut.textContent = JSON.stringify(result);
    host.root.dataset.perf = JSON.stringify(result);
    quick = null;
  };
  // 段階別計測：起動直後・切り替え直後・安定・やり直し10回・30件の切り替え を分けて測る。
  const phasesOut = h('output', { class: 'free-perf', 'data-testid': 'perf-phases-result' });
  let phases: Record<string, unknown> | null = null;
  const within = (f: { t: number }, from: number, to: number) => f.t >= from && f.t < to;
  const runPhases = async () => {
    phasesOut.textContent = '計測中（約50秒）…';
    host.setFrozen(false);
    const startAt = performance.now();
    const playAt: number[] = [];
    const play = (id: FxId, label: string) => { host.gallery.value = id; const js = host.playGallery(); mark(`${label}:${id}`, js); playAt.push(performance.now()); };
    // 安定：ゆっくり（½）で長く飛ばし、出し直しの直後1秒を除いた間を「安定」とする。
    host.setHalfSpeed(true);
    for (let i = 0; i < 4; i++) { play('B-F10', '安定'); await wait(3_400); }
    const steadyEnd = performance.now();
    host.setHalfSpeed(false);
    for (let i = 0; i < 10; i++) { play('B-F10', 'やり直し'); await wait(900); }
    const retriesEnd = performance.now();
    for (const id of TRICK_FX_81.filter((_, i) => i % 3 === 0).slice(0, 27).map(p => p.id).concat(['B-L10', 'H-L10', 'D-L10'] as FxId[])) { play(id, '切替'); await wait(700); }
    const end = performance.now();
    const afterPlay = (f: { t: number }) => playAt.some(t => f.t >= t && f.t < t + 1_000);
    phases = {
      kind: 'phases',
      coldStart: stats(frames.filter(f => within(f, mountedAt, mountedAt + 3_000))),
      firstSwitch: stats(frames.filter(f => playAt.length && within(f, playAt[0], playAt[0] + 1_000))),
      steady: stats(frames.filter(f => within(f, startAt, steadyEnd) && !afterPlay(f))),
      switchWindows: stats(frames.filter(f => within(f, startAt, end) && afterPlay(f) && !within(f, playAt[0], playAt[0] + 1_000))),
      retries10: stats(frames.filter(f => within(f, steadyEnd, retriesEnd))),
      switch30: stats(frames.filter(f => within(f, retriesEnd, end))),
      playJsMs: marks.filter(m => m.t >= startAt && m.jsMs !== undefined).map(m => m.jsMs),
      inputToFrame: '空中でなぞった直後の反映時間は、この自動の計測では測れない（人が操作する10秒計測で測る）',
      ...env(),
    };
    phasesOut.textContent = JSON.stringify(phases);
    host.root.dataset.perfPhases = JSON.stringify(phases);
  };
  const perfSection = h('details', { class: 'free-tool', 'data-testid': 'tool-perf' }, h('summary', {}, '描画の速さを測る'),
    h('p', {}, '「10秒計測」はそのまま遊びながら測ります。「段階別に測る」は自動で演出を出し直し、起動直後・切り替え直後・安定・やり直し・30件の切り替えを分けて測ります（約50秒）。'),
    h('div', { class: 'free-actions', 'data-testid': 'perf-row' },
      h('button', { 'data-testid': 'perf-run', onclick: () => { quick = { from: performance.now(), until: performance.now() + 10_000, lines: 0, dots: 0, decals: 0 }; perfOut.textContent = '計測中（10秒）…'; } }, '10秒計測'),
      h('button', { 'data-testid': 'perf-phases', onclick: () => void runPhases() }, '段階別に測る'),
      h('button', { 'data-testid': 'perf-copy', onclick: () => void copyText(host, '計測の結果', JSON.stringify({ quick: host.root.dataset.perf ? JSON.parse(host.root.dataset.perf) : null, phases })) }, '計測をコピー')),
    perfOut, phasesOut);

  // ---------------------------------------------------------------- iPhone 実機チェック（Q07）
  const itemOf = (key: string) => device[key] ?? (device[key] = { verdict: '未確認', note: '' });
  const deviceInputs: { key: string; sel: HTMLSelectElement; note: HTMLInputElement }[] = [];
  const refreshDevice = () => { for (const d of deviceInputs) { d.sel.value = itemOf(d.key).verdict; d.note.value = itemOf(d.key).note; } };
  const deviceRows = DEVICE_ITEMS.map(([key, label]) => {
    const item = { get verdict() { return itemOf(key).verdict; }, set verdict(v: Verdict) { itemOf(key).verdict = v; },
      get note() { return itemOf(key).note; }, set note(v: string) { itemOf(key).note = v; } };
    const sel = h('select', { 'aria-label': label, 'data-testid': `device-${key}`, onchange: () => { item.verdict = sel.value as Verdict; store(STORE.device, device); } },
      ...(['未確認', '目視合格', '要修正'] as const).map(v => h('option', { value: v }, v === '目視合格' ? '合格' : v))) as HTMLSelectElement;
    sel.value = item.verdict;
    const note = h('input', { type: 'text', placeholder: 'メモ', 'aria-label': `${label}のメモ`, value: item.note, oninput: () => { item.note = note.value; store(STORE.device, device); } }) as HTMLInputElement;
    deviceInputs.push({ key, sel, note });
    return h('label', { class: 'free-device-row' }, h('span', {}, label), sel, note);
  });
  const allResults = () => { loadAll(); return JSON.stringify({
    env: env(), device, ledger: ids.map(id => ({ id, name: spec.get(id)?.name, ...entryOf(id) })),
    sounds: soundNames.map(n => ({ name: n, memo: soundMemo[n] ?? '未聴' })),
    quickPerf: host.root.dataset.perf ? JSON.parse(host.root.dataset.perf) : null, phases, compare: compareResults.length ? JSON.parse(host.root.dataset.compareSummary ?? 'null') : null,
  }, null, 1); };
  const deviceSection = h('details', { class: 'free-tool', 'data-testid': 'tool-device' }, h('summary', {}, 'iPhone 実機チェック'),
    h('p', {}, '縦・横それぞれで確かめ、結果を選んでください。本番コースの項目は、公開中のゲームを遊んで確かめます。結果はこの端末の中だけに残り、どこにも送られません。'),
    ...deviceRows,
    h('div', { class: 'free-actions' }, h('button', { 'data-testid': 'review-copy-all', onclick: () => void copyText(host, 'すべての結果', allResults()) }, 'すべての結果をコピー')));

  countLedger();
  showSpec();
  for (const section of [ledgerSection, compareSection, soundSection, perfSection, deviceSection]) {
    section.addEventListener('toggle', () => { if ((section as HTMLDetailsElement).open) loadAll(); });
  }
  const element = h('div', { class: 'free-tools' }, versionLine, ledgerSection, compareSection, soundSection, perfSection, deviceSection);
  return { element, stopSounds, onFrame, mark };
}

/** 固定比較の1件を、短い文にする。 */
function describe(r: FixtureResult): string {
  if (r.status !== 'valid') return `${r.id}（${r.phase} ${r.tMs}ms・${r.backdrop}）：無効 ${r.reason}`;
  const d = r.diff!;
  const look = r.visibility === 'clear' ? 'はっきり' : r.visibility === 'weak' ? '弱い' : '埋もれた';
  return `${r.id}（${r.phase} ${r.tMs}ms・${r.backdrop}）：${look}・変わった画素 ${d.changed}・強い差 ${d.strong}・最大差 ${d.maxDelta}・線 ${r.commands.lines}／点 ${r.commands.dots}／印 ${r.commands.decals}`;
}

export { fixtureTimes };
