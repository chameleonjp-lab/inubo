import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { COURSE_DEFS, RACE_COURSES, getCourse } from '../src/content/courses/index';
import { DOGS, DOG_ORDER } from '../src/content/dogs';
import { Autopilot } from '../src/game/autopilot';
import { advanceRun } from '../src/game/run';
import { uAtS } from '../src/game/track';
import { formatTime } from '../src/ui/share';
import { RULES_VERSION } from '../src/game/rules';
import { newRun } from './helpers';
import type { SimState } from '../src/game/types';

/**
 * 自動再生の記録（P09 の「自動再生の9通り」の別表と、犬種差の区間タイムの自動測定）。
 * REPORT_OUT を指定すると Markdown に書き出す。実機の欄を埋める代わりには使わない。
 */

function drive(run: SimState, route: string, onTick?: (r: SimState) => void): SimState {
  const pilot = new Autopilot(run.course.def.autoRoutes[route]);
  let t = 0;
  while (!run.finished && t < 200_000_000) {
    advanceRun(run, (t += 5_000), pilot.poll(run));
    onTick?.(run);
  }
  return run;
}

/** 道（または分岐の道のどれか）で、背骨の距離 u0→u1 を通過した時間（秒）。 */
function segmentTime(courseId: 'park', dog: (typeof DOG_ORDER)[number], route: string, u0: number, u1: number): number {
  const run = newRun(getCourse(courseId), dog);
  let tIn: number | null = null;
  let tOut: number | null = null;
  drive(run, route, (r) => {
    const u = uAtS(r.course.paths.get(r.pathId)!, r.s);
    if (tIn === null && u >= u0) tIn = r.simUs;
    if (tOut === null && u >= u1) tOut = r.simUs;
  });
  return ((tOut ?? 0) - (tIn ?? 0)) / 1e6;
}

test('自動再生: 3 コース × 3 犬種（通常ジャンプだけ・技あり）と、犬種差の 3 区間', () => {
  const lines: string[] = [];
  const sha = process.env.REPORT_COMMIT ?? '（未記入）';
  lines.push('# 自動再生の記録（自動操縦）', '');
  lines.push(`対象コミット: ${sha}／ルール版: ${RULES_VERSION}／生成: \`npm run report\``, '');
  lines.push('自動操縦（コースのデータに書いた手順）で走らせた結果です。端末の操作感・聞こえ方の合否には使いません。実機の欄は [実機受入の記録](acceptance-record.md) に別に残します。', '');
  for (const route of ['safe', 'trick'] as const) {
    lines.push(`## ${route === 'safe' ? '技を使わない走り（通常ジャンプだけ）' : '技を使う走り'}`, '');
    lines.push('| コース（版） | 犬種 | 完走タイム | タイム点 | 技点 | 総合 | 通った道 |', '|---|---|---:|---:|---:|---:|---|');
    for (const cid of RACE_COURSES) {
      for (const dog of DOG_ORDER) {
        const course = getCourse(cid);
        const run = drive(newRun(course, dog, { courseId: cid, courseVersion: course.def.version }), route);
        expect(run.finished, `${cid} ${dog} ${route}`).toBe(true);
        const r = run.result!;
        lines.push(`| ${COURSE_DEFS[cid]!.name}（${course.def.version}） | ${DOGS[dog].name} | ${formatTime(r.recordCs)} | ${r.timeScore} | ${r.trickScore} | ${r.total} | ${r.route.join('→') || '—'} |`);
      }
    }
    lines.push('');
  }
  lines.push('## 犬種差の 3 区間（公園、同じ手順を 3 回）', '');
  lines.push('直線は公園の最初の直線（u 10→110）、急カーブは左の急カーブ（u 360→410、外側の道）、手すり分岐は「手すり道」（u 420→500、手すりを滑る）。自動操縦は同じ入力を毎回同じ時刻に出すので、3 回の値は同じになります。人の反復による差は実機で測ります。', '');
  lines.push('| 犬種 | 区間 | 1回目 | 2回目 | 3回目 | 中央値 |', '|---|---|---:|---:|---:|---:|');
  const segs: [string, string, number, number][] = [
    ['直線', 'safe', 10, 110],
    ['急カーブ', 'safe', 360, 410],
    ['手すり分岐', 'trick', 420, 500],
  ];
  const med: Record<string, Record<string, number>> = {};
  for (const dog of DOG_ORDER) {
    med[dog] = {};
    for (const [name, route, u0, u1] of segs) {
      const v = [0, 1, 2].map(() => segmentTime('park', dog, route, u0, u1));
      const m = [...v].sort((a, b) => a - b)[1];
      med[dog][name] = m;
      lines.push(`| ${DOGS[dog].name} | ${name} | ${v.map((x) => x.toFixed(2)).join(' | ')} | ${m.toFixed(2)} |`);
    }
  }
  // 直線では最高速の速いウィペットが最も短く、コーギーが最も長い。
  expect(med.whippet['直線']).toBeLessThan(med.shiba['直線']);
  expect(med.shiba['直線']).toBeLessThan(med.corgi['直線']);
  lines.push('');
  if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT, lines.join('\n') + '\n');
});
