import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FREE_RULES_VERSION } from '../src/game/free-motion';
import { SoundQueue } from '../src/ui/sound-queue';

/**
 * PR #31 の後続対応（Q01〜Q09）の再現試験。修正の前に失敗し、修正の後に成功することを確かめる。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Q09・T01 確認版の版情報', () => {
  test('確認版の review-info.json は、今のルールの版（FREE_RULES_VERSION）を書く', () => {
    expect(FREE_RULES_VERSION).toBe('rules-freestyle-2');
    const config = read('../vite.config.ts');
    expect(config).toMatch(/rulesVersion: FREE_RULES_VERSION/);
    expect(config).not.toMatch(/'rules-freestyle-1'/);
  });

  test('確認版の検査は、ルールの版を同じ定数（ソースの FREE_RULES_VERSION）と照らし合わせる', () => {
    const script = read('../scripts/check-review-build.mjs');
    expect(script).not.toMatch(/'rules-freestyle-1'/);
    expect(script).toMatch(/FREE_RULES_VERSION/);
  });

  test('古いルール（rules-freestyle-1）の記録を読む仕組みは残す', () => {
    expect(read('../src/game/free-motion.ts')).toMatch(/PREVIOUS_FREE_RULES_VERSION = 'rules-freestyle-1'/);
  });
});

describe('Q05・T07 着地音の連続再生', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const names = Array.from({ length: 30 }, (_, i) => `s${i}`);

  test('順に鳴らし、何番目・どの音かを状態として持つ', () => {
    const played: string[] = [];
    const queue = new SoundQueue(name => played.push(name), 1_400);
    queue.start(names);
    expect(queue.state).toBe('playing');
    expect(played).toEqual(['s0']);
    vi.advanceTimersByTime(1_400 * 2);
    expect(played).toEqual(['s0', 's1', 's2']);
    expect(queue.index).toBe(2);
    expect(queue.pending).toBe(1);
  });

  test('止めると予約が0になり、時間がたっても勝手に鳴り出さない', () => {
    const played: string[] = [];
    const queue = new SoundQueue(name => played.push(name), 1_400);
    queue.start(names);
    vi.advanceTimersByTime(1_400);
    queue.stop('muted');
    expect(queue.state).toBe('stopped');
    expect(queue.reason).toBe('muted');
    expect(queue.pending).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(played).toEqual(['s0', 's1']);
  });

  test('最後まで鳴らすと止まり、予約は残らない', () => {
    const played: string[] = [];
    const queue = new SoundQueue(name => played.push(name), 1_400);
    queue.start(names);
    vi.advanceTimersByTime(1_400 * 40);
    expect(played).toHaveLength(30);
    expect(queue.state).toBe('idle');
    expect(queue.pending).toBe(0);
  });

  test('もう一度始めると、前の予約は取り消してから始める', () => {
    const played: string[] = [];
    const queue = new SoundQueue(name => played.push(name), 1_400);
    queue.start(names);
    vi.advanceTimersByTime(700);
    queue.start(['x', 'y']);
    vi.advanceTimersByTime(1_400 * 5);
    expect(played).toEqual(['s0', 'x', 'y']);
  });
});

describe('Q08・T12 本番への混入', () => {
  test('確認版の道具（台帳・音・計測・固定比較）は本番の画面から読み込まない', () => {
    const screens = read('../src/ui/screens.ts');
    for (const word of ['free-review', 'fx-ledger', 'fx-compare', 'sound-queue', 'review-tools']) expect(screens).not.toContain(word);
    expect(read('../src/main.ts')).toMatch(/MODE === 'review'/);
  });
});

import { classifyFixture, fixtureTimes } from '../src/view/fx-fixture';
import { TRICK_FX_81, fxProgram } from '../src/view/trick-fx-81';

describe('Q02 固定比較の時刻と分け方', () => {
  test('81件すべてに「出始め・山・消える手前」の時刻があり、順に並ぶ。短い光（F01）は寿命の中に山がある', () => {
    for (const p of TRICK_FX_81) {
      const t = fixtureTimes(p);
      expect(t.start, p.id).toBeLessThan(t.peak);
      expect(t.peak, p.id).toBeLessThan(t.end);
      if (p.kind === 'L') expect(t.end, p.id).toBeLessThan(p.lifetimeMs);
    }
    for (const id of ['B-F01', 'H-F01', 'D-F01'] as const) {
      const step = fxProgram(id).recipe[0];
      expect(fixtureTimes(fxProgram(id)).peak, id).toBeLessThan(step.t0 + step.dur);
    }
  });

  test('描けなかったもの（無効）と、描けたが背景に埋もれたものを分ける', () => {
    const cmd = { lines: 3, dots: 1, decals: 0 };
    const diff = (changed: number, strong: number) => ({ roiPixels: 10_000, changed, strong, maxDelta: 100 });
    expect(classifyFixture('H-F01', [], cmd, diff(50, 20))).toMatchObject({ status: 'invalid_fixture', reason: 'not_active' });
    expect(classifyFixture('H-F01', ['H-F01'], { lines: 0, dots: 0, decals: 0 }, diff(0, 0))).toMatchObject({ status: 'invalid_fixture', reason: 'no_commands' });
    expect(classifyFixture('H-F01', ['H-F01'], cmd, null)).toMatchObject({ status: 'invalid_fixture', reason: 'no_canvas' });
    expect(classifyFixture('H-F01', ['H-F01'], cmd, diff(0, 0), true)).toMatchObject({ status: 'invalid_fixture', reason: 'webgl_lost' });
    expect(classifyFixture('H-F01', ['H-F01'], cmd, diff(0, 0))).toMatchObject({ status: 'valid', visibility: 'buried' });
    expect(classifyFixture('H-F01', ['H-F01'], cmd, diff(20, 2))).toMatchObject({ status: 'valid', visibility: 'weak' });
    expect(classifyFixture('H-F01', ['H-F01'], cmd, diff(200, 40))).toMatchObject({ status: 'valid', visibility: 'clear' });
  });
});

describe('Q04 正本の読み取り', () => {
  test('確認版は、正本の81行（名前と動きの説明）をそのまま読み、IDと名前が演出の定義と一致する', async () => {
    const md = read('../docs/2026-11-20-81-trick-visual-spec.md');
    const rows = [...md.matchAll(/^\| ([BHD]-[FAL]\d{2}) \| \d+ \| ([^|]+?) \| ([^|]+?) \|/gm)];
    expect(rows).toHaveLength(81);
    for (const p of TRICK_FX_81) {
      const row = rows.find(r => r[1] === p.id)!;
      expect(row[2].trim(), p.id).toBe(p.name);
      expect(row[3].trim().length, p.id).toBeGreaterThan(10);
    }
    expect(read('../src/ui/review-tools.ts')).toMatch(/2026-11-20-81-trick-visual-spec\.md\?raw/);
  });
});
