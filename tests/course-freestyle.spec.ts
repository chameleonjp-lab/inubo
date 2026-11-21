import { DOG_EFFECT_COLORS } from '../src/content/dog-effects';
import { DOG_ORDER } from '../src/content/dogs';
import { expect, test } from '@playwright/test';
import type { RunSession } from '../src/game/run';
import { FREE_RULES_VERSION } from '../src/game/free-motion';
import type { Quat } from '../src/game/math';

type TestGame = { session: RunSession; view: { rig: { dog: { quaternion: { toArray(): Quat } } } } };

for (const [entry, viewport] of [['start', { width: 402, height: 700 }], ['practice', { width: 700, height: 402 }]] as const) {
  test(`${entry}: 画面の端から触れて、指を離す前から犬を回し、慣性と逆回転を経て着地できる`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?ranking=mock');
    await page.getByTestId('name').fill('自由操作の確認');
    if (entry === 'practice') await page.evaluate(() => (window as unknown as {
      __inubo: { app: { startRun: (mode: 'practice') => void } }
    }).__inubo.app.startRun('practice'));
    else await page.getByTestId('start').click();
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
      const impactCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="trick-impact"]')!;
      const drewAir = impactCanvas.dataset.phase === 'air'
        && impactCanvas.getContext('2d')!.getImageData(0, 0, impactCanvas.width, impactCanvas.height).data.some((value, i) => i % 4 === 3 && value > 90);
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
      const landingPhase = impactCanvas.dataset.phase;
      return {
        version: sim.id.rulesVersion, ranked: sim.id.rankingOptIn, held, heldTurn, displayTurn, drift, premature, speedBeforeReverse, speedAfterReverse,
        drewAir, landingPhase, landing: sim.score.jumps[0], fixedTricks: sim.events.filter(event => event.kind === 'trickStart').length,
      };
    });
    expect(observed.version).toBe(FREE_RULES_VERSION);
    expect(observed.ranked).toBe(false);
    expect(observed.drewAir).toBe(true);
    expect(observed.landingPhase).toBe('landing');
    expect(observed.held).toBe(true);
    expect(observed.heldTurn).toBeGreaterThan(0.2);
    expect(observed.displayTurn).toBeGreaterThan(0.2);
    expect(observed.drift).toBeGreaterThan(0.2);
    expect(observed.speedBeforeReverse).toBeLessThan(-2.5);
    expect(observed.speedAfterReverse).toBeGreaterThan(0.5);
    expect(observed.premature).toBe(0);
    expect(observed.fixedTricks).toBe(0);
    expect(observed.landing).toMatchObject({ names: [expect.stringMatching(/犬と人の右/)], tenths: 10 });
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
    const [nameBox, scoreBox] = await Promise.all([name.boundingBox(), score.boundingBox()]);
    expect(scoreBox!.x).toBeGreaterThan(nameBox!.x + 70);
    // 拡大しながら表示されるので、変形の影響を受けない箱の高さを測る。
    expect(await score.evaluate(element => (element as HTMLElement).offsetHeight)).toBeGreaterThan(37);
    await expect(title).toHaveAttribute('data-trick-tier', /^[1-5]$/);
    expect(errors).toEqual([]);
  });
}


test('ジャンプの指を保持したまま即回転し、ボタンを押した瞬間に対象を変えられる', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 700 });
  await page.goto('/?ranking=mock');
  await page.getByTestId('home').waitFor();
  await page.evaluate(() => (window as unknown as {
    __inubo: { app: { startRun: (mode: 'practice') => void } }
  }).__inubo.app.startRun('practice'));
  const observed = await page.evaluate(async () => {
    const { session } = (window as unknown as { __inubo: { app: { game: TestGame } } }).__inubo.app.game;
    const sim = session.sim;
    const surface = document.querySelector('[data-testid="surface"]')!;
    const until = async (condition: () => boolean) => {
      const max = performance.now() + 12_000;
      while (!condition()) {
        if (performance.now() > max) throw Error('入力の反応待ちが上限を超過しました: ' + sim.mode);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    const pointer = (kind: string, x: number, y: number) =>
      surface.dispatchEvent(new PointerEvent(kind, { pointerId: 19, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true }));
    const choose = (target: string) => {
      const button = document.querySelector(`[data-testid="run-target-${target}"]`)!;
      button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: target === 'dog' ? 40 : 41,
        pointerType: 'touch', bubbles: true, cancelable: true }));
      return button.getAttribute('aria-pressed');
    };
    await until(() => session.phase === 'running' && sim.simUs >= 40_000);
    const x = innerWidth * 0.45, y = innerHeight * 0.62;
    pointer('pointerdown', x, y);
    pointer('pointermove', x, y - 90); // 同じ指で踏切
    await until(() => sim.freeFlight !== null);
    pointer('pointermove', x + 80, y - 96); // 指を離さず回転
    await until(() => sim.freeFlight!.motion.omega.common.some(v => Math.abs(v) > 0.2));
    const common = sim.freeFlight!.motion.omega.common.some(v => Math.abs(v) > 0.2);
    const dogPressed = choose('dog');
    pointer('pointermove', x + 135, y - 102);
    await until(() => sim.freeFlight!.motion.omega.dog.some(v => Math.abs(v) > 0.2));
    const riderPressed = choose('rider');
    pointer('pointermove', x + 180, y - 108);
    await until(() => sim.freeFlight!.motion.omega.rider.some(v => Math.abs(v) > 0.2));
    const record = Object.values(sim.strokes).find(stroke => stroke.downUs < sim.simUs && stroke.upUs === null && stroke.freeTarget === 'rider');
    const result = { common, dogPressed, riderPressed, rider: sim.freeFlight!.motion.omega.rider,
      sameFinger: !!record && record.tag === 'air', rules: sim.id.rulesVersion };
    pointer('pointerup', x + 180, y - 108);
    return result;
  });
  expect(observed).toMatchObject({ common: true, dogPressed: 'true', riderPressed: 'true',
    sameFinger: true, rules: FREE_RULES_VERSION });
  expect(observed.rider.some(v => Math.abs(v) > 0.2)).toBe(true);
});

test('犬種を変更すると着地の文字と画面全体の光の色が切り替わる', async ({ page }) => {
  for (const dogId of DOG_ORDER) {
    await page.goto('/');
    await page.getByTestId(`dog-${dogId}`).click();
    await page.getByTestId('start').click();
    const { main, partner } = DOG_EFFECT_COLORS[dogId];
    const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(s => parseInt(s, 16));
    const mainRgb = rgb(main), partnerRgb = rgb(partner);
    const landingColor = await page.evaluate(async (first) => {
      const { session } = (window as unknown as { __inubo: { app: { game: TestGame } } }).__inubo.app.game;
      session.begin();
      const atUs = session.sim.simUs + 20_000;
      session.submit(session.runId, [
        { kind: 'down', strokeId: 121, atUs },
        { kind: 'forward', strokeId: 121, atUs: atUs + 1 },
        { kind: 'freeRotate', strokeId: 121, atUs: atUs + 20_000, seq: 1, target: 'common', rotation: [0, 1.6, 0] },
        { kind: 'up', strokeId: 121, atUs: atUs + 40_000, cancelled: false },
      ]);
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="trick-impact"]')!;
      const context = canvas.getContext('2d')!;
      const deadline = performance.now() + 9_000;
      while (performance.now() < deadline) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (canvas.dataset.phase !== 'landing') continue;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 90 && first.every((channel, j) => Math.abs(data[i + j] - channel) < 5)) {
            return true;
          }
        }
      }
      return false;
    }, mainRgb);
    expect(landingColor, dogId).toBe(true);
    await expect(page.getByTestId('landing-trick-score')).toHaveCSS('color', `rgb(${partnerRgb.join(', ')})`);
  }
});
