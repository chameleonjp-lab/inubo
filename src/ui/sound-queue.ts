/**
 * 確認版で着地音を順に鳴らす予約（Q05）。状態をはっきり持ち、止めたら予約を全部取り消す。
 * 止めたあとは、ボタンで始め直すまで自動では再開しない。
 */
export type SoundQueueState = 'idle' | 'playing' | 'stopped';

export class SoundQueue {
  state: SoundQueueState = 'idle';
  /** 直前に鳴らした音の番号（0始まり）。まだなら -1。 */
  index = -1;
  /** 止めた理由（消音・やり直し・停止・画面を離れた など）。 */
  reason = '';
  private names: readonly string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private play: (name: string, index: number) => void, private gapMs = 1_400, private onChange: () => void = () => {}) {}

  /** まだ鳴らしていない予約の数（0 か 1。次の1つだけを予約する）。 */
  get pending(): number {
    return this.timer === null ? 0 : 1;
  }
  get current(): string | null {
    return this.index >= 0 ? this.names[this.index] ?? null : null;
  }
  get total(): number {
    return this.names.length;
  }

  start(names: readonly string[]): void {
    this.cancel();
    this.names = names.slice();
    this.index = -1;
    this.reason = '';
    this.state = names.length ? 'playing' : 'idle';
    if (this.state === 'playing') this.next();
    this.onChange();
  }

  stop(reason: string): void {
    if (this.state !== 'playing' && this.timer === null) return;
    this.cancel();
    this.state = 'stopped';
    this.reason = reason;
    this.onChange();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private next(): void {
    this.timer = null;
    this.index++;
    if (this.index >= this.names.length) {
      this.state = 'idle';
      this.onChange();
      return;
    }
    this.play(this.names[this.index], this.index);
    this.timer = setTimeout(() => this.next(), this.gapMs);
    this.onChange();
  }
}
