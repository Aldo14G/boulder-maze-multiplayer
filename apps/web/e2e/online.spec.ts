import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';

interface Snap {
  tick: number;
  phase: string;
  pelletsRemaining: number;
  players: Record<string, { pos: { x: number; y: number }; score: number; alive: boolean }>;
}

async function bootOnline(browser: Browser, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/?mode=online&test=1&name=${name}`);
  return { ctx, page };
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => (window as never as { __BOULDER__: { snapshot(): Snap } }).__BOULDER__.snapshot());

test('two browsers share a lobby and converge on a live match', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await bootOnline(browser, 'ana');
  const b = await bootOnline(browser, 'bob');
  try {
    // both clients see both seats in the lobby
    for (const { page } of [a, b]) {
      await expect(page.locator('#lobby-roster')).toContainText('ana');
      await expect(page.locator('#lobby-roster')).toContainText('bob');
      await page.locator('#btn-primary').click(); // ready up
    }

    // the match starts on both screens
    for (const { page } of [a, b]) {
      await expect(page.locator('#overlay')).toBeHidden();
      await page.waitForFunction(
        () => (window as never as { __BOULDER__: { snapshot(): Snap } }).__BOULDER__.snapshot().phase === 'playing',
      );
    }

    const s0 = await snap(a.page);
    expect(Object.keys(s0.players)).toHaveLength(2);

    // ana steers left down her corridor; the shared pellet pool drains
    await a.page.keyboard.down('ArrowLeft');
    await a.page.waitForTimeout(1200);
    await a.page.keyboard.up('ArrowLeft');

    const [s1a, s1b] = await Promise.all([snap(a.page), snap(b.page)]);
    expect(s1a.phase).toBe('playing');
    expect(s1b.phase).toBe('playing');
    expect(s1a.pelletsRemaining).toBeLessThan(s0.pelletsRemaining);
    // prediction may leave the local client a couple of ticks ahead
    expect(Math.abs(s1a.pelletsRemaining - s1b.pelletsRemaining)).toBeLessThanOrEqual(3);

    // netgraph telemetry is flowing on the online client
    const net = await a.page.evaluate(
      () => (window as never as { __NET__(): { rttMs: number; snapshotsPerSecond: number } }).__NET__(),
    );
    expect(net.snapshotsPerSecond).toBeGreaterThan(0);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});
