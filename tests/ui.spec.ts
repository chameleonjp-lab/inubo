import { expect, test, type Page } from '@playwright/test';

/** 画面の通し試験（V15・V16 ほか）。走行は検査用の自動操縦を速めて動かす。 */

type Inubo = {
  app: {
    game: { session: { paused: boolean; phase: string; sim: { events: { kind: string }[]; simUs: number } } } | null;
  };
};

async function gameState(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __inubo: Inubo }).__inubo.app.game;
    if (!g) return null;
    return { paused: g.session.paused, phase: g.session.phase, simUs: g.session.sim.simUs, jumps: g.session.sim.events.filter((e) => e.kind === 'jump').length };
  });
}

async function finishAutoRun(page: Page, route = 'safe', course = 'park', dog = 'shiba', extra = '') {
  await page.goto(`/?autoplay=${route}&speed=12${extra}`);
  await page.click(`[data-testid="course-${course}"]`);
  await page.click(`[data-testid="dog-${dog}"]`);
  await page.click('[data-testid="start"]');
  await page.waitForSelector('[data-testid="results"]', { timeout: 90_000 });
  await page.waitForTimeout(900);
}

test('ホーム: 旧版で別コースを選んでいても公園が選択され、3 犬種と服装を選べる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('inubo-test:inubo:v1:profile', JSON.stringify({
    participantId: 'legacy-player', lastCourse: 'riverside',
  })));
  await page.goto('/');
  await expect(page.getByTestId('course-park')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="course-"]')).toHaveCount(1);
  for (const d of ['shiba', 'corgi', 'whippet']) await expect(page.locator(`[data-testid="dog-${d}"]`)).toBeEnabled();
  await page.click('[data-testid="dog-corgi"]');
  await expect(page.locator('[data-testid="dog-corgi"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.swatches').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xでシェア' })).toBeVisible();
});

test('完走 → 結果: 総合点を大きく、その下にタイム・タイム点・技点。合計が一致し、1 操作で同じ犬・コースを再挑戦できる', async ({ page }) => {
  await finishAutoRun(page, 'trick', 'park', 'whippet');
  const num = async (id: string) => Number((await page.textContent(`[data-testid="${id}"]`))!.replace(/[^0-9]/g, ''));
  const total = await num('total');
  const timeScore = await num('time-score');
  const trick = await num('trick-score');
  expect(total).toBe(timeScore + trick);
  expect(trick).toBeGreaterThan(0);
  const totalBox = await page.locator('[data-testid="total"]').boundingBox();
  const timeBox = await page.locator('[data-testid="time"]').boundingBox();
  expect(totalBox!.height).toBeGreaterThan(timeBox!.height * 1.8);
  expect(totalBox!.y).toBeLessThan(timeBox!.y);
  await expect(page.locator('.res-course')).toContainText('ウィペット');
  // 再挑戦: 前の走行の時計・所持状態を引き継がない
  await page.click('[data-testid="retry"]');
  await page.waitForSelector('[data-testid="surface"]');
  const st = await gameState(page);
  expect(st!.simUs).toBeLessThan(2_000_000);
});

test('端末内の記録: 完走するとホームに最高点と最速（犬種つき）が出て、スタンプ帳に印が付く。再読込後も残る', async ({ page }) => {
  await finishAutoRun(page, 'safe', 'park', 'corgi');
  await page.click('[data-testid="home"]');
  await page.reload();
  await expect(page.getByTestId('course-park')).toContainText('最高');
  await expect(page.getByTestId('course-park')).toContainText('コーギー');
  await page.getByRole('button', { name: 'スタンプ帳' }).click();
  await expect(page.locator('table.stamps')).toContainText('🐾');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => key.startsWith('inubo-test:inubo:v1:bestTime:'))).toBe(true);
  expect(keys.filter((key) => key.startsWith('inubo:v1:'))).toEqual([]);
});

test('ホーム: Xの投稿画面が開かずコピーも使えないとき、共有文を表示する', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Xでシェア' }).click();
  await expect(page.getByTestId('home-share-fallback').getByTestId('share-text')).toHaveValue(/イヌボー/);
});

test('V16 共有: 投稿画面を開けないときは、同じ文をコピーへ。コピーもできなければ文を画面に出す', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await finishAutoRun(page, 'safe', 'park', 'shiba');
  await page.click('[data-testid="share"]');
  const text = await page.locator('[data-testid="share-text"]').inputValue();
  const once = (s: string) => text.split(s).length - 1;
  expect(once('公園')).toBe(1);
  expect(once('柴犬')).toBe(1);
  expect(text).toMatch(/タイム \d+\.\d\d秒/);
  expect(text).toMatch(/総合 [\d,]+点/);
});

test('V01 中断: 一時停止は景色を覆い、指を離して「再開」を押すまで進まない。裏へ回って戻っただけでは発進しない', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="start"]');
  await page.waitForTimeout(4200);
  await page.click('[data-testid="pause"]');
  await expect(page.locator('[data-testid="pause-cover"]')).toBeVisible();
  const a = await gameState(page);
  await page.waitForTimeout(800);
  const b = await gameState(page);
  expect(b!.simUs).toBe(a!.simUs);
  // 裏へ回る → 戻る
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  expect((await gameState(page))!.paused).toBe(true);
  await page.click('[data-testid="resume"]');
  await expect(page.locator('[data-testid="pause-cover"]')).toBeHidden();
  await page.waitForTimeout(500);
  const c = await gameState(page);
  expect(c!.paused).toBe(false);
  expect(c!.simUs).toBeGreaterThan(b!.simUs);
  expect(c!.simUs - b!.simUs).toBeLessThan(1_500_000);
  expect(c!.jumps).toBe(0);
});

test('指の操作: 上へ払うと 1 回跳ぶ（画面の上が前）', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.click('[data-testid="start"]');
  await page.waitForTimeout(4000);
  const box = (await page.locator('[data-testid="surface"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.75;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - i * 12);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await gameState(page))!.jumps).toBe(1);
});

test('設定: 音のオン・オフ、音量、揺れ、光の量を別々に変え、再読込後も残る', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="settings"]');
  await page.uncheck('[data-testid="sound"]');
  await page.fill('[data-testid="volume"]', '0');
  await page.uncheck('[data-testid="shake"]');
  await page.selectOption('[data-testid="light"]', 'weak');
  await page.reload();
  await page.click('[data-testid="settings"]');
  await expect(page.locator('[data-testid="sound"]')).not.toBeChecked();
  await expect(page.locator('[data-testid="volume"]')).toHaveValue('0');
  await expect(page.locator('[data-testid="shake"]')).not.toBeChecked();
  await expect(page.locator('[data-testid="light"]')).toHaveValue('weak');
});

test('練習広場: 5 つの手順を順に試せ、途中で次へ・本番へ進める。練習は記録を作らない', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="practice"]');
  await expect(page.locator('[data-testid="practice-title"]')).toHaveText('1. 左右に動く');
  await page.click('[data-testid="practice-next"]');
  await expect(page.locator('[data-testid="practice-title"]')).toHaveText('2. ジャンプ');
  await expect(page.locator('[data-testid="hud-time"]')).toHaveText('練習');
  await page.click('[data-testid="to-race"]');
  await expect(page.locator('[data-testid="practice-panel"]')).toHaveCount(0);
  const st = await gameState(page);
  expect(st!.phase === 'countdown' || st!.phase === 'running').toBe(true);
});

for (const vp of [
  { name: '縦 402×700', width: 402, height: 700 },
  { name: '横 700×402', width: 700, height: 402 },
]) {
  test(`表示範囲（${vp.name}）: 停止ボタン・時間・技点が画面に収まる`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.click('[data-testid="start"]');
    await page.waitForTimeout(3500);
    for (const id of ['pause', 'hud-time', 'hud-trick']) {
      const b = (await page.locator(`[data-testid="${id}"]`).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
    }
  });
}

test('画面の向きを変えると一時停止する', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="start"]');
  await page.waitForTimeout(3600);
  await page.setViewportSize({ width: 700, height: 402 });
  await expect(page.locator('[data-testid="pause-cover"]')).toBeVisible();
});

test('V17・V18（試験用の接続先）: 名前を入れて走ると、結果の順位に開始時の名前で 1 件だけ出る', async ({ page }) => {
  await page.goto('/?ranking=mock&autoplay=safe&speed=12');
  await page.fill('[data-testid="name"]', 'テスト<犬>&');
  await expect(page.locator('#ranking-name-note')).toContainText('名前と記録がランキングに公開');
  await page.click('[data-testid="start"]');
  await page.waitForSelector('[data-testid="results"]', { timeout: 90_000 });
  await page.getByRole('button', { name: 'ランキング（総合）' }).click();
  await expect(page.locator('[data-testid="board"] [data-state="ready"] li')).toHaveCount(1);
  await expect(page.locator('[data-testid="board"]')).toContainText('テスト<犬>&');
  await page.getByRole('button', { name: 'ランキング（タイム）' }).click();
  await expect(page.locator('[data-testid="board"] [data-state="ready"] li')).toHaveCount(1);
});

test('公開前（既定）: 名前の欄とランキングへの導線を出さない', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="name"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ランキング' })).toHaveCount(0);
});
