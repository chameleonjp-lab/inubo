import type { SimEvent, SimState } from '../game/types';

/**
 * 練習広場の手順。時間を競わず、左右 → ジャンプ → 犬だけの円 → 体ごとの直線 → 複合技 の順に、
 * 手本（指の動き）と自分の軌跡を見比べる。いつでも次へ進む・やめる・本番へ進むことができる。
 * 練習の走行は記録を作らない（mode: 'practice'）。
 */

export type PracticeStepId = 'lateral' | 'jump' | 'dog' | 'body' | 'composite';

export interface DemoStroke {
  /** 画面の短辺を 1 とした、画面中央からの相対座標の点列（y は下向き）。 */
  points: [number, number][];
  /** 2本目の指（複合の手本）。 */
  second?: [number, number][];
}

export interface PracticeStep {
  id: PracticeStepId;
  title: string;
  hint: string;
  /** 失敗したときの短い助言（E10）。 */
  retry: string;
  demo: DemoStroke;
}

function circle(cx: number, cy: number, r: number, n = 24): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export const PRACTICE_STEPS: PracticeStep[] = [
  {
    id: 'lateral',
    title: '1. 左右に動く',
    hint: '地面にいるときに左右へ払うと、払った幅の分だけ横へ動きます。左と右の両方を試しましょう。',
    retry: '指を横にすべらせてみましょう。',
    demo: { points: [[-0.25, 0.25], [0.25, 0.25]] },
  },
  {
    id: 'jump',
    title: '2. ジャンプ',
    hint: '画面の上へ払うと、指を離す前に1回跳びます。踏切台からは高く跳べます。',
    retry: 'もう少し長く、上へまっすぐ払いましょう。',
    demo: { points: [[0, 0.3], [0, 0.05]] },
  },
  {
    id: 'dog',
    title: '3. 犬だけを回す（円）',
    hint: '跳んだあと、新しい指で円を描いて閉じると犬だけが回ります。縦長の円は前後、横長や真円は横転。',
    retry: 'もう少し大きく円を描いて、始めた所まで戻しましょう。',
    demo: { points: circle(0, 0.05, 0.14) },
  },
  {
    id: 'body',
    title: '4. 体ごと回す（直線）',
    hint: '跳んだあと、新しい指でまっすぐ線を引いて離すと、人と犬が一緒に回ります。上=前宙、下=後宙、左右=ひねり。',
    retry: 'まっすぐ線を引いて、指を離しましょう。',
    demo: { points: [[0.0, 0.2], [0.0, -0.15]] },
  },
  {
    id: 'composite',
    title: '5. 複合技（円＋直線）',
    hint: '2本の指で円と線を同時に描くか、片手で円を閉じたらそのまま線を引いて、犬が回り終わる前に離します。',
    retry: '円を閉じたら、すぐに線を引いて離しましょう。',
    demo: { points: [...circle(-0.12, 0.05, 0.11), [0.12, 0.05] as [number, number]], second: [[0.2, 0.2], [0.2, -0.12]] },
  },
];

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
      if (st.id === 'jump' && e.kind === 'jump') ok = true;
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
