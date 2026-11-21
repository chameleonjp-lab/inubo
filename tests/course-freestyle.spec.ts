import { cueForEvent } from '../src/view/effects';
import type { SimEvent } from '../src/game/types';
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
      const titleElement = document.querySelector<HTMLElement>('[data-testid="center-text"]')!;
      const flow = document.querySelector<HTMLElement>('[data-testid="trick-name-flow"]')!;
      const nameElement = flow.querySelector<HTMLElement>('[data-testid="landing-trick-name"]')!;
      const scroll = nameElement.getAnimations()[0];
      scroll.pause();
      scroll.currentTime = Number(scroll.effect!.getComputedTiming().duration) / 2;
      const scoreElement = titleElement.querySelector<HTMLElement>('[data-testid="landing-trick-score"]')!;
      for (const animation of titleElement.getAnimations({ subtree: true })) animation.finish();
      const nameBox = nameElement.getBoundingClientRect();
      const scoreBox = scoreElement.getBoundingClientRect();
      const inViewport = (box: DOMRect) => box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
      const landingLayout = {
        name: nameElement.textContent, score: scoreElement.textContent, tier: titleElement.dataset.trickTier,
        upperHalf: nameBox.bottom <= innerHeight / 2, scoreHeight: scoreElement.offsetHeight,
        nameInViewport: inViewport(nameBox), scoreInViewport: inViewport(scoreBox),
      };
      return {
        version: sim.id.rulesVersion, ranked: sim.id.rankingOptIn, held, heldTurn, displayTurn, drift, premature, speedBeforeReverse, speedAfterReverse,
        drewAir, landingPhase, landingLayout, landing: sim.score.jumps[0], fixedTricks: sim.events.filter(event => event.kind === 'trickStart').length,
      };
    });
    expect(observed.version).toBe(FREE_RULES_VERSION);
    expect(observed.ranked).toBe(entry === 'start');
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
    const layout = observed.landingLayout;
    expect(layout.name).toBe(observed.landing.names[0]);
    const awarded = entry === 'practice' ? observed.landing.points : observed.landing.awarded;
    expect(layout.score).toContain('＋' + awarded.toLocaleString('ja-JP'));
    expect(layout.tier).toMatch(/^[1-5]$/);
    expect(layout.nameInViewport && layout.scoreInViewport).toBe(true);
    expect(layout.upperHalf).toBe(true);
    expect(layout.scoreHeight).toBeGreaterThan(37);
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
    const sample = (kind: string, x: number, y: number) =>
      new PointerEvent(kind, { pointerId: 19, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true });
    const pointer = (kind: string, x: number, y: number) => surface.dispatchEvent(sample(kind, x, y));
    const choose = (target: string) => {
      const button = document.querySelector(`[data-testid="run-target-${target}"]`)!;
      button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: target === 'dog' ? 40 : 41, button: 0,
        pointerType: 'touch', bubbles: true, cancelable: true }));
      return button.getAttribute('aria-pressed');
    };
    await until(() => session.phase === 'running' && sim.simUs >= 40_000);
    const x = innerWidth * 0.45, y = innerHeight * 0.62;
    pointer('pointerdown', x, y);
    const beforeBatch = sim.simUs;
    await until(() => sim.simUs >= beforeBatch + 20_000);
    const jump = sample('pointermove', x, y - 90);
    const firstSwipe = sample('pointermove', x + 12, y - 90);
    Object.defineProperty(jump, 'timeStamp', { value: performance.now() - 8 });
    Object.defineProperty(firstSwipe, 'timeStamp', { value: performance.now() - 4 });
    Object.defineProperty(firstSwipe, 'getCoalescedEvents', { value: () => [jump, firstSwipe] });
    surface.dispatchEvent(firstSwipe);
    await until(() => sim.freeFlight?.motion.omega.common.some(v => Math.abs(v) > 0.2) === true);
    const first = [...sim.freeFlight!.motion.seen.values()][0];
    const jumpToTurnUs = first.atUs - sim.freeFlight!.takeoffUs;
    const dogPressed = choose('dog');
    pointer('pointermove', x + 24, y - 90);
    await until(() => sim.freeFlight!.motion.omega.dog.some(v => Math.abs(v) > 0.2));
    const riderPressed = choose('rider');
    const dogButton = document.querySelector('[data-testid="run-target-dog"]')!;
    dogButton.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    const riderAfterDogRelease = document.querySelector('[data-testid="run-target-rider"]')!.getAttribute('aria-pressed');
    pointer('pointermove', x + 36, y - 90);
    await until(() => sim.freeFlight!.motion.omega.rider.some(v => Math.abs(v) > 0.2));
    const commonPressed = choose('common');
    pointer('pointermove', x + 48, y - 90);
    await until(() => sim.freeFlight!.motion.seen.size === 4);
    const record = Object.values(sim.strokes).find(stroke => stroke.downUs < sim.simUs && stroke.upUs === null && stroke.freeTarget === 'common');
    const result = { jumpToTurnUs, commonPressed, dogPressed, riderPressed, riderAfterDogRelease,
      targets: [...sim.freeFlight!.motion.seen.values()].map(input => input.target),
      sameFinger: !!record && record.tag === 'air', rules: sim.id.rulesVersion };
    pointer('pointerup', x + 48, y - 90);
    return result;
  });
  expect(observed).toMatchObject({ commonPressed: 'true', dogPressed: 'true', riderPressed: 'true', riderAfterDogRelease: 'true',
    targets: ['common', 'dog', 'rider', 'common'],
    sameFinger: true, rules: FREE_RULES_VERSION });
  expect(observed.jumpToTurnUs).toBeGreaterThanOrEqual(0);
  expect(observed.jumpToTurnUs).toBeLessThan(10_000);
});

test('犬種を変更すると着地の文字と画面全体の光の色が切り替わる', async ({ page }) => {
  for (const dogId of DOG_ORDER) {
    await page.goto('/');
    await page.getByTestId(`dog-${dogId}`).click();
    await page.getByTestId('start').click();
    const { main, partner } = DOG_EFFECT_COLORS[dogId];
    const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(s => parseInt(s, 16));
    const mainRgb = rgb(main), partnerRgb = rgb(partner);
    const colors = await page.evaluate(async (first) => {
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
        const score = document.querySelector('[data-testid="landing-trick-score"]');
        if (!score) continue;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 90 && first.every((channel, j) => Math.abs(data[i + j] - channel) < 5)) {
            return getComputedStyle(score).color;
          }
        }
      }
      return null;
    }, mainRgb);
    expect(colors, dogId).toBe(`rgb(${partnerRgb.join(', ')})`);
  }
});


test('技名は上半分の5段を右から左へ流れ、6個目で1段目を差し替える', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  const samples = [60, 220, 550, 950, 1650, 2000].map((points, i) => cueForEvent({
    runId: 'lane-test', seq: i, kind: 'land', atUs: i, pathId: 'start', sMm: 3000, x: 0, y: 0,
    data: {
      names: [`トリック${i + 1}`], points, trickPoints: points,
      trickBase: Math.min(points, 1000), trickTier: Math.min(i + 1, 5), fxTarget: 'B',
    },
  } satisfies SimEvent)!);
  const observed = await page.evaluate((cues) => {
    const { game } = (window as unknown as {
      __inubo: { app: { game: { handleCues: (events: typeof cues) => void; session: RunSession } } }
    }).__inubo.app;
    const flow = document.querySelector<HTMLElement>('[data-testid="trick-name-flow"]')!;
    const labels = () => [...flow.querySelectorAll<HTMLElement>('.flying-trick')];
    game.handleCues(cues.slice(0, 5));
    const before = labels();
    const order = before.map(el => el.textContent);
    const first = before[0], high = before[4];
    const firstStyle = getComputedStyle(first), highStyle = getComputedStyle(high);
    const levelsDiffer = parseFloat(highStyle.fontSize) > parseFloat(firstStyle.fontSize) &&
      Number(highStyle.fontWeight) > Number(firstStyle.fontWeight) &&
      highStyle.color !== firstStyle.color;
    const background = firstStyle.backgroundColor;
    const a = first.getAnimations()[0];
    a.pause();
    const duration = Number(a.effect!.getComputedTiming().duration);
    a.currentTime = 0;
    const startX = first.getBoundingClientRect().left;
    a.currentTime = duration * 0.55;
    const laterX = first.getBoundingClientRect().left;
    const scrollPxPerMs = (startX - laterX) / (duration * 0.55);
    const inUpperHalf = flow.getBoundingClientRect().bottom <= innerHeight / 2;
    game.handleCues(cues.slice(5));
    game.session.sim.score.jumpPoints = 6_300;
    return { order, levelsDiffer, background, startX, scrollPxPerMs, inUpperHalf, after: labels().map(el => el.textContent) };
  }, samples);
  expect(observed.order).toEqual(['トリック1', 'トリック2', 'トリック3', 'トリック4', 'トリック5']);
  expect(observed.after).toEqual(['トリック6', 'トリック2', 'トリック3', 'トリック4', 'トリック5']);
  expect(observed.levelsDiffer && observed.inUpperHalf).toBe(true);
  expect(observed.background).toBe('rgba(0, 0, 0, 0)');
  expect(observed.startX).toBeGreaterThan(390);
  expect(observed.scrollPxPerMs).toBeCloseTo(0.185 * 1.7, 4);
  await expect(page.getByTestId('hud-trick')).toHaveText('技 6,300');
});


test('動きを減らす設定でも長い技名を表示し、前の技名が入り切った段に後続を並べる', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('start').click();
  const names = ['犬の左スピン', '人の右スピン', '限界突破・天翔ける疾風の連続技・犬と人のシンクロ切り返し・9.5回転の大連舞', '後続の技'];
  const cues = names.map((name, i) => cueForEvent({
    runId: 'following-test', seq: i, kind: 'land', atUs: i, pathId: 'start', sMm: 3000, x: 0, y: 0,
    data: { names: [name], points: 1650, trickPoints: 1650, trickBase: 1000, trickTier: 5, fxTarget: 'B' },
  } satisfies SimEvent)!);
  const result = await page.evaluate((events) => {
    const { game } = (window as unknown as {
      __inubo: { app: { game: { handleCues: (cues: typeof events) => void } } }
    }).__inubo.app;
    const flow = document.querySelector<HTMLElement>('[data-testid="trick-name-flow"]')!;
    const edge = flow.getBoundingClientRect().right;
    const labels = () => [...flow.querySelectorAll<HTMLElement>('.flying-trick')];
    const lane = (label: HTMLElement) => label.parentElement!.dataset.lane;
    const show = (i: number) => game.handleCues([events[i]]);
    const freeze = (label: HTMLElement) => {
      const an = label.getAnimations()[0];
      an.pause();
      an.currentTime = 0;
      return an;
    };
    const placeEndAt = (label: HTMLElement, an: Animation, right: number) => {
      const start = label.getBoundingClientRect().right;
      const duration = Number(an.effect!.getComputedTiming().duration);
      const elapsed = (start - right) / start * duration;
      an.currentTime = elapsed;
      return elapsed;
    };

    show(0);
    const [first] = labels();
    const firstAnim = freeze(first);
    const startedAtRight = first.getBoundingClientRect().left >= edge - 1;
    const firstAt = placeEndAt(first, firstAnim, edge - 20);
    show(1);
    const [, second] = labels();
    const secondAnim = freeze(second);
    const startGap = second.getBoundingClientRect().left - first.getBoundingClientRect().right;
    const elapsed = placeEndAt(second, secondAnim, edge - 20);
    firstAnim.currentTime = firstAt + elapsed;
    const nextGap = second.getBoundingClientRect().left - first.getBoundingClientRect().right;
    show(2);
    const [, , long] = labels();
    const longAnim = freeze(long);
    const longWiderThanScreen = long.getBoundingClientRect().width > flow.clientWidth;
    show(3);
    const [, , , fourth] = labels();
    placeEndAt(long, longAnim, edge - 20);
    const lastCharacter = document.createRange();
    const title = long.querySelector('span')!.firstChild as Text;
    lastCharacter.setStart(title, title.length - 1);
    lastCharacter.setEnd(title, title.length);
    const lastRight = lastCharacter.getBoundingClientRect().right;
    return {
      startedAtRight, startGap, nextGap, longWiderThanScreen,
      lastCharacterOnScreen: lastRight > 0 && lastRight <= edge,
      lanes: [first, second, long, fourth].map(lane),
    };
  }, cues);
  expect(result.startedAtRight && result.longWiderThanScreen && result.lastCharacterOnScreen).toBe(true);
  expect(result.lanes).toEqual(['1', '1', '1', '2']);
  expect(result.startGap).toBeGreaterThanOrEqual(13);
  expect(result.nextGap).toBeCloseTo(result.startGap, 0);
});
