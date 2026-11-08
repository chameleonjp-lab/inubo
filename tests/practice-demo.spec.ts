import { expect, test, type Page } from '@playwright/test';
import { practiceGuide } from '../src/ui/practice';
import type { RunSession } from '../src/game/run';

type TestWindow = Window & { __inubo: { app: { game: { session: RunSession } } } };

async function playerRun(page: Page) {
  return page.evaluate(() => {
    const { session } = (window as unknown as TestWindow).__inubo.app.game;
    return { phase: session.phase, time: session.sim.simUs, position: session.sim.s, jumps: session.sim.jumpCounter };
  });
}

test('練習のお手本は1回だけ再生し、プレイヤーの操作や走行を進めない', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('practice').click();
  const demo = page.getByTestId('practice-demo');
  const status = page.getByTestId('practice-demo-status');
  const next = page.getByTestId('practice-next');
  const title = page.getByTestId('practice-title');
  await expect(status).toBeEmpty();
  await next.click();
  await expect.poll(async () => (await playerRun(page)).phase, { timeout: 15_000 }).toBe('running');

  await demo.click();
  await expect(demo).toHaveText('お手本を止める');
  const before = await playerRun(page);
  await expect(status).toContainText('着地', { timeout: 10_000 });
  expect(await playerRun(page)).toEqual(before);
  await expect(status).toContainText('自分の指で', { timeout: 10_000 });
  await expect(demo).toHaveText('お手本を見る');
  await expect(title).toHaveText('2. ジャンプ');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await demo.click();
  await demo.click();
  await expect(demo).toHaveText('お手本を見る');
  await expect(status).toBeEmpty();
  await demo.click();
  await next.click();
  await expect(title).toHaveText('3. 犬だけを回す（円）');
  await expect(status).toBeEmpty();

  await demo.click();
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause-cover')).toBeVisible();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('pause-cover')).toBeHidden();
  await expect(demo).toHaveText('お手本を見る');
  await demo.click();
  await page.getByTestId('to-race').click();
  await expect(page.getByTestId('practice-panel')).toHaveCount(0);
});

test('5番でガイドを1本の指でなぞると複合技が成功して練習を完了する', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('practice').click();
  for (let i = 0; i < 4; i++) await page.getByTestId('practice-next').click();
  await expect(page.getByTestId('practice-title')).toHaveText('5. 複合技（円＋直線）');
  const points = practiceGuide('composite', true).flatMap((stroke) => [...stroke.points]);
  // 台からの実際のジャンプを待ち、通常の操作画面へタッチイベントを送る。
  await page.waitForFunction(() => {
    const g = (window as unknown as TestWindow).__inubo.app.game;
    const sim = g.session.sim;
    return sim.mode === 'air' && sim.jump?.kind === 'kicker' && sim.simUs - sim.jump.takeoffUs < 70_000;
  }, undefined, { polling: 'raf' });
  await page.evaluate(async (shape) => {
    const surface = document.querySelector('[data-testid="surface"]')!;
    const w = innerWidth, h = innerHeight, unit = Math.min(w, h);
    const cx = w * (w > h ? 0.67 : 0.5), cy = h * (w > h ? 0.36 : 0.39);
    const start = performance.now();
    for (let i = 0; i < shape.length; i++) {
      const target = start + 1000 * i / (shape.length - 1);
      while (performance.now() < target) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const [x, y] = shape[i];
      const type = i === 0 ? 'pointerdown' : i === shape.length - 1 ? 'pointerup' : 'pointermove';
      surface.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 71, pointerType: 'touch', isPrimary: true,
        clientX: cx + x * unit, clientY: cy + y * unit, buttons: type === 'pointerup' ? 0 : 1,
      }));
    }
  }, points);
  await expect(page.getByTestId('practice-panel')).toContainText('練習の手順はここまで');
  const success = await page.evaluate(() => (window as unknown as TestWindow).__inubo.app.game.session.sim.events.some(
    (event) => event.kind === 'land' && event.data?.composite && Number(event.data?.tenths) > 0,
  ));
  expect(success).toBe(true);
});
