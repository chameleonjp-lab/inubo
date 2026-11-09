import { describe, expect, test } from 'vitest';
import { TRICK_LAB_LESSONS, labDemo, type LabDemoStep } from '../src/content/trick-lab';
import { LabDemoRunner, advanceLab, createLabAttempt, aimFromSwipe, AIM_STEP_M, type LabFailReason, type LabInput, type LabSetup, type Stance } from '../src/game/trick-lab';
import type { LabFixtureId } from '../src/game/trick-lab-terrain';

/** 技の練習の計算（T1〜T2・T4の計算側）。お手本と同じ入力の形で、成功例と失敗例を確かめる。 */

function run(lessonId: string, fixtureId: LabFixtureId, steps: LabDemoStep[], stance: Stance = 'regular') {
  const d = new LabDemoRunner({ attemptId: `t-${lessonId}`, lessonId, fixtureId, stance, dogId: 'shiba' }, steps);
  d.advanceTo(9_000_000);
  return d;
}

function demo(lessonId: string, fixture?: LabFixtureId): LabDemoStep[] {
  const l = TRICK_LAB_LESSONS.find((x) => x.id === lessonId)!;
  return labDemo(l, fixture ?? l.fixtureIds[0]);
}

function withSetup(steps: LabDemoStep[], setup: Partial<LabSetup>): LabDemoStep[] {
  const rest = steps.filter((s) => s.action.type !== 'setup');
  return [{ at: 0, action: { type: 'setup', setup }, button: null }, ...rest];
}

function without(steps: LabDemoStep[], type: LabDemoStep['action']['type']): LabDemoStep[] {
  return steps.filter((s) => s.action.type !== type);
}

function expectFail(d: LabDemoRunner, reason: LabFailReason) {
  const o = d.state.outcome;
  expect(o?.kind, JSON.stringify(o)).toBe('fail');
  expect(o && 'reason' in o ? o.reason : null, o?.detail).toBe(reason);
}

describe('技データ', () => {
  test('01〜38に重複・欠番がなく、日英の名称・難度・地形がある', () => {
    const ids = TRICK_LAB_LESSONS.map((l) => l.id);
    expect(ids).toEqual(Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')));
    for (const l of TRICK_LAB_LESSONS) {
      expect(l.ja.length).toBeGreaterThan(0);
      expect(l.en.length).toBeGreaterThan(0);
      expect(l.difficulty).toBeGreaterThanOrEqual(1);
      expect(l.difficulty).toBeLessThanOrEqual(5);
      expect(l.fixtureIds.length).toBeGreaterThan(0);
    }
  });

  test('34はウェドルを表示名にし、旧称は照合用の別名に持つ', () => {
    const l = TRICK_LAB_LESSONS.find((x) => x.id === '34')!;
    expect(l.ja).toBe('ウェドル・グラブ');
    expect(l.alias).toContain('旧称');
  });
});

describe('お手本は全38技・全練習地形で、入口から安定復帰まで届く', () => {
  for (const l of TRICK_LAB_LESSONS) {
    for (const f of l.fixtureIds) {
      test(`${l.id} ${l.ja}（${f}）`, () => {
        const d = run(l.id, f, labDemo(l, f));
        expect(d.state.outcome?.kind, d.state.outcome?.detail).toBe('success');
      });
    }
  }
});

describe('技ごとの代表的な失敗', () => {
  test('01: 段差から落ちただけでは失敗（踏切なし）', () => {
    // 段を転がり落ちると、前後の足が別の段に着いて失敗する。
    const d = run('01', 'stairs', without(demo('01', 'stairs'), 'pop'));
    expect(d.state.outcome?.kind).toBe('fail');
    expect(d.state.events.some((e) => e.kind === 'takeoff' && e.data?.kind === 'drop')).toBe(true);
  });

  test('02・03: 裏返しの向きが逆なら失敗、足を戻さなければ失敗', () => {
    expectFail(run('02', 'flat', withSetup(demo('02'), { flip: 'heel' })), 'wrongRotation');
    expectFail(run('03', 'flat', withSetup(demo('03'), { flip: 'kick' })), 'wrongRotation');
    expectFail(run('02', 'flat', without(demo('02'), 'catch')), 'unstableLanding');
  });

  test('02: 犬が回りきる前に足を戻すと失敗', () => {
    const steps = demo('02').map((s) => (s.action.type === 'catch' ? { ...s, at: { after: 'takeoff' as const, delayUs: 150_000 } } : s));
    expectFail(run('02', 'flat', steps), 'wrongOrder');
  });

  test('04: 人も180°回った場合は失敗', () => {
    expectFail(run('04', 'flat', withSetup(demo('04'), { dogYaw: -180, riderYaw: -180 })), 'wrongRotation');
  });

  test('05・06: 0.50秒より前に反対側の足組が着くと失敗。境界は刻み（5ミリ秒）単位で確かめる', () => {
    const at = (holdUs: number, load: 'back' | 'front'): LabDemoStep[] => [
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 300_000, action: { type: 'load', load }, button: null },
      { at: 300_000 + holdUs, action: { type: 'load', load: 'center' }, button: null },
    ];
    expectFail(run('05', 'flat', at(495_000, 'back')), 'wrongSupport');
    expect(run('05', 'flat', at(500_000, 'back')).state.outcome?.kind).toBe('success');
    expect(run('05', 'flat', at(505_000, 'back')).state.outcome?.kind).toBe('success');
    expectFail(run('06', 'flat', at(300_000, 'front')), 'wrongSupport');
    // 05で前荷重にしても05にはならない（支持部位が逆）。
    expect(run('05', 'flat', at(1_000_000, 'front')).state.outcome?.kind).toBe('fail');
  });

  for (const id of ['07', '08', '10', '11', '13', '14']) {
    test(`${id}: 一方の軸だけ終えても失敗`, () => {
      const l = TRICK_LAB_LESSONS.find((x) => x.id === id)!;
      expectFail(run(id, 'flat', withSetup(demo(id), { ...l.demoSetup, flip: 'none' })), 'wrongRotation');
    });
  }

  test('09: 水平0°・BS270°・符号逆は失敗', () => {
    for (const dogYaw of [0, -270, 360]) {
      expectFail(run('09', 'flat', withSetup(demo('09'), { dogYaw, flip: 'kick' })), 'wrongRotation');
    }
  });

  test('12: 犬と人の差が180°になった時点で受けて成功。人90°で受けると失敗', () => {
    const d = run('12', 'flat', demo('12'));
    expect(d.state.outcome?.kind).toBe('success');
    const c = d.state.events.find((e) => e.kind === 'catch')!;
    expect(Number(c.data?.remainDeg)).toBeLessThanOrEqual(15);
    expectFail(run('12', 'flat', withSetup(demo('12'), { dogYaw: -360, riderYaw: -90 })), 'wrongRotation');
    // 足し合わせた値（犬だけ540°）では合格させない。
    expectFail(run('12', 'flat', withSetup(demo('12'), { dogYaw: -540, riderYaw: 0 })), 'wrongRotation');
  });

  test('13: 着地してから回り足した分は数えない（回りきる前に着地すると失敗）', () => {
    // 回転が480ミリ秒かかるため、0.20 mの段差から落ちて早く着地すると回りきらない。
    const steps: LabDemoStep[] = [
      { at: 0, action: { type: 'setup', setup: { dogYaw: 180, riderYaw: 180, flip: 'kick' } }, button: null },
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 1_060_000, action: { type: 'pop' }, button: 'pop' },
    ];
    const d = run('13', 'stairs', steps.map((s) => (s.action.type === 'pop' ? s : s)));
    expect(d.state.outcome?.kind).toBe('fail');
  });

  test('15〜24: 寄せずに跳ぶと縁に乗れず失敗。支える部位が違えば失敗', () => {
    for (const id of ['15', '16', '17', '18', '19', '20', '21', '22', '23', '24']) {
      const l = TRICK_LAB_LESSONS.find((x) => x.id === id)!;
      const d = run(id, l.fixtureIds[0], without(demo(id), 'aim'));
      expect(d.state.outcome?.kind, id).toBe('fail');
    }
    // 20を中央荷重で乗ると前後のパッド（50-50）になる。
    expectFail(run('20', 'rail', without(demo('20', 'rail'), 'load')), 'wrongSupport');
    // 16で前荷重にすると前端の裏で支える（ノーズスライド）。
    const nose = [...demo('16', 'rail'), { at: { after: 'takeoff' as const, delayUs: 150_000 }, action: { type: 'load' as const, load: 'front' as const }, button: null }];
    expectFail(run('16', 'rail', nose), 'wrongSupport');
  });

  test('16・19: 越える側のパッドが逆なら失敗', () => {
    expectFail(run('16', 'rail', withSetup(demo('16', 'rail'), { dogYaw: -90, exitMotion: 'revert' })), 'wrongOrder');
    expectFail(run('19', 'rail', withSetup(demo('19', 'rail'), { dogYaw: -90, exitMotion: 'revert' })), 'wrongOrder');
  });

  test('22: 斜め45°で1 m以上滑ると成功し、0°・90°では失敗', () => {
    expect(run('22', 'rail', demo('22', 'rail')).state.outcome?.kind).toBe('success');
    expect(run('22', 'rail', withSetup(demo('22', 'rail'), { dogYaw: 0, tilt: 'down', exitMotion: 'revert' })).state.outcome?.kind).toBe('fail');
    expect(run('22', 'rail', withSetup(demo('22', 'rail'), { dogYaw: 90, tilt: 'down', exitMotion: 'revert' })).state.outcome?.kind).toBe('fail');
  });

  test('16: 縁から降りるときに向きを戻さないと着地で失敗', () => {
    expectFail(run('16', 'rail', withSetup(demo('16', 'rail'), { dogYaw: 90 })), 'wrongRotation');
  });

  test('25: 前荷重にしないまま縁を離れると失敗', () => {
    const steps: LabDemoStep[] = [
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 300_000, action: { type: 'exit' }, button: 'exit' },
    ];
    expectFail(run('25', 'ramp', steps), 'unstableLanding');
  });

  test('26〜30: 減速せずに上ると縁を飛び越えて失敗（上り4.45 m/sでは止まらない）', () => {
    for (const id of ['26', '27', '28', '29', '30']) {
      const d = run(id, 'ramp', without(demo(id), 'brake'));
      expectFail(d, 'wrongSupport');
      expect(d.state.outcome?.detail).toContain('飛び越えました');
    }
  });

  test('26: 0.20秒止まる前に下りると失敗', () => {
    const steps = demo('26').map((s) => (s.action.type === 'load' && typeof s.at !== 'number' ? { ...s, at: { after: 'supportOn' as const, delayUs: 100_000 } } : s));
    expectFail(run('26', 'ramp', steps), 'wrongOrder');
  });

  test('28・29: 回らずに抜けると後ろ向き（28）、BS半回転で抜けると前向き（29）。逆は失敗', () => {
    expectFail(run('28', 'ramp', withSetup(demo('28'), { exitMotion: 'bsHalf' })), 'wrongRotation');
    expectFail(run('29', 'ramp', withSetup(demo('29'), { exitMotion: 'straight' })), 'wrongRotation');
    // 29は支持が残る間に回し始め、回し終えてから縁を離れる。
    const d = run('29', 'ramp', demo('29'));
    const exit = d.state.events.find((e) => e.kind === 'exit')!;
    const off = d.state.events.find((e) => e.kind === 'supportOff')!;
    expect(off.atUs).toBeGreaterThan(exit.atUs + 400_000);
  });

  test('30: 片側荷重のまま縁に着くと失敗', () => {
    const steps = [{ at: 30_000, action: { type: 'load' as const, load: 'front' as const }, button: null }, ...demo('30')];
    expectFail(run('30', 'ramp', steps), 'wrongSupport');
  });

  test('31: 回転なしで縁へ下りると、前パッドが先に越えて失敗。跳ぶ位置が早すぎても失敗', () => {
    expectFail(run('31', 'ramp', withSetup(demo('31'), {})), 'wrongOrder');
    const early = demo('31').map((s) => (s.action.type === 'pop' ? { ...s, at: 100_000 } : s));
    expectFail(run('31', 'ramp', early), 'wrongSupport');
  });

  test('32〜38: 手か持ち手が違えば失敗', () => {
    expectFail(run('32', 'kicker', withSetup(demo('32'), { hand: 'back', handle: 'nose' })), 'wrongSupport');
    expectFail(run('33', 'kicker', withSetup(demo('33'), { hand: 'front', handle: 'tail' })), 'wrongSupport');
    expectFail(run('34', 'kicker', withSetup(demo('34'), { hand: 'back', handle: 'toe' })), 'wrongSupport');
    expectFail(run('37', 'kicker', withSetup(demo('37'), { hand: 'front', handle: 'toe' })), 'wrongSupport');
    expectFail(run('38', 'kicker', withSetup(demo('38'), { hand: 'front', handle: 'toe' })), 'wrongSupport');
  });

  test('32〜34・37・38: 短すぎる保持と、着地時までの保持は失敗', () => {
    const short = demo('34').map((s) => (s.action.type === 'release' ? { ...s, at: { after: 'grabReach' as const, delayUs: 50_000 } } : s));
    expectFail(run('34', 'kicker', short), 'earlyRelease');
    expectFail(run('34', 'kicker', without(demo('34'), 'release')), 'wrongOrder');
  });

  test('37: 地上で150ミリ秒持った後に空中で5ミリ秒だけ持つ例は失敗', () => {
    const steps: LabDemoStep[] = [
      { at: 0, action: { type: 'setup', setup: { hand: 'back', handle: 'toe' } }, button: null },
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 300_000, action: { type: 'grab' }, button: 'grab' },
      { at: { after: 'grabReach', delayUs: 150_000 }, action: { type: 'pop' }, button: 'pop' },
      { at: { after: 'takeoff', delayUs: 5_000 }, action: { type: 'release' }, button: 'grab' },
    ];
    const d = run('37', 'flat', steps);
    expectFail(d, 'earlyRelease');
  });

  test('35: 地面への足着きが手の保持より先なら失敗。36: 手で持つと失敗、前足を着かないと失敗', () => {
    const plantFirst: LabDemoStep[] = [
      { at: 0, action: { type: 'setup', setup: { hand: 'back', handle: 'toe' } }, button: null },
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 300_000, action: { type: 'plant' }, button: 'plant' },
      { at: 450_000, action: { type: 'grab' }, button: 'grab' },
      { at: { after: 'grabReach', delayUs: 30_000 }, action: { type: 'pop' }, button: 'pop' },
      { at: { after: 'takeoff', delayUs: 200_000 }, action: { type: 'catch' }, button: 'catch' },
      { at: { after: 'catch', delayUs: 150_000 }, action: { type: 'release' }, button: 'grab' },
    ];
    expectFail(run('35', 'flat', plantFirst), 'wrongOrder');
    const withGrab: LabDemoStep[] = [
      { at: 0, action: { type: 'setup', setup: { dogYaw: 180, riderYaw: 180, hand: 'back', handle: 'toe' } }, button: null },
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 200_000, action: { type: 'grab' }, button: 'grab' },
      ...demo('36').filter((s) => s.action.type !== 'setup' && s.action.type !== 'start'),
      { at: { after: 'catch', delayUs: 100_000 }, action: { type: 'release' }, button: 'grab' },
    ];
    expectFail(run('36', 'flat', withGrab), 'wrongSupport');
    const noPlant: LabDemoStep[] = [
      { at: 0, action: { type: 'setup', setup: { dogYaw: 180, riderYaw: 180 } }, button: null },
      { at: 0, action: { type: 'start' }, button: 'start' },
      { at: 600_000, action: { type: 'pop' }, button: 'pop' },
    ];
    expectFail(run('36', 'flat', noPlant), 'wrongOrder');
  });
});

describe('ボタン操作（つかむ・はなす）と入力の扱い', () => {
  test('届かない持ち手へ手を伸ばすと「つかむ」に戻り、伸ばしている間の再タップは受け付けない', () => {
    const st = createLabAttempt({ attemptId: 'g', lessonId: '32', fixtureId: 'kicker', stance: 'regular', dogId: 'shiba' });
    const inputs: LabInput[] = [
      { attemptId: 'g', atUs: 0, seq: 1, action: { type: 'setup', setup: { hand: 'front', handle: 'tail' } } },
      { attemptId: 'g', atUs: 0, seq: 2, action: { type: 'start' } },
    ];
    advanceLab(st, 2_200_000, inputs);
    expect(st.phase).toBe('air');
    const t = st.timeUs;
    const more: LabInput[] = [
      { attemptId: 'g', atUs: t, seq: 3, action: { type: 'grab' } },
      { attemptId: 'g', atUs: t + 50_000, seq: 4, action: { type: 'grab' } },
    ];
    advanceLab(st, t + 60_000, more);
    expect(st.hand.state).toBe('reaching');
    expect(st.events.some((e) => e.kind === 'ignored' && e.data?.action === 'grab')).toBe(true);
    advanceLab(st, t + 200_000, more);
    expect(st.hand.state).toBe('idle');
    expect(st.events.some((e) => e.kind === 'grabMiss')).toBe(true);
  });

  test('届いた後は保持が続き、「はなす」を押すまで別の操作を順に行える', () => {
    const d = run('35', 'flat', demo('35'));
    const kinds = d.state.events.map((e) => e.kind);
    const reach = kinds.indexOf('grabReach');
    const release = kinds.indexOf('release');
    expect(reach).toBeGreaterThan(-1);
    for (const k of ['plantContact', 'takeoff', 'catch'] as const) {
      const i = kinds.indexOf(k);
      expect(i).toBeGreaterThan(reach);
      expect(i).toBeLessThan(release);
    }
    // 押した時刻と届いた時刻を分けて持つ。
    const g = d.state.grabs[0];
    expect(g.reachUs! - g.pressUs).toBe(150_000);
  });

  test('成功後に同じ入力や着地を重ねても成功は1回のまま', () => {
    const d = run('01', 'flat', demo('01'));
    const before = d.state.events.filter((e) => e.kind === 'success').length;
    advanceLab(d.state, 12_000_000, [{ attemptId: d.state.attemptId, atUs: d.state.timeUs, seq: 999, action: { type: 'pop' } }]);
    expect(d.state.events.filter((e) => e.kind === 'success').length).toBe(before);
    expect(before).toBe(1);
  });

  test('別の試行の入力と、適用済みの組は捨てる', () => {
    const st = createLabAttempt({ attemptId: 'a1', lessonId: '01', fixtureId: 'flat', stance: 'regular', dogId: 'shiba' });
    advanceLab(st, 100_000, [{ attemptId: 'old', atUs: 0, seq: 1, action: { type: 'start' } }]);
    expect(st.phase).toBe('ready');
    const start: LabInput = { attemptId: 'a1', atUs: 100_000, seq: 1, action: { type: 'start' } };
    advanceLab(st, 200_000, [start]);
    advanceLab(st, 300_000, [start]);
    expect(st.events.filter((e) => e.kind === 'start').length).toBe(1);
  });

  test('準備は止まっている間だけ選べる', () => {
    const st = createLabAttempt({ attemptId: 'a', lessonId: '02', fixtureId: 'flat', stance: 'regular', dogId: 'shiba' });
    advanceLab(st, 100_000, [
      { attemptId: 'a', atUs: 0, seq: 1, action: { type: 'start' } },
      { attemptId: 'a', atUs: 50_000, seq: 2, action: { type: 'setup', setup: { flip: 'kick' } } },
    ]);
    expect(st.setup.flip).toBe('none');
  });

  test('スワイプ（短辺の10%）と「左」「右」は同じ移動量を送る', () => {
    expect(aimFromSwipe(0.1)).toBe(AIM_STEP_M);
    expect(aimFromSwipe(-0.1)).toBe(-AIM_STEP_M);
  });

  test('描画の間隔（8・16・33ミリ秒）を変えても、同じ入力なら同じ出来事・結果になる', () => {
    const ref = run('29', 'ramp', demo('29'));
    const inputs = ref.inputs.map(({ button: _b, ...i }) => i);
    for (const frameUs of [8_000, 16_000, 33_000]) {
      const st = createLabAttempt({ attemptId: ref.state.attemptId, lessonId: '29', fixtureId: 'ramp', stance: 'regular', dogId: 'shiba' });
      for (let t = 0; t <= 9_000_000 && !st.outcome; t += frameUs) advanceLab(st, t, inputs);
      expect(st.events).toEqual(ref.state.events);
      expect(st.outcome).toEqual(ref.state.outcome);
    }
  });

  test('構えを鏡に映し、横の操作も鏡に映すと成功。横だけ逆にすると失敗', () => {
    const mirrored = demo('16', 'rail').map((s) => (s.action.type === 'aim' ? { ...s, action: { type: 'aim' as const, dx: -s.action.dx } } : s));
    expect(run('16', 'rail', mirrored, 'goofy').state.outcome?.kind).toBe('success');
    expect(run('16', 'rail', demo('16', 'rail'), 'goofy').state.outcome?.kind).toBe('fail');
    expect(run('02', 'flat', demo('02'), 'goofy').state.outcome?.kind).toBe('success');
  });

  test('すべての操作は時刻付きの入力として残り、お手本の操作列から同じ結果を再現できる', () => {
    for (const l of TRICK_LAB_LESSONS) {
      const f = l.fixtureIds[0];
      const ref = run(l.id, f, labDemo(l, f));
      const st = createLabAttempt({ attemptId: ref.state.attemptId, lessonId: l.id, fixtureId: f, stance: 'regular', dogId: 'shiba' });
      advanceLab(st, 9_000_000, ref.inputs);
      expect(st.outcome?.kind, l.id).toBe('success');
    }
  });
});
