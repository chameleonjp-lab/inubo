import { test, expect, type Page } from '@playwright/test';

async function swipe(page: Page, from: number, to: number, surface = 'free-pad'): Promise<void> {
  const r = (await page.getByTestId(surface).boundingBox())!;
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x + from, y); await page.mouse.down();
  await page.mouse.move(x + to, y, { steps: 6 }); await page.mouse.up();
}
const commonSpeed = (page: Page) => page.getByTestId('free-speed').getAttribute('data-common').then(Number);

test('生のスワイプ・指離しの慣性・逆入力・停止再開・未知の動きの着地を画面から通す', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByTestId('free-jump')).toBeEnabled();
  await page.getByTestId('free-high').click(); await swipe(page, -25, 25);
  const initial = await commonSpeed(page); expect(initial).toBeGreaterThan(50);
  await page.waitForTimeout(150);
  const released = await commonSpeed(page); expect(released).toBeGreaterThan(15); expect(released).toBeLessThan(initial);
  await swipe(page, 10, -5); expect(await commonSpeed(page)).toBeLessThan(released);
  await page.getByTestId('free-pause').click();
  const time = await page.locator('#app').getAttribute('data-time-us'), speed = await commonSpeed(page);
  await page.waitForTimeout(200); expect(await commonSpeed(page)).toBe(speed);
  expect(await page.locator('#app').getAttribute('data-time-us')).toBe(time);
  await page.getByTestId('free-pause').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'done', { timeout: 7000 });
  await expect(page.getByTestId('landing-trick-name')).toContainText('着地');
  await expect(page.getByTestId('landing-trick-score')).toHaveText(/＋[0-9,]+/);
  expect(Number(await page.getByTestId('free-score').getAttribute('data-points'))).toBeGreaterThan(0);
  await page.getByTestId('free-retry').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'ready'); expect(await commonSpeed(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('犬だけの操作・取消・画面回転で勢いを混ぜず、402×700と700×402に収まる', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('target-dog').click(); await page.getByTestId('free-high').click();
  await swipe(page, -10, 10, 'free-stage');
  expect(Number(await page.getByTestId('free-speed').getAttribute('data-dog'))).toBeGreaterThan(10);
  expect(await commonSpeed(page)).toBe(0); expect(Number(await page.getByTestId('free-speed').getAttribute('data-rider'))).toBe(0);
  for (const viewport of [{ width: 402, height: 700 }, { width: 700, height: 402 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId('free-pad')).toBeInViewport(); await expect(page.getByTestId('free-retry')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/free-${viewport.width}x${viewport.height}.png` });
  }
  await expect(page.locator('#app')).toHaveAttribute('data-paused', 'true');
  const speed = Number(await page.getByTestId('free-speed').getAttribute('data-dog'));
  await page.mouse.move(600, 280); await page.mouse.up(); await page.waitForTimeout(100);
  expect(Number(await page.getByTestId('free-speed').getAttribute('data-dog'))).toBe(speed);
});

test('確認版は本番の保存・送信・検査用の書き換え口を初期化しない', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:4174') { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    originalSet.call(localStorage, 'inubo:profile', 'production-profile-marker');
    originalSet.call(localStorage, 'inubo:outbox', 'production-outbox-marker');
    const calls: string[] = [];
    for (const key of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      const original = Storage.prototype[key];
      Object.defineProperty(Storage.prototype, key, { value: function (...args: unknown[]) { calls.push(key); return Reflect.apply(original, this, args); } });
    }
    Object.assign(window, { __storageAudit: calls });
  });
  await page.goto('/?debug=1&autoplay=trick&ranking=mock');
  await page.getByTestId('free-jump').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'done', { timeout: 5000 });
  expect(await page.evaluate(() => (window as unknown as { __storageAudit: string[] }).__storageAudit)).toEqual([]);
  expect(await page.evaluate(() => '__inubo' in window)).toBe(false);
  expect(external).toEqual([]);
});

const FA_IDS = ['B', 'H', 'D'].flatMap(t => [...Array.from({ length: 10 }, (_, i) => `${t}-F${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 7 }, (_, i) => `${t}-A${String(i + 1).padStart(2, '0')}`)]);

test('81種類の確認：空中の派手さF・軌跡Aの54件すべてが、球の模型の上に描かれる', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('free-slow').click();
  for (const id of FA_IDS) {
    await page.getByTestId('fx-gallery').selectOption(id);
    await page.getByTestId('fx-gallery-play').click();
    await expect(page.locator('.free-review')).toHaveAttribute('data-fx-ids', new RegExp(`(^| )${id}( |$)`));
    await expect.poll(() => page.locator('.free-review').getAttribute('data-fx-lines').then(Number), { message: id }).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

const L_IDS = ['B', 'H', 'D'].flatMap(t => Array.from({ length: 10 }, (_, i) => `${t}-L${String(i + 1).padStart(2, '0')}`));

test('81種類の確認：着地L の30件すべてが着地の瞬間に出て、描かれ、対応する着地音を選ぶ', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('free-slow').click();
  const review = page.locator('.free-review');
  for (const id of L_IDS) {
    await page.getByTestId('fx-gallery').selectOption(id);
    await page.getByTestId('fx-gallery-play').click();
    await expect(review, id).toHaveAttribute('data-fx-ids', new RegExp(`(^| )${id}( |$)`), { timeout: 8_000 });
    await expect.poll(() => review.getAttribute('data-fx-landing-peak').then(Number), { message: id }).toBeGreaterThan(0);
    await expect(review, id).toHaveAttribute('data-last-sound', `trickLanding${id[0]}${id.slice(3)}`);
  }
  expect(errors).toEqual([]);
});

test('確認用：着地音30種を1つずつ選んで鳴らせ、背景の切替と描画の計測ができる', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const review = page.locator('.free-review');
  await expect(page.getByTestId('fx-sound').locator('option')).toHaveCount(30);
  for (const name of ['trickLandingB01', 'trickLandingH05', 'trickLandingD10']) {
    await page.getByTestId('fx-sound').selectOption(name);
    await page.getByTestId('fx-sound-play').click();
    await expect(review).toHaveAttribute('data-last-sound', name);
  }
  for (const bg of ['bright-road', 'dark-road', 'sky']) await page.getByTestId('fx-backdrop').selectOption(bg);
  await page.getByTestId('perf-run').click();
  await expect(review).toHaveAttribute('data-perf', /"frames":[1-9]/, { timeout: 15_000 });
  const perf = JSON.parse((await review.getAttribute('data-perf'))!);
  expect(perf).toMatchObject({ stallsOver100ms: expect.any(Number), p95GapMs: expect.any(Number), viewport: '402x700' });
  expect(errors).toEqual([]);
});
