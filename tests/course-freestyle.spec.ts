import { expect, test } from '@playwright/test';
import type { RunSession } from '../src/game/run';
import type { Quat } from '../src/game/math';

type TestGame = { session: RunSession; view: { rig: { dog: { quaternion: { toArray(): Quat } } } } };

for (const [entry, viewport] of [['start', { width: 402, height: 700 }], ['practice', { width: 700, height: 402 }]] as const) {
  test(`${entry}: 画面の端から触れて、指を離す前から犬を回し、慣性と逆回転を経て着地できる`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?ranking=mock');
    await page.getByTestId('name').fill('自由操作の確認');
    await page.getByTestId(entry).click();
    await expect(page.getByTestId('free-run-controls')).toBeVisible();
    await expect(page.getByTestId('run-target-dog')).toBeInViewport();
    const observed = await page.evaluate(async () => {
      const game = (window as unknown as { __inubo: { app: { game: TestGame } } }).__inubo.app.game;
      const { session, view } = game;
      const sim = session.sim;
      const surface = document.querySelector('[data-testid="surface"]')!;
      const until = async (pass: () => boolean): Promise<void> => {
        const deadline = performance.now() + 15_000;
        while (!pass()) {
          if (performance.now() > deadline) throw Error(`待機上限。時刻 ${sim.simUs}、状態 ${sim.mode}`);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      };
      const pointer = (type: string, id: number, clientX: number, clientY: number) => {
        surface.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true }));
      };
      const gap = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, value, i) => sum + value * b[i], 0))));
      const q = () => sim.freeFlight!.motion.pose.dog.q;
      const omega = () => sim.freeFlight!.motion.omega.common[1];

      await until(() => session.phase === 'running' && sim.simUs >= 40_000);
      const centerX = innerWidth / 2, y = innerHeight * 0.62;
      pointer('pointerdown', 1, centerX, y);
      pointer('pointermove', 1, centerX, y - 84);
      pointer('pointerup', 1, centerX, y - 84);
      await until(() => !!sim.freeFlight);
      const before = q();

      const right = innerWidth * 0.9, left = right - 240;
      const heldAt = sim.simUs;
      pointer('pointerdown', 2, right, y);
      pointer('pointermove', 2, left, y);
      await until(() => sim.simUs >= heldAt + 105_000);
      const heldTurn = gap(before, q()), displayTurn = gap(before, view.rig.dog.quaternion.toArray());
      const held = Object.values(sim.strokes).some(stroke => stroke.freeTarget === 'common' && stroke.upUs === null);
      const premature = sim.score.jumps.length;
      pointer('pointerup', 2, left, y);

      const released = q();
      const releasedAt = sim.simUs;
      await until(() => sim.simUs >= releasedAt + 145_000);
      const drift = gap(released, q()), speedBeforeReverse = omega();
      const reverseAt = sim.simUs;
      pointer('pointerdown', 3, left, y);
      pointer('pointermove', 3, right + 24, y);
      pointer('pointerup', 3, right + 24, y);
      await until(() => sim.simUs >= reverseAt + 55_000);
      const speedAfterReverse = omega();
      await until(() => sim.score.jumps.length > 0);
      return {
        version: sim.id.rulesVersion, ranked: sim.id.rankingOptIn, held, heldTurn, displayTurn, drift, premature, speedBeforeReverse, speedAfterReverse,
        landing: sim.score.jumps[0], fixedTricks: sim.events.filter(event => event.kind === 'trickStart').length,
      };
    });
    expect(observed.version).toBe('rules-freestyle-1');
    expect(observed.ranked).toBe(false);
    expect(observed.held).toBe(true);
    expect(observed.heldTurn).toBeGreaterThan(0.2);
    expect(observed.displayTurn).toBeGreaterThan(0.2);
    expect(observed.drift).toBeGreaterThan(0.2);
    expect(observed.speedBeforeReverse).toBeLessThan(-2.5);
    expect(observed.speedAfterReverse).toBeGreaterThan(0.5);
    expect(observed.premature).toBe(0);
    expect(observed.fixedTricks).toBe(0);
    expect(observed.landing).toMatchObject({ names: [expect.stringContaining('犬と人の右スピン')], tenths: 10 });
    expect(observed.landing.points).toBeGreaterThan(0);
    const title = page.getByTestId('center-text');
    const name = page.getByTestId('landing-trick-name');
    const score = page.getByTestId('landing-trick-score');
    await expect(name).toHaveText(observed.landing.names[0]);
    await expect(score).toBeVisible();
    const awarded = entry === 'practice' ? observed.landing.points : observed.landing.awarded;
    if (awarded > 0) await expect(score).toContainText('＋' + awarded.toLocaleString('ja-JP'));
    else await expect(score).toHaveText(/区間採点済み|加点なし/);
    await expect(name).toBeInViewport();
    await expect(score).toBeInViewport();
    await expect(title).toHaveAttribute('data-trick-tier', /^[1-5]$/);
    expect(errors).toEqual([]);
  });
}
