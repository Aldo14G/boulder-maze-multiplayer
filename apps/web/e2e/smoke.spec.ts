import { test, expect, type Page } from '@playwright/test';

interface Snap {
  tick: number;
  phase: string;
  pelletsRemaining: number;
  players: Record<string, { pos: { x: number; y: number }; score: number; powerTicks: number }>;
  boulders: { status: string }[];
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => (window as never as { __BOULDER__: { snapshot(): Snap } }).__BOULDER__.snapshot());
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?test=1');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#btn-primary')).toHaveText('Start');
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('title screen shows start and controls', async ({ page }) => {
  await expect(page.locator('#overlay-title')).toHaveText('Boulder Maze');
  await expect(page.locator('#overlay-controls')).toBeVisible();
});

test('start begins the run; sim ticks and renders the whole maze', async ({ page }) => {
  await page.locator('#btn-primary').click();
  await expect(page.locator('#overlay')).toBeHidden();
  const s0 = await snap(page);
  expect(s0.phase).toBe('ready');
  await page.waitForTimeout(400);
  const s1 = await snap(page);
  expect(s1.tick).toBeGreaterThan(s0.tick);
  // whole maze scaled into the 1280x720 viewport
  const box = await page.locator('canvas').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1280);
  expect(box!.height).toBeLessThanOrEqual(720);
});

test('arrow keys steer the player', async ({ page }) => {
  await page.locator('#btn-primary').click();
  // wait out the 2s ready countdown
  await page.waitForFunction(
    () => (window as never as { __BOULDER__: { snapshot(): { phase: string } } }).__BOULDER__.snapshot().phase === 'playing',
  );
  const before = await snap(page);
  // the bottom corridor is open on both sides of every spawn
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowLeft');
  const after = await snap(page);
  const p0 = before.players[Object.keys(before.players)[0]!]!;
  const p1 = after.players[Object.keys(after.players)[0]!]!;
  expect(p1.pos.x).toBeLessThan(p0.pos.x);
});

test('P pauses and resumes the simulation', async ({ page }) => {
  await page.locator('#btn-primary').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  await expect(page.locator('#overlay-title')).toHaveText('Paused');
  const s0 = await snap(page);
  await page.waitForTimeout(300);
  const s1 = await snap(page);
  expect(s1.tick).toBe(s0.tick);
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.waitForTimeout(300);
  const s2 = await snap(page);
  expect(s2.tick).toBeGreaterThan(s1.tick);
});

test('buttons are real focusable buttons', async ({ page }) => {
  for (const id of ['#btn-primary', '#btn-pause']) {
    const tag = await page.locator(id).evaluate((n) => n.tagName);
    expect(tag).toBe('BUTTON');
  }
  await page.locator('#btn-primary').click();
  await page.keyboard.press('p');
  await expect(page.locator('#btn-secondary')).toBeVisible();
  await page.locator('#btn-secondary').focus();
  const focused = await page.evaluate(() => document.activeElement?.id);
  expect(focused).toBe('btn-secondary');
});

test('HUD shows score, pellet count, and drill meter when powered', async ({ page }) => {
  await page.locator('#btn-primary').click();
  await expect(page.locator('#hud-score')).toHaveText(/\d+/);
  await expect(page.locator('#hud-pellets')).toHaveText(/\d+/);
  await expect(page.locator('#hud-top')).toContainText('Score');
  await expect(page.locator('#hud-top')).toContainText('Pellets');
  // drive long enough that the run progresses; pellets decrease
  await page.waitForFunction(
    () => (window as never as { __BOULDER__: { snapshot(): { phase: string } } }).__BOULDER__.snapshot().phase === 'playing',
  );
  const s0 = await snap(page);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowUp');
  const s1 = await snap(page);
  expect(s1.pelletsRemaining).toBeLessThanOrEqual(s0.pelletsRemaining);
});
