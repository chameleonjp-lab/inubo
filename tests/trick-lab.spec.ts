import { expect, test, type Page } from '@playwright/test';

/**
 * 技の練習の画面（T4）。本番と同じボタン・選択欄・操作面を押して確かめる。
 * 試行や成功を直接設定する方法は使わず、練習時計の進み具合を読んでから押す。
 */

type LabWindow = Window & {
  __inubo: {
    app: {
      lab: {
        state: {
          attemptId: string;
          phase: string;
          timeUs: number;
          s: number;
          targetX: number;
          takeoffUs: number | null;
          hand: { state: string };
          plant: { state: string };
          grabs: { reachUs: number | null }[];
          events: { kind: string; atUs: number; data?: Record<string, unknown> }[];
          outcome: { kind: string; reason?: string } | null;
        };
        inputs: { action: { type: string; dx?: number } }[];
        paused: boolean;
      } | null;
    };
  };
};

async function openLab(page: Page, lessonId: string) {
  await page.goto('/');
  await page.getByTestId('practice').click();
  await page.getByTestId('trick-lab').click();
  await expect(page.getByTestId('trick-lab')).toBeVisible();
  await page.selectOption('[data-testid="lab-lesson"]', lessonId);
}

async function labState(page: Page) {
  return page.evaluate(() => {
    const lab = (window as unknown as LabWindow).__inubo.app.lab!;
    const s = lab.state;
    return {
      attemptId: s.attemptId,
      phase: s.phase,
      timeUs: s.timeUs,
      hand: s.hand.state,
      plant: s.plant.state,
      targetX: s.targetX,
      events: s.events.map((e) => ({ kind: e.kind, data: e.data ?? null })),
      outcome: s.outcome,
      actions: lab.inputs.map((i) => i.action.type),
      paused: lab.paused,
    };
  });
}

/** 練習時計の条件がそろうまで待つ（条件は試行の状態 s を受け取る式）。 */
async function waitLab(page: Page, condition: string) {
  await page.waitForFunction(`(() => { const s = window.__inubo.app.lab.state; return ${condition}; })()`, undefined, { polling: 'raf', timeout: 20_000 });
}

const grabBtn = (page: Page) => page.getByTestId('lab-btn-grab');

test('34ウェドル・グラブ: スワイプ・長押し・同時押しなしで「つかむ」「はなす」を順に押して成功', async ({ page }) => {
  await openLab(page, '34');
  await page.selectOption('[data-testid="lab-setup-hand"]', 'front');
  await page.selectOption('[data-testid="lab-setup-handle"]', 'toe');
  await expect(grabBtn(page)).toHaveText('つかむ');
  const before = await grabBtn(page).boundingBox();
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 120000`);
  await grabBtn(page).click();
  await waitLab(page, `s.hand.state === 'holding'`);
  // 届いてから同じ場所が「はなす」に切り替わる。位置と大きさは変わらない。
  await expect(grabBtn(page)).toHaveText('はなす');
  expect(await grabBtn(page).boundingBox()).toEqual(before);
  // 指を離しても保持が続く。
  await waitLab(page, `s.timeUs - s.grabs[0].reachUs >= 200000`);
  expect((await labState(page)).hand).toBe('holding');
  await grabBtn(page).click();
  await expect(grabBtn(page)).toHaveText('つかむ');
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'success', { timeout: 15_000 });
  const st = await labState(page);
  expect(st.actions.filter((a) => a !== 'setup')).toEqual(['start', 'grab', 'release']);
});

test('35ボンレス: 地上でつかむ → 前足を着く → 跳ぶ → 足を戻す → はなす をボタンだけで成功', async ({ page }) => {
  await openLab(page, '35');
  await page.selectOption('[data-testid="lab-setup-hand"]', 'back');
  await page.selectOption('[data-testid="lab-setup-handle"]', 'toe');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.timeUs >= 250000`);
  await grabBtn(page).click();
  await waitLab(page, `s.hand.state === 'holding'`);
  await expect(grabBtn(page)).toHaveText('はなす');
  await page.getByTestId('lab-btn-plant').click();
  await waitLab(page, `s.plant.state === 'down'`);
  // 前足を着いている間も、持ち手の保持は続く。
  expect((await labState(page)).hand).toBe('holding');
  await page.getByTestId('lab-btn-pop').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 100000`);
  await page.getByTestId('lab-btn-catch').click();
  await waitLab(page, `s.events.some((e) => e.kind === 'catch')`);
  await grabBtn(page).click();
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'success', { timeout: 15_000 });
  expect((await labState(page)).actions.filter((a) => a !== 'setup')).toEqual(['start', 'grab', 'plant', 'pop', 'catch', 'release']);
});

test('36ノーコンプライ: 準備を選び、前足を着く → 跳ぶ → 足を戻す をボタンだけで成功', async ({ page }) => {
  await openLab(page, '36');
  await page.selectOption('[data-testid="lab-setup-dogYaw"]', '180');
  await page.selectOption('[data-testid="lab-setup-riderYaw"]', '180');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.timeUs >= 300000`);
  await page.getByTestId('lab-btn-plant').click();
  await waitLab(page, `s.plant.state === 'down'`);
  await page.getByTestId('lab-btn-pop').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 360000`);
  await page.getByTestId('lab-btn-catch').click();
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'success', { timeout: 15_000 });
});

test('スワイプと「左」「右」「跳ぶ」は同じ命令と移動量を送る', async ({ page }) => {
  await openLab(page, '15');
  await page.selectOption('[data-testid="lab-fixture"]', 'rail');
  await page.getByTestId('lab-btn-start').click();
  await page.getByTestId('lab-btn-right').click();
  await waitLab(page, `s.targetX > 0.39`);
  // 画面の短辺の10%の横払い。
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lab-surface"]')!;
    const unit = Math.min(innerWidth, innerHeight);
    const y = innerHeight * 0.55;
    const ev = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 100);
    ev('pointermove', 100 + unit * 0.05);
    ev('pointerup', 100 + unit * 0.1);
  });
  await waitLab(page, `s.targetX > 0.79`);
  let st = await labState(page);
  const aims = st.events.filter((e) => e.kind === 'aim').map((e) => e.data!.dx);
  expect(aims).toEqual([0.4, 0.4]);
  // 上への払いは「跳ぶ」と同じ踏切。
  await waitLab(page, `s.s >= 1.95`);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lab-surface"]')!;
    const unit = Math.min(innerWidth, innerHeight);
    const x = innerWidth / 2;
    const y0 = innerHeight * 0.6;
    const ev = (type: string, y: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 42, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', y0);
    ev('pointermove', y0 - unit * 0.08);
    ev('pointerup', y0 - unit * 0.1);
  });
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'success', { timeout: 15_000 });
  st = await labState(page);
  expect(st.actions.filter((a) => a !== 'setup')).toEqual(['start', 'aim', 'aim', 'pop']);

  // 同じ技をボタンだけで押しても同じ支え方で成功する。
  await page.getByTestId('lab-btn-start').click();
  await page.getByTestId('lab-btn-start').click();
  await page.getByTestId('lab-btn-right').click();
  await page.getByTestId('lab-btn-right').click();
  await waitLab(page, `s.s >= 1.95`);
  await page.getByTestId('lab-btn-pop').click();
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'success', { timeout: 15_000 });
  const again = await labState(page);
  const part = (x: typeof st) => x.events.find((e) => e.kind === 'supportOn')!.data!.part;
  expect(part(again)).toBe(part(st));
});

test('届かない持ち手では「つかむ」に戻って理由を出し、伸ばしている間の連打は受け付けない', async ({ page }) => {
  await openLab(page, '33');
  await page.selectOption('[data-testid="lab-setup-hand"]', 'front');
  await page.selectOption('[data-testid="lab-setup-handle"]', 'tail');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 120000`);
  await grabBtn(page).click();
  await grabBtn(page).click();
  await waitLab(page, `s.events.some((e) => e.kind === 'grabMiss')`);
  await expect(grabBtn(page)).toHaveText('つかむ');
  await expect(page.getByTestId('lab-status')).toContainText('届きません');
  const st = await labState(page);
  expect(st.events.some((e) => e.kind === 'ignored' && e.data?.action === 'grab')).toBe(true);
});

test('短すぎる保持は失敗。やり直すと前の入力・保持が残らない', async ({ page }) => {
  await openLab(page, '34');
  await page.selectOption('[data-testid="lab-setup-hand"]', 'front');
  await page.selectOption('[data-testid="lab-setup-handle"]', 'toe');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 120000`);
  await grabBtn(page).click();
  await waitLab(page, `s.hand.state === 'holding'`);
  await grabBtn(page).click();
  await expect(page.getByTestId('lab-outcome')).toHaveAttribute('data-outcome', 'fail', { timeout: 15_000 });
  const failed = await labState(page);
  expect(failed.outcome?.reason).toBe('earlyRelease');
  await page.getByTestId('lab-btn-start').click();
  const fresh = await labState(page);
  expect(fresh.attemptId).not.toBe(failed.attemptId);
  expect(fresh.phase).toBe('ready');
  expect(fresh.actions).toEqual(['setup']);
  await expect(grabBtn(page)).toHaveText('つかむ');
  await expect(page.getByTestId('lab-result')).toBeHidden();
  // 再試行では準備を再利用する。
  await expect(page.locator('[data-testid="lab-setup-handle"]')).toHaveValue('toe');
});

test('持ったまま画面を回すと一時停止し、再開すると実際の保持状態に表示を合わせる', async ({ page }) => {
  await openLab(page, '34');
  await page.selectOption('[data-testid="lab-setup-hand"]', 'front');
  await page.selectOption('[data-testid="lab-setup-handle"]', 'toe');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.phase === 'air' && s.timeUs - s.takeoffUs >= 120000`);
  await grabBtn(page).click();
  await waitLab(page, `s.hand.state === 'holding'`);
  await page.setViewportSize({ width: 700, height: 402 });
  await expect(page.getByTestId('lab-pause-cover')).toBeVisible();
  const t0 = (await labState(page)).timeUs;
  await page.waitForTimeout(300);
  expect((await labState(page)).timeUs).toBe(t0);
  await page.setViewportSize({ width: 402, height: 700 });
  await page.getByTestId('lab-resume').click();
  await expect(grabBtn(page)).toHaveText('はなす');
  await grabBtn(page).click();
  await expect(page.getByTestId('lab-outcome')).toBeVisible({ timeout: 15_000 });
});

test('お手本は別の試行で再生し、ボタンを強調する。プレイヤーの試行は進めない', async ({ page }) => {
  await openLab(page, '35');
  const before = await labState(page);
  await page.getByTestId('lab-demo').click();
  await expect(page.getByTestId('lab-demo')).toHaveText('お手本を止める');
  await expect(page.locator('.lab-btn.demo-next').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('lab-status')).toContainText('ボンレスが決まりました', { timeout: 15_000 });
  await expect(page.getByTestId('lab-demo')).toHaveText('お手本を見る', { timeout: 10_000 });
  const after = await labState(page);
  expect(after.attemptId).toBe(before.attemptId);
  expect(after.phase).toBe('ready');
  expect(after.actions).toEqual(before.actions);
});

test('練習広場へ戻ると直前の段階に戻り、競技の記録・送信待ちに変化がない', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-next').click();
  await page.getByTestId('practice-next').click();
  await expect(page.getByTestId('practice-title')).toHaveText('3. 犬だけを回す（円）');
  const storage = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const saved = await storage();
  await page.getByTestId('trick-lab').click();
  await page.selectOption('[data-testid="lab-lesson"]', '01');
  await page.getByTestId('lab-btn-start').click();
  await waitLab(page, `s.timeUs >= 300000`);
  await page.getByTestId('lab-btn-pop').click();
  await expect(page.getByTestId('lab-outcome')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('lab-exit').click();
  await expect(page.getByTestId('practice-title')).toHaveText('3. 犬だけを回す（円）');
  expect(await storage()).toBe(saved);
  expect(await page.evaluate(() => (window as unknown as LabWindow).__inubo.app.lab)).toBeNull();
});
