import { expect, test, type Page } from '@playwright/test';

async function playerRun(page: Page) {
  return page.evaluate(() => {
    const { session } = (window as unknown as { __inubo: { app: { game: { session: { phase: string; sim: { simUs: number; s: number; jumpCounter: number } } } } } }).__inubo.app.game;
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
