import { describe, expect, test } from 'vitest';
import {
  GAP,
  LAB_FIXTURES,
  RAMP_RADIUS,
  RAMP_TOP_HEIGHT,
  RAMP_TOP_Q,
  STAIRS,
  labEdge,
  rampPoint,
  sampleLabSurface,
} from '../src/game/trick-lab-terrain';
import { GRAVITY, RAIL_HALF_WIDTH } from '../src/game/rules';
import { LAB_RAMP_SPEED, LabDemoRunner, RAMP_LOCK_SPEED } from '../src/game/trick-lab';
import { TRICK_LAB_LESSONS, labDemo } from '../src/content/trick-lab';

/** 練習地形の形と、縁・ランプでの接触の順（T3）。 */

describe('練習地形', () => {
  test('階段は高さ0.20 mの踏み面が別の面として並び、下に平らな着地帯がある', () => {
    expect(sampleLabSurface('stairs', 1)!.height).toBeCloseTo(STAIRS.topHeight);
    const a = sampleLabSurface('stairs', STAIRS.s0 + 0.1)!;
    const b = sampleLabSurface('stairs', STAIRS.s0 + STAIRS.tread + 0.1)!;
    expect(a.height - b.height).toBeCloseTo(0.2);
    expect(a.surfaceId).not.toBe(b.surfaceId);
    expect(sampleLabSurface('stairs', 9)!.height).toBe(0);
  });

  test('ギャップの開口部には着地面がない（幅1.20 m）', () => {
    expect(sampleLabSurface('gap', GAP.s0 - 0.01)).not.toBeNull();
    expect(sampleLabSurface('gap', GAP.s0 + 0.6)).toBeNull();
    expect(sampleLabSurface('gap', GAP.s0 + GAP.width)).not.toBeNull();
  });

  test('坂は15%の下り、踏切台は長さ4.0 m・上端0.60 m', () => {
    expect(sampleLabSurface('slope', 5)!.grade).toBeCloseTo(-0.15);
    expect(sampleLabSurface('kicker', 6.99)!.height).toBeCloseTo(0.6, 2);
  });

  test('縁石0.35 m・レール0.50 m、長さ3.0 m。進入側に合わせて左右へ置ける', () => {
    const r = labEdge('rail', 1)!;
    const l = labEdge('rail', -1)!;
    expect(r.top).toBe(0.5);
    expect(r.s1 - r.s0).toBeCloseTo(3);
    expect(r.x).toBe(-l.x);
    expect(r.halfWidth).toBe(RAIL_HALF_WIDTH);
    expect(labEdge('curb', 1)!.top).toBe(0.35);
    expect(labEdge('flat', 1)).toBeNull();
  });

  test('曲面ランプは半径2.4 m・上端70°。位置は 2.4×sin(a)、高さは 2.4×(1−cos(a))', () => {
    const p = rampPoint(RAMP_RADIUS * 0.5);
    expect(p.s).toBeCloseTo(2.4 * Math.sin(0.5));
    expect(p.y).toBeCloseTo(2.4 * (1 - Math.cos(0.5)));
    expect(rampPoint(RAMP_TOP_Q).angle).toBeCloseTo((70 * Math.PI) / 180);
    expect(LAB_FIXTURES.ramp.kind).toBe('ramp');
  });

  test('上りの初速8 m/sのままでは、縁で約4.45 m/sが残り、止まれる速さを越える', () => {
    const v = Math.sqrt(LAB_RAMP_SPEED ** 2 - 2 * GRAVITY * RAMP_TOP_HEIGHT);
    expect(v).toBeCloseTo(4.45, 1);
    expect(v).toBeGreaterThan(RAMP_LOCK_SPEED);
  });
});

describe('縁とランプの接触の順', () => {
  const lesson = (id: string) => TRICK_LAB_LESSONS.find((l) => l.id === id)!;

  test('16: 前パッドが反対側へ越えた状態で中央裏が支える。支持の後に降りる', () => {
    const d = new LabDemoRunner({ attemptId: 'x', lessonId: '16', fixtureId: 'rail', stance: 'regular', dogId: 'corgi' });
    d.advanceTo(9_000_000);
    const on = d.state.events.find((e) => e.kind === 'supportOn')!;
    expect(on.data).toMatchObject({ part: 'center', angle: 'perpendicular', crossed: 'frontPad' });
    const sup = d.state.supports[0];
    expect(sup.distance).toBeGreaterThanOrEqual(1);
    const top = d.state.contacts.find((c) => c.face === 'top' && c.obstacleId === 'rail-1')!;
    expect(top.endUs).not.toBeNull();
  });

  test('28と31: 28は前パッド、31は回し終えてから後パッドが台側へ越える', () => {
    const rock = new LabDemoRunner({ attemptId: 'r', lessonId: '28', fixtureId: 'ramp', stance: 'regular', dogId: 'shiba' });
    rock.advanceTo(9_000_000);
    expect(rock.state.supports[0].crossed).toEqual(['frontPad']);
    const dis = new LabDemoRunner({ attemptId: 'd', lessonId: '31', fixtureId: 'ramp', stance: 'regular', dogId: 'shiba' });
    dis.advanceTo(9_000_000);
    expect(dis.state.supports[0].crossed).toEqual(['rearPad']);
    const pop = dis.state.events.find((e) => e.kind === 'pop')!;
    const on = dis.state.events.find((e) => e.kind === 'supportOn')!;
    // 回転（480ミリ秒）が終わってから縁に掛かる。
    expect(on.atUs - pop.atUs).toBeGreaterThanOrEqual(480_000);
  });

  test('ランプでは、上り下りと縁に沿う速さがどちらも止まってから停止を数える', () => {
    const d = new LabDemoRunner({ attemptId: 's', lessonId: '26', fixtureId: 'ramp', stance: 'regular', dogId: 'whippet' });
    d.advanceTo(9_000_000);
    expect(d.state.outcome?.kind).toBe('success');
    expect(d.state.events.some((e) => e.kind === 'stall')).toBe(true);
    expect(d.state.supports[0].stillUs).toBeGreaterThanOrEqual(200_000);
  });

  test('3犬種で同じ入力なら同じ結果（犬種の体型で当たり判定が変わらない）', () => {
    for (const id of ['01', '16', '28', '34']) {
      const l = lesson(id);
      const results = (['shiba', 'corgi', 'whippet'] as const).map((dogId) => {
        const d = new LabDemoRunner({ attemptId: 'dog', lessonId: id, fixtureId: l.fixtureIds[0], stance: 'regular', dogId }, labDemo(l, l.fixtureIds[0]));
        d.advanceTo(9_000_000);
        return d.state.events;
      });
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    }
  });
});
