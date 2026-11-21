import type { DogEffectColors } from '../content/dog-effects';
import type { FxTarget } from '../view/trick-fx';

type Point = { x: number; y: number };
type Air = { target: FxTarget; level: number; combo: number };
type Landing = { target: FxTarget; level: number; point: Point; at: number };

const TAU = 2 * Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const noise = (i: number) => ((i * 0.61803398875) % 1 + 1) % 1;

export class TrickImpact {
  private readonly g: CanvasRenderingContext2D | null;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private time = 0;
  private land: Landing | null = null;
  private drawn = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly colors: DogEffectColors) {
    this.g = canvas.getContext('2d');
  }

  landAt(target: FxTarget, level: number, point: Point): void {
    this.land = { target, level, point, at: this.time };
  }

  frame(width: number, height: number, dtMs: number, weak: boolean, air: Air | null, pivot: Point): void {
    const g = this.g;
    if (!g || !width || !height) return;
    this.time += dtMs;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.land && this.time - this.land.at > 350 + this.land.level * 42) this.land = null;
    const phase = this.land && air ? 'both' : this.land ? 'landing' : air ? 'air' : 'none';
    if (this.canvas.dataset.phase !== phase) this.canvas.dataset.phase = phase;
    if (this.drawn) g.clearRect(0, 0, width, height);
    this.drawn = phase !== 'none' && !this.reduced.matches;
    if (!this.drawn) return;
    const alpha = weak ? 0.38 : 1;
    if (this.land) this.drawLanding(g, width, height, this.land, alpha);
    if (air) this.drawAir(g, width, height, pivot, air, alpha);
    g.globalAlpha = 1;
  }

  private accents(target: FxTarget): readonly [string, string] {
    const { main, partner, light, glint } = this.colors;
    if (target === 'D') return [main, light];
    if (target === 'H') return [partner, glint];
    return [main, partner];
  }

  private drawAir(g: CanvasRenderingContext2D, w: number, h: number, pivot: Point, air: Air, alpha: number): void {
    const [first, second] = this.accents(air.target);
    const power = Math.min(1, (air.level + Math.min(3, air.combo)) / 10);
    const unit = Math.min(w, h);
    const x = Math.max(w * 0.2, Math.min(w * 0.8, pivot.x * w));
    const y = Math.max(h * 0.24, Math.min(h * 0.76, pivot.y * h));
    const clock = this.time / 1_000;
    if (power >= 0.4) this.tintEdges(g, w, h, first, second, alpha * power * 0.34);

    const arcs = Math.floor(2 + power * 5);
    for (let i = 0; i < arcs; i++) {
      const r = unit * (0.15 + i * 0.040 + power * 0.09);
      const angle = clock * (2.6 + power * 2.5) * (i % 2 ? -1 : 1) + i * 1.22;
      g.strokeStyle = i % 2 ? second : first;
      g.lineWidth = 3 + power * 8;
      g.globalAlpha = alpha * (0.74 - i * 0.07);
      g.beginPath();
      g.ellipse(x, y, r, r * (0.54 + noise(i + 7) * 0.3), i * 0.78, angle, angle + 1.4 + power * 1.3);
      g.stroke();
      g.strokeStyle = this.colors.glint;
      g.lineWidth = 1 + power * 1.9;
      g.stroke();
    }
    const count = Math.floor(15 + 57 * power);
    for (let i = 0; i < count; i++) {
      const t = (clock * (0.65 + noise(i) * 0.65) + noise(i + 20)) % 1;
      const angle = noise(i + 5) * TAU + t * 1.05;
      const outer = power > 0.42 && i % 3 === 0;
      const reach = outer ? Math.hypot(w, h) * 0.62 : unit * (0.21 + power * 0.36);
      const r = lerp(unit * 0.12, reach, t);
      g.fillStyle = i % 5 === 0 ? this.colors.glint : i % 2 ? first : second;
      g.globalAlpha = alpha * Math.sin(Math.PI * t) * (outer ? 0.9 : 0.75);
      this.shard(g, x + Math.cos(angle) * r, y + Math.sin(angle) * r, angle,
        (outer ? 26 : 9) + power * (outer ? 72 : 20), (outer ? 2.4 : 3) + noise(i + 9) * power * 6);
    }
  }

  private drawLanding(g: CanvasRenderingContext2D, w: number, h: number, landing: Landing, alpha: number): void {
    const power = landing.level / 10;
    const age = this.time - landing.at;
    const life = 350 + landing.level * 42;
    const t = Math.min(1, age / life);
    const [first, second] = this.accents(landing.target);
    const x = Math.max(w * 0.15, Math.min(w * 0.85, landing.point.x * w));
    const y = Math.max(h * 0.30, Math.min(h * 0.79, landing.point.y * h));
    const unit = Math.min(w, h);
    const fade = (1 - t) ** 0.72;
    const reach = lerp(unit * 0.54, Math.hypot(w, h) * 0.91, power);

    this.tintEdges(g, w, h, first, second, alpha * fade * (0.18 + 0.42 * power));
    const rings = Math.floor(2 + power * 4);
    for (let i = 0; i < rings; i++) {
      const phase = Math.max(0, t - i * 0.08);
      if (i > 0 && !phase) continue;
      const radius = unit * 0.07 + reach * (1 - (1 - phase) ** 2) * (1 - i * 0.075);
      const thickness = (7 + power * 18) * (1 - phase);
      g.beginPath();
      g.ellipse(x, y, radius, radius * (0.33 + power * 0.35), (i % 2 ? -1 : 1) * 0.16, 0, TAU);
      g.strokeStyle = i % 2 ? second : first;
      g.lineWidth = Math.max(2, thickness);
      g.globalAlpha = alpha * fade * (0.83 - i * 0.08);
      g.stroke();
      g.strokeStyle = this.colors.glint;
      g.lineWidth = Math.max(1, thickness * 0.25);
      g.stroke();
    }
    const amount = Math.floor(25 + 64 * power);
    for (let i = 0; i < amount; i++) {
      const angle = TAU * noise(i + 1);
      const r = unit * 0.05 + reach * (0.37 + noise(i + 40) * 0.63) * (1 - (1 - t) ** 3);
      const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r * (0.68 + power * 0.3);
      g.globalAlpha = alpha * fade * (0.55 + 0.4 * noise(i));
      g.fillStyle = i % 4 === 0 ? this.colors.glint : i % 2 ? first : second;
      this.shard(g, px, py, angle, (12 + 49 * power) * (0.5 + noise(i + 4)) * fade, (3 + 9 * power) * noise(i + 8) + 2);
    }
  }

  private tintEdges(g: CanvasRenderingContext2D, w: number, h: number, first: string, second: string, alpha: number): void {
    g.globalAlpha = alpha;
    const tint = g.createLinearGradient(0, h * 0.85, w, h * 0.15);
    tint.addColorStop(0, first);
    tint.addColorStop(0.31, first + '00');
    tint.addColorStop(0.66, second + '00');
    tint.addColorStop(1, second);
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
  }

  private shard(g: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number): void {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    g.beginPath();
    g.moveTo(x + dx * length * 0.5, y + dy * length * 0.5);
    g.lineTo(x - dy * width, y + dx * width);
    g.lineTo(x - dx * length, y - dy * length);
    g.lineTo(x + dy * width * 0.55, y - dx * width * 0.55);
    g.closePath();
    g.fill();
  }
}
