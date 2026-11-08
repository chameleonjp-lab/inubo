import type { DogSpec } from '../content/types';
import { advanceRun, createRun } from '../game/run';
import { solidTop, type CourseRt } from '../game/track';
import type { GestureFact, RunIdentity, SimEvent, SimState } from '../game/types';
import { GestureRecognizer } from '../input/gestures';

/**
 * 練習広場の手順。時間を競わず、左右 → ジャンプ → 犬だけの円 → 体ごとの直線 → 複合技 の順に、
 * 手本（指の動き）と自分の軌跡を見比べる。いつでも次へ進む・やめる・本番へ進むことができる。
 * 練習の走行は記録を作らない（mode: 'practice'）。
 */

export type PracticeStepId = 'lateral' | 'jump' | 'dog' | 'body' | 'composite';

export interface PracticeStep {
  id: PracticeStepId;
  title: string;
  hint: string;
  /** 失敗したときの短い助言（E10）。 */
  retry: string;
}

export const PRACTICE_STEPS: PracticeStep[] = [
  {
    id: 'lateral',
    title: '1. 左右に動く',
    hint: '地面にいるとき、丸印から点線に沿って払うと横へ動きます。左と右の両方を試しましょう。',
    retry: '指を横にすべらせてみましょう。',
  },
  {
    id: 'jump',
    title: '2. ジャンプ',
    hint: '点線に沿って上へ払うと、指を離す前に跳びます。オレンジの踏切台からは高く跳べます。',
    retry: 'もう少し長く、上へまっすぐ払いましょう。',
  },
  {
    id: 'dog',
    title: '3. 犬だけを回す（円）',
    hint: '跳んだらいったん指を離し、空中でもう一度触れて円をなぞります。円が閉じると犬だけが回ります。',
    retry: 'もう少し大きく円を描いて、始めた所まで戻しましょう。',
  },
  {
    id: 'body',
    title: '4. 体ごと回す（直線）',
    hint: '跳んだらいったん指を離し、空中でもう一度触れて直線をなぞります。指を離すと、人と犬が一緒に回ります。',
    retry: 'まっすぐ線を引いて、指を離しましょう。',
  },
  {
    id: 'composite',
    title: '5. 複合技（円＋直線）',
    hint: '跳んだら指を離し、空中で2本の指を置き直して円と直線をなぞります。1本なら、円を閉じたあと続けて直線を引いて離します。',
    retry: '円を閉じたら、すぐに線を引いて離しましょう。',
  },
];

export type PracticePoint = readonly [number, number];

interface DemoStroke {
  points: readonly PracticePoint[];
  startUs: number;
  durationUs: number;
  color: string;
}

const GOLD = '#ffd34f';
const BLUE = '#83e2ff';
const AIR_STROKE_START_US = 550_000;

function line(a: PracticePoint, b: PracticePoint, startUs: number, durationUs: number, color = GOLD): DemoStroke {
  const points = Array.from({ length: 17 }, (_, i): PracticePoint => [a[0] + (b[0] - a[0]) * i / 16, a[1] + (b[1] - a[1]) * i / 16]);
  return { points, startUs, durationUs, color };
}

function circle(cx: number, cy: number, r: number): DemoStroke {
  const points = Array.from({ length: 25 }, (_, i): PracticePoint => {
    const a = Math.PI / 2 + i * Math.PI / 12;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  return { points, startUs: AIR_STROKE_START_US, durationUs: 350_000, color: GOLD };
}

const JUMP_STROKE = line([0.23, 0.18], [0.23, -0.12], 180_000, 340_000);
const DEMO_STROKES: Record<PracticeStepId, readonly DemoStroke[]> = {
  lateral: [line([0.15, -0.02], [-0.13, -0.02], 180_000, 320_000), line([-0.23, 0.16], [0.30, 0.16], 900_000, 370_000)],
  jump: [JUMP_STROKE],
  dog: [JUMP_STROKE, circle(-0.12, 0.02, 0.13)],
  body: [JUMP_STROKE, line([-0.16, 0.18], [-0.16, -0.13], AIR_STROKE_START_US, 350_000)],
  composite: [JUMP_STROKE, circle(-0.21, 0.02, 0.11), line([0.20, 0.18], [0.20, -0.13], AIR_STROKE_START_US, 350_000, BLUE)],
};

/** 地面では踏切の線、空中では指を置き直して描く形を出す。 */
export function practiceGuide(step: PracticeStepId, airborne: boolean): readonly DemoStroke[] {
  const strokes = DEMO_STROKES[step];
  if (step === 'lateral') return airborne ? [] : strokes;
  return airborne ? strokes.slice(1) : DEMO_STROKES.jump;
}

/** 見せる座標そのものを、プレイヤーと同じ指の判定に通す。 */
function recognizedStrokes(strokes: readonly DemoStroke[]): GestureFact[] {
  const recognizer = new GestureRecognizer();
  recognizer.setViewport(1, 1);
  const samples = strokes.flatMap((stroke, i) => stroke.points.map(([x, y], j) => ({
    pointer: i + 1, x, y, atUs: Math.round(stroke.startUs + stroke.durationUs * j / (stroke.points.length - 1)),
    first: j === 0, last: j === stroke.points.length - 1,
  })));
  return samples.sort((a, b) => a.atUs - b.atUs).flatMap(({ pointer, x, y, atUs, first, last }) => (
    first ? recognizer.pointerDown(pointer, x, y, atUs)
      : last ? recognizer.pointerUp(pointer, x, y, atUs) : recognizer.pointerMove(pointer, x, y, atUs)
  ));
}

/** ふだんの走行を進めず、短い別の走行を使ってお手本を1回だけ再生する。 */
export class PracticeDemo {
  readonly state: SimState;
  readonly durationUs = 2_300_000;
  elapsedUs = 0;
  private readonly strokes: readonly DemoStroke[];
  private jumped = false;
  private caption = '';

  constructor(readonly step: PracticeStepId, identity: RunIdentity, course: CourseRt, dog: DogSpec) {
    this.state = createRun({ ...identity, runId: `${identity.runId}:demo`, mode: 'practice', playerName: '', participantId: null, rankingOptIn: false }, course, dog);
    if (step !== 'lateral') {
      const path = course.paths.get(course.start.pathId)!;
      const ramp = path.solids.find((s) => s.kind === 'kicker');
      if (ramp) {
        this.state.s = ramp.s0 + 0.15;
        this.state.y = solidTop(path, ramp, this.state.s, 0);
      }
    }
    this.strokes = DEMO_STROKES[step];
    advanceRun(this.state, 0, recognizedStrokes(this.strokes));
  }

  get done(): boolean {
    return this.elapsedUs >= this.durationUs;
  }

  get status(): string {
    if (this.caption) return this.caption;
    if (this.step === 'lateral') return 'お手本：左へ、次に右へ払う';
    if (!this.jumped) return 'お手本：踏切台で上へ払う';
    if (this.step === 'jump' || this.elapsedUs < AIR_STROKE_START_US) return 'お手本：上払いでジャンプ';
    if (this.step === 'dog') return 'お手本：空中で円を閉じる';
    if (this.step === 'body') return 'お手本：空中で線を引いて指を離す';
    return 'お手本：空中で円と直線を描く';
  }

  get traces(): (DemoStroke & { progress: number })[] {
    const showsTrick = this.step !== 'jump' && this.step !== 'lateral';
    return this.strokes.flatMap((stroke, i) => {
      if (this.elapsedUs < stroke.startUs - 180_000 || (showsTrick && i === 0 && this.elapsedUs >= AIR_STROKE_START_US)) return [];
      return [{ ...stroke, progress: Math.max(0, Math.min(1, (this.elapsedUs - stroke.startUs) / stroke.durationUs)) }];
    });
  }

  advanceTo(atUs: number): SimEvent[] {
    this.elapsedUs = Math.round(Math.max(this.elapsedUs, Math.min(this.durationUs, atUs)));
    const { events } = advanceRun(this.state, this.elapsedUs);
    for (const e of events) {
      if (e.kind === 'jump' && this.step !== 'lateral') {
        this.jumped = true;
      } else if (e.kind === 'trickStart') {
        this.caption = this.step === 'composite' ? 'お手本：犬の回転と体ごとの回転が同時に始まる' : e.data?.channel === 'dog' ? 'お手本：円が閉じたので、犬だけが回る' : 'お手本：線を引いて指を離すと、人と犬が回る';
      } else if (e.kind === 'land' && this.step !== 'lateral') this.caption = 'お手本：着地';
    }
    return events;
  }
}

export class PracticeCoach {
  index = 0;
  private sawLeft = false;
  private sawRight = false;
  private startX: number | null = null;
  completed: PracticeStepId[] = [];
  lastHint: string | null = null;

  get step(): PracticeStep {
    return PRACTICE_STEPS[Math.min(this.index, PRACTICE_STEPS.length - 1)];
  }

  get done(): boolean {
    return this.index >= PRACTICE_STEPS.length;
  }

  next(): void {
    if (this.index < PRACTICE_STEPS.length) this.index++;
    this.sawLeft = this.sawRight = false;
    this.startX = null;
    this.lastHint = null;
  }

  /** 走行の出来事から、今の手順ができたかを判定する。できたら true（次の手順へ進む）。 */
  observe(events: SimEvent[], run: SimState): boolean {
    if (this.done) return false;
    const st = this.step;
    let ok = false;
    if (st.id === 'lateral') {
      if (this.startX === null) this.startX = run.x;
      if (run.x < this.startX - 1.2) this.sawLeft = true;
      if (run.x > this.startX + 1.2) this.sawRight = true;
      ok = this.sawLeft && this.sawRight;
    }
    for (const e of events) {
      if (st.id === 'jump' && e.kind === 'jump' && e.data?.viaSwipe) ok = true;
      if (e.kind === 'land' && !e.data?.plain && Number(e.data?.tenths ?? 0) > 0) {
        const names = Array.isArray(e.data?.names) ? (e.data!.names as string[]) : [];
        const hasDog = names.some((n) => n.startsWith('犬'));
        const hasBody = names.some((n) => !n.startsWith('犬'));
        if (st.id === 'dog' && hasDog) ok = true;
        if (st.id === 'body' && hasBody) ok = true;
        if (st.id === 'composite' && e.data?.composite) ok = true;
      }
      if (e.kind === 'trickReject' && e.data?.air) this.lastHint = st.retry;
      if (e.kind === 'landFail') this.lastHint = st.id === 'composite' ? st.retry : '回転が足りませんでした。跳んだらすぐ描くか、踏切台から跳びましょう。';
    }
    if (ok) {
      this.completed.push(st.id);
      this.next();
    }
    return ok;
  }
}
