const BPM = 156;
const SAMPLE_RATE = 22_050;
const SIXTEENTH = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const BEAT = SIXTEENTH * 4;
const TAU = Math.PI * 2;

const VERSE = [
  { chord: [45, 57, 60, 64], lead: [[0, 76], [3, 79], [6, 81], [8, 76], [10, 74], [14, 72]] },
  { chord: [41, 53, 57, 60], lead: [[0, 72], [4, 77], [7, 76], [10, 72], [12, 69], [14, 72]] },
  { chord: [48, 60, 64, 67], lead: [[0, 76], [2, 79], [6, 84], [8, 79], [12, 76], [14, 74]] },
  { chord: [43, 55, 59, 62], lead: [[0, 74], [3, 71], [6, 74], [8, 79], [11, 77], [14, 74]] },
  { chord: [45, 57, 60, 64], lead: [[0, 76], [2, 81], [6, 84], [9, 83], [11, 81], [14, 79]] },
  { chord: [41, 53, 57, 60], lead: [[0, 77], [4, 81], [6, 79], [8, 76], [12, 77], [14, 72]] },
  { chord: [48, 60, 64, 67], lead: [[0, 76], [3, 79], [6, 84], [8, 88], [11, 86], [14, 84]] },
  { chord: [43, 55, 59, 62], lead: [[0, 83], [2, 79], [6, 77], [8, 74], [11, 71], [14, 74]] },
] as const;

/** シンセ、ベース、ドラムの8小節を一度だけ音声バッファに合成する。 */
function createRaceTrack(ctx: AudioContext): AudioBuffer {
  const samples = ctx.createBuffer(1, Math.round(VERSE.length * STEPS_PER_BAR * SIXTEENTH * SAMPLE_RATE), SAMPLE_RATE);
  const channel = samples.getChannelData(0);
  let seed = 32891;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  const add = (step: number, length: number, voice: (time: number) => number) => {
    const start = Math.round(step * SIXTEENTH * SAMPLE_RATE);
    const count = Math.round(length * SAMPLE_RATE);
    for (let i = 0; i < count; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, t / 0.005) * (1 - i / count) ** 2;
      channel[(start + i) % channel.length] += voice(t) * envelope;
    }
  };
  const note = (step: number, midi: number, length: number, gain: number, overtone: number) => {
    const phase = TAU * 440 * 2 ** ((midi - 69) / 12);
    add(step, length, t => gain * (Math.sin(phase * t) + overtone * Math.sin(phase * 2 * t)));
  };

  for (const [bar, { chord, lead }] of VERSE.entries()) {
    const first = bar * STEPS_PER_BAR;
    for (const tick of [0, 4, 8, 12]) {
      add(first + tick, 0.15, t => 0.56 * Math.sin(TAU * (48 * t + 1.9 * (1 - Math.exp(-32 * t)))));
    }
    for (const tick of [4, 12]) {
      add(first + tick, 0.12, t => 0.23 * noise() + 0.10 * Math.sin(TAU * 172 * t));
    }
    for (let tick = 0; tick < STEPS_PER_BAR; tick += 2) {
      let previous = 0;
      add(first + tick, tick % 4 === 2 ? 0.062 : 0.037, () => {
        const sample = noise();
        const high = sample - previous;
        previous = sample;
        return 0.068 * high;
      });
    }
    for (const [tick, semi] of [[0, 0], [3, 0], [6, 12], [8, 0], [11, 7], [14, 12]]) {
      note(first + tick, chord[0] + semi, BEAT * 0.6, 0.28, 0.25);
    }
    for (const tick of [2, 6, 10, 14]) {
      for (const midi of chord.slice(1)) note(first + tick, midi + 12, BEAT * 0.54, 0.045, 0.24);
    }
    for (const [tick, midi] of lead) note(first + tick, midi, BEAT * 0.62, 0.13, 0.22);
  }
  return samples;
}

export class RaceMusic {
  private track: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private volume = 0;

  update(ctx: AudioContext, destination: AudioNode, volume: number): void {
    if (volume <= 0 || ctx.state !== 'running') {
      this.stop(false);
      return;
    }
    const now = ctx.currentTime;
    if (!this.source) {
      this.track ??= createRaceTrack(ctx);
      if (this.gain?.context !== ctx) {
        this.gain = ctx.createGain();
        this.gain.connect(destination);
      }
      this.gain.gain.value = 0;
      const source = ctx.createBufferSource();
      source.buffer = this.track;
      source.loop = true;
      source.connect(this.gain);
      source.start(0, this.offset);
      this.startedAt = ctx.currentTime;
      this.source = source;
    }
    if (this.volume !== volume) {
      this.gain!.gain.setTargetAtTime(volume * 0.31, now, 0.04);
      this.volume = volume;
    }
  }

  stop(reset: boolean): void {
    const source = this.source;
    if (source) {
      this.offset = (this.offset + source.context.currentTime - this.startedAt) % source.buffer!.duration;
      source.stop();
      source.disconnect();
      this.source = null;
      this.volume = 0;
    }
    if (reset) this.offset = 0;
  }
}
