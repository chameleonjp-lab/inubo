import { describe, expect, test } from 'vitest';
import { CenterText, EFFECTS, UI_CUES, cueForEvent, pickCenterText, type Cue } from '../src/view/effects';
import { SoundScheduler, synthNames } from '../src/audio/sound';
import { DEFAULT_SETTINGS, type Settings } from '../src/storage/records';
import { getCourse } from '../src/content/courses/index';
import { runWithAutopilot } from '../src/game/autopilot';
import { advanceRun } from '../src/game/run';
import { newRun, testCourse } from './helpers';
import type { SimEvent, SimEventKind } from '../src/game/types';

const ev = (kind: SimEventKind, atUs: number, data?: SimEvent['data'], objId?: string): SimEvent => ({ runId: 'r', seq: 0, atUs, kind, pathId: 'p', sMm: 0, x: 0, y: 0, data, objId });

describe('V14 演出', () => {
  test('E01〜E24 のすべてに、見た目と音の割り当てがある', () => {
    expect(EFFECTS.map((e) => e.id)).toEqual(Array.from({ length: 24 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`));
    for (const e of EFFECTS) {
      expect(e.visual.length, e.id).toBeGreaterThan(0);
      expect(e.sound.length, e.id).toBeGreaterThan(0);
    }
  });

  test('走行の出来事と画面の操作から、24 場面すべての演出が使われる', () => {
    const course = getCourse('park');
    const used = new Set<string>();
    for (const route of ['safe', 'trick']) {
      const run = newRun(course);
      runWithAutopilot(run, course.def.autoRoutes[route]);
      for (const e of run.events) {
        const c = cueForEvent(e);
        if (c) used.add(c.effect);
      }
    }
    for (const e of ['countdown', 'start', 'collide', 'relaunch', 'landFail', 'fall', 'respawn', 'poop', 'slowEnd', 'trickReject', 'pause', 'resume'] as SimEventKind[]) {
      const c = cueForEvent(ev(e, 0, { air: true, sign: 1, n: 3 }));
      if (c) used.add(c.effect);
    }
    for (const u of Object.values(UI_CUES)) used.add(u.effect);
    expect([...used].sort()).toEqual(EFFECTS.map((e) => e.id));
  });

  test('1回音のすべてに合成の定義がある（連続音は別に扱う）', () => {
    const names = new Set(synthNames());
    const loops = new Set(['stepsLoop', 'windLoop', 'grindLoop', 'skid', 'stepSwitch', 'stepsSurface']);
    for (const e of EFFECTS) for (const s of e.sound) if (!loops.has(s)) expect(names.has(s), s).toBe(true);
  });

  test('加速・停止・着地が近接したとき、中央の文字は「停止・失敗」→「着地・技」→「アイテム」の順で選び、ほかは足元に残す', () => {
    const cues = [cueForEvent(ev('food', 100)), cueForEvent(ev('land', 110, { points: 420, tenths: 12, names: ['犬・横（右回り）', '右ひねり'], composite: true })), cueForEvent(ev('collide', 120, {}, 'w'))].filter(Boolean) as Cue[];
    const pick = pickCenterText(cues);
    expect(pick.text).toBe('ストップ');
    expect(pick.footMarks.length).toBe(2);
    const noStop = pickCenterText(cues.filter((c) => c.text !== 'ストップ'));
    expect(noStop.text).toContain('＋420');
    const ct = new CenterText();
    ct.push([cueForEvent(ev('food', 0))!], 1000);
    ct.push([cueForEvent(ev('collide', 0, {}, 'w'))!], 1100);
    expect(ct.current(1150)).toBe('ストップ');
    ct.push([cueForEvent(ev('food', 0))!], 1200);
    expect(ct.current(1250)).toBe('ストップ');
    expect(ct.footMarks.map((f) => f.text)).toContain('加速 5秒');
  });

  test('同じ壁に当たり続けても、接触の音は最初の1回だけ', () => {
    const course = testCourse({ objects: [{ kind: 'wall', id: 'w', path: 'main', u0: 40, u1: 40.4, x0: -4, x1: 4, height: 1.8 }] });
    const run = newRun(course);
    const sched = new SoundScheduler(DEFAULT_SETTINGS);
    let thuds = 0;
    let t = 0;
    let wall = 0;
    while (t < 12_000_000) {
      const facts =
        t % 1_000_000 === 0 && t > 5_000_000
          ? [
              { kind: 'down' as const, atUs: t, strokeId: t },
              { kind: 'forward' as const, atUs: t, strokeId: t },
              { kind: 'up' as const, atUs: t + 1, strokeId: t, cancelled: false },
            ]
          : [];
      const { events } = advanceRun(run, (t += 16_000), facts);
      wall += 16;
      const cues = events.map(cueForEvent).filter(Boolean) as Cue[];
      thuds += sched.onCues(cues, wall).filter((c) => c.name === 'thud').length;
    }
    expect(run.blocked?.solidId).toBe('w');
    expect(thuds).toBe(1);
  });

  test('消音中の音はためず、消音を解いても重ねて鳴らない。再開の直後は音量 0 から戻す', () => {
    const muted: Settings = { ...DEFAULT_SETTINGS, soundOn: false };
    const s = new SoundScheduler(muted);
    const cues = [cueForEvent(ev('food', 0))!, cueForEvent(ev('jump', 0, { kind: 'flat' }))!];
    expect(s.onCues(cues, 1000)).toEqual([]);
    s.setSettings(DEFAULT_SETTINGS);
    expect(s.onCues([], 1100)).toEqual([]);
    // 音量 0 の保存値も有効（鳴らさない）。
    s.setSettings({ ...DEFAULT_SETTINGS, volume: 0 });
    expect(s.onCues(cues, 1200)).toEqual([]);
    s.setSettings(DEFAULT_SETTINGS);
    s.setPaused(true, 2000);
    expect(s.master(2100)).toBe(0);
    s.setPaused(false, 3000);
    expect(s.master(3000)).toBe(0);
    expect(s.master(3200)).toBeLessThan(DEFAULT_SETTINGS.volume);
    expect(s.master(4000)).toBeCloseTo(DEFAULT_SETTINGS.volume, 9);
    // 短い間に同じ音が重なったら1回にする。
    const dup = s.onCues([cueForEvent(ev('jump', 0, { kind: 'flat' }))!, cueForEvent(ev('jump', 0, { kind: 'flat' }))!], 5000);
    expect(dup.length).toBe(1);
  });

  test('手すりの滑走音は触れている間だけ、足音の間隔は速いほど短い', () => {
    const s = new SoundScheduler(DEFAULT_SETTINGS);
    const slow = s.loops({ mode: 'ground', speed: 3, maxSpeed: 10, downhill: false, paused: false, finished: false }, 1000);
    const fast = s.loops({ mode: 'ground', speed: 10, maxSpeed: 10, downhill: false, paused: false, finished: false }, 1000);
    expect(fast.steps!.intervalMs).toBeLessThan(slow.steps!.intervalMs);
    expect(fast.grind).toBeNull();
    const rail = s.loops({ mode: 'rail', speed: 10, maxSpeed: 10, downhill: false, paused: false, finished: false }, 1000);
    expect(rail.grind).not.toBeNull();
    const railFast = s.loops({ mode: 'rail', speed: 13, maxSpeed: 10, downhill: false, paused: false, finished: false }, 1000);
    expect(railFast.grind!.rate).toBeGreaterThan(rail.grind!.rate);
    // 下りは犬が足をたたんで滑るので足音を出さない。
    expect(s.loops({ mode: 'ground', speed: 10, maxSpeed: 10, downhill: true, paused: false, finished: false }, 1000).steps).toBeNull();
  });

  test('消音・光を弱く・揺れなしでも、成績は変わらない（演出は出来事を読むだけ）', () => {
    const course = getCourse('park');
    const settingsList: Settings[] = [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, soundOn: false, light: 'weak', shake: false }, { ...DEFAULT_SETTINGS, volume: 0 }];
    const totals = settingsList.map((st) => {
      const run = newRun(course);
      const sched = new SoundScheduler(st);
      const ct = new CenterText();
      runWithAutopilot(run, course.def.autoRoutes.trick);
      const cues = run.events.map(cueForEvent).filter(Boolean) as Cue[];
      sched.onCues(cues, 0);
      ct.push(cues, 0);
      return [run.result!.total, run.result!.recordCs];
    });
    expect(totals[1]).toEqual(totals[0]);
    expect(totals[2]).toEqual(totals[0]);
  });
});
