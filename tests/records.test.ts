import { describe, expect, test } from 'vitest';
import { MemoryStorage, Records, loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/storage/records';
import { ReplayRecorder, replayPoseAt, type ReplayData } from '../src/view/replay';
import { homeShareText, intentUrl, resultShareText, shareOnX, shareableResult } from '../src/ui/share';
import { getCourse } from '../src/content/courses/index';
import { runWithAutopilot, Autopilot } from '../src/game/autopilot';
import { advanceRun } from '../src/game/run';
import { RULES_VERSION } from '../src/game/rules';
import { newRun } from './helpers';
import type { RunResult } from '../src/game/types';

function result(over: Partial<RunResult>): RunResult {
  return {
    runId: 'r',
    courseId: 'park',
    courseVersion: 'park-1',
    rulesVersion: RULES_VERSION,
    dogId: 'shiba',
    mode: 'competition',
    finishUs: 0,
    recordCs: 7600,
    timeScore: 3400,
    trickRaw: 1200,
    trickScore: 1200,
    total: 4600,
    jumpPoints: 1200,
    railPoints: 0,
    streakBonus: 0,
    sections: [],
    rails: [],
    jumps: [],
    nearMiss: null,
    route: [],
    challengeDone: false,
    itemsTaken: [],
    ...over,
  };
}

const replay = (runId: string, dogId: RunResult['dogId'] = 'shiba', courseVersion = 'park-1', rulesVersion = RULES_VERSION): ReplayData => ({
  runId,
  dogId,
  courseId: 'park',
  courseVersion,
  rulesVersion,
  stepMs: 100,
  frames: [
    [0, 0, 0, 0, 0, 0, 0, 1000, 0, 0, 0, 1000],
    [100, 0, 0, 0, 0, 0, 0, 1000, 0, 0, 0, 1000],
  ],
});

describe('V15 2つの自己記録', () => {
  test('76 秒・4,600 点 → 80 秒・4,800 点: 最速と再生は前者、最高点は後者', () => {
    const rec = new Records(new MemoryStorage());
    const a = result({ runId: 'a', recordCs: 7600, total: 4600, dogId: 'corgi' });
    const b = result({ runId: 'b', recordCs: 8000, total: 4800, timeScore: 3000, trickScore: 1800 });
    const oa = rec.saveLocalResult(a, replay('a', 'corgi'), 1);
    const ob = rec.saveLocalResult(b, replay('b'), 2);
    expect(oa).toMatchObject({ newBestScore: true, newBestTime: true });
    expect(ob).toMatchObject({ newBestScore: true, newBestTime: false });
    const k = { courseId: 'park' as const, courseVersion: 'park-1', rulesVersion: RULES_VERSION };
    expect(rec.bestTime(k)).toMatchObject({ runId: 'a', dogId: 'corgi', recordCs: 7600 });
    expect(rec.bestTimeReplay(k)).toMatchObject({ runId: 'a', dogId: 'corgi' });
    expect(rec.bestScore(k)).toMatchObject({ runId: 'b', total: 4800 });
  });

  test('コースの版だけ・ルールの版だけを変えても、記録は混ざらない', () => {
    const rec = new Records(new MemoryStorage());
    rec.saveLocalResult(result({ runId: 'a' }), replay('a'));
    rec.saveLocalResult(result({ runId: 'c', courseVersion: 'park-2', recordCs: 9000, total: 1000 }), replay('c', 'shiba', 'park-2'));
    rec.saveLocalResult(result({ runId: 'd', rulesVersion: 'rules-2', recordCs: 9500, total: 900 }), replay('d', 'shiba', 'park-1', 'rules-2'));
    expect(rec.bestTime({ courseId: 'park', courseVersion: 'park-1', rulesVersion: RULES_VERSION })!.runId).toBe('a');
    expect(rec.bestTime({ courseId: 'park', courseVersion: 'park-2', rulesVersion: RULES_VERSION })!.runId).toBe('c');
    expect(rec.bestTime({ courseId: 'park', courseVersion: 'park-1', rulesVersion: 'rules-2' })!.runId).toBe('d');
    // 古い走りを新しい道に重ねない（版が違う再生は使わない）。
    expect(rec.bestTimeReplay({ courseId: 'park', courseVersion: 'park-2', rulesVersion: RULES_VERSION })!.runId).toBe('c');
  });

  test('同じタイム・同じ点なら、先に保存した走行を残す。練習は保存しない', () => {
    const rec = new Records(new MemoryStorage());
    rec.saveLocalResult(result({ runId: 'first', dogId: 'whippet' }), replay('first', 'whippet'));
    const o = rec.saveLocalResult(result({ runId: 'second' }), replay('second'));
    expect(o).toMatchObject({ newBestScore: false, newBestTime: false });
    const k = { courseId: 'park' as const, courseVersion: 'park-1', rulesVersion: RULES_VERSION };
    expect(rec.bestTime(k)!.runId).toBe('first');
    expect(rec.bestTimeReplay(k)!.dogId).toBe('whippet');
    const p = rec.saveLocalResult(result({ runId: 'practice', mode: 'practice', recordCs: 100, total: 9999 }), null);
    expect(p.attempted).toBe(false);
    expect(rec.bestTime(k)!.runId).toBe('first');
  });

  test('遅いタブからの保存で、最速を巻き戻さない', () => {
    const shared = new MemoryStorage();
    const tab1 = new Records(shared);
    const tab2 = new Records(shared);
    const k = { courseId: 'park' as const, courseVersion: 'park-1', rulesVersion: RULES_VERSION };
    tab1.saveLocalResult(result({ runId: 'old', recordCs: 9000, total: 3000 }), replay('old'));
    // tab2 で速い走行を保存したあと、tab1 で遅い走行を保存する。
    tab2.saveLocalResult(result({ runId: 'fast', recordCs: 7000, total: 3500 }), replay('fast'));
    tab1.saveLocalResult(result({ runId: 'slow', recordCs: 8000, total: 3200 }), replay('slow'));
    expect(tab1.bestTime(k)!.runId).toBe('fast');
    expect(tab2.bestTimeReplay(k)!.runId).toBe('fast');
  });

  test('再生が欠けている・別の走行のものなら表示を休める', () => {
    const store = new MemoryStorage();
    const rec = new Records(store);
    const k = { courseId: 'park' as const, courseVersion: 'park-1', rulesVersion: RULES_VERSION };
    rec.saveLocalResult(result({ runId: 'a' }), null);
    expect(rec.bestTime(k)!.runId).toBe('a');
    expect(rec.bestTimeReplay(k)).toBeNull();
    // 別の走行の再生を渡しても、記録には結びつけない。
    const rec2 = new Records(new MemoryStorage());
    rec2.saveLocalResult(result({ runId: 'b' }), replay('other'));
    expect(rec2.bestTimeReplay(k)).toBeNull();
  });

  test('保存に失敗しても、今回の結果はそのまま読め、再挑戦できる', () => {
    const store = new MemoryStorage();
    store.failWrites = true;
    const rec = new Records(store);
    const r = result({ runId: 'x' });
    const o = rec.saveLocalResult(r, replay('x'));
    expect(o.saved).toBe(false);
    expect(r.total).toBe(4600);
  });

  test('完走スタンプは犬×コースで1個、課題達成はコース×版で区別する', () => {
    const rec = new Records(new MemoryStorage());
    expect(rec.saveLocalResult(result({ runId: '1' }), null).newStamp).toBe(true);
    expect(rec.saveLocalResult(result({ runId: '2' }), null).newStamp).toBe(false);
    expect(rec.saveLocalResult(result({ runId: '3', dogId: 'corgi' }), null).newStamp).toBe(true);
    expect(rec.saveLocalResult(result({ runId: '4', courseId: 'riverside', courseVersion: 'river-1' }), null).newStamp).toBe(true);
    expect(rec.saveLocalResult(result({ runId: '5', challengeDone: true }), null).newChallenge).toBe(true);
    expect(rec.saveLocalResult(result({ runId: '6', challengeDone: true, dogId: 'whippet' }), null).newChallenge).toBe(false);
    expect(rec.saveLocalResult(result({ runId: '7', challengeDone: true, courseVersion: 'park-2' }), null).newChallenge).toBe(true);
  });

  test('最速の走りの再生: 犬種と各時刻の位置・姿勢を残し、再生は当たり判定・取得・採点に関与しない', () => {
    const course = getCourse('park');
    const run = newRun(course, 'whippet', { courseVersion: course.def.version });
    const rec = new ReplayRecorder(100);
    const pilot = new Autopilot(course.def.autoRoutes.trick);
    let t = 0;
    while (!run.finished) {
      advanceRun(run, (t += 16_667), pilot.poll(run));
      rec.sample(run);
    }
    const data = rec.finish(run);
    expect(data.dogId).toBe('whippet');
    expect(data.frames.length).toBeGreaterThan(run.result!.finishUs / 100_000 - 2);
    const p = replayPoseAt(data, 30_000_000)!;
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    // 再生の表示あり・なしの2走で、点と取得物が一致する（再生は計算に入らない）。
    const a = newRun(course);
    const b = newRun(course);
    runWithAutopilot(a, course.def.autoRoutes.trick);
    runWithAutopilot(b, course.def.autoRoutes.trick);
    void replayPoseAt(data, 1_000_000);
    expect(a.result!.total).toBe(b.result!.total);
    expect(a.result!.itemsTaken).toEqual(b.result!.itemsTaken);
  });

  test('設定（音のオン・オフ、音量、揺れ、光の量）は別々に保存され、再読込後も残る。保存済みの 0 も有効', () => {
    const store = new MemoryStorage();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    saveSettings(store, { ...DEFAULT_SETTINGS, volume: 0, shake: false });
    expect(loadSettings(store)).toMatchObject({ soundOn: true, volume: 0, shake: false, light: 'normal' });
    saveSettings(store, { ...DEFAULT_SETTINGS, soundOn: false, light: 'weak' });
    expect(loadSettings(store)).toMatchObject({ soundOn: false, volume: 0.8, light: 'weak' });
  });
});

describe('V16 共有と結果', () => {
  const url = 'https://example.com/inubo/';
  test('完走時の今回値を共有し、犬種・コース・タイム・総合点・正式 URL が 1 回ずつ入る（記号を含む名前でも崩れない）', () => {
    const r = result({ recordCs: 7612, total: 4588 });
    const text = resultShareText(r, '公園&<試験>#1', 'コーギー', url);
    const once = (s: string) => text.split(s).length - 1;
    expect(once('公園&<試験>#1')).toBe(1);
    expect(once('コーギー')).toBe(1);
    expect(once('76.12秒')).toBe(1);
    expect(once('4,588点')).toBe(1);
    expect(once(url)).toBe(1);
    const u = intentUrl(text);
    expect(u.startsWith('https://x.com/intent/tweet?text=')).toBe(true);
    expect(decodeURIComponent(u.split('text=')[1])).toBe(text);
    // ホームの共有はゲームの紹介で、結果の値を入れない。
    expect(homeShareText(url)).not.toContain('点');
  });

  test('正式 URL が未確認のうちは、共有文に URL を入れない', () => {
    expect(resultShareText(result({}), '公園', '柴犬', null)).not.toMatch(/https?:/);
  });

  test('投稿画面を開けない場合は、同じ文のコピーへ進む。コピーもできなければ手で写せるようにする', async () => {
    const text = 'abc';
    const copied: string[] = [];
    expect(await shareOnX(text, { open: () => ({}), copy: async (t) => void copied.push(t) })).toBe('opened');
    expect(await shareOnX(text, { open: () => null, copy: async (t) => void copied.push(t) })).toBe('copied');
    expect(copied).toEqual([text]);
    expect(
      await shareOnX(text, {
        open: () => {
          throw new Error('blocked');
        },
        copy: async () => {
          throw new Error('denied');
        },
      }),
    ).toBe('manual');
  });

  test('途中終了・練習の走行は、完走結果として扱わない。再挑戦は新しい走行になる', () => {
    expect(shareableResult(null)).toBe(false);
    expect(shareableResult(result({ mode: 'practice' }))).toBe(false);
    expect(shareableResult(result({}))).toBe(true);
    const course = getCourse('park');
    const a = newRun(course);
    const b = newRun(course);
    expect(a.id.runId).not.toBe(b.id.runId);
    expect(b.simUs).toBe(0);
    expect(b.consumed).toEqual({});
  });
});
