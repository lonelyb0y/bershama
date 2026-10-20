import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The driver map: real tiles when there is signal, a plotted route when there is not.
 *
 * The second test is the one that matters. Tiles are an enhancement layered over a map that
 * already worked, and an enhancement that quietly becomes the only thing on screen is a
 * regression wearing a feature's clothes. A driver in a basement is the case this component
 * exists for.
 */
test.describe('the stop map', () => {
  async function armedDriver(page: import('@playwright/test').Page, browser: import('@playwright/test').Browser) {
    const adminCtx = await browser.newContext({ locale: 'en-GB' });
    const admin = await adminCtx.newPage();
    await signIn(admin, 'admin@demo.local');
    await admin.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await admin.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await adminCtx.close();

    await signIn(page, 'driver@demo.local', 'Bershama#2026', '**/driver');
    await page.goto('/en/driver', { waitUntil: 'domcontentloaded' });
  }

  test('draws the run on map tiles when they can be fetched', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await armedDriver(page, browser);

    const map = page.getByTestId('stop-map');
    await map.waitFor({ timeout: 30_000 });

    // `data-tiles` is what the component computed, not what the network managed, so this
    // asserts the tile maths ran rather than that a CDN was reachable. The count is not
    // asserted: how many tiles a bounding box needs depends on the stops, and a test that
    // pinned that number would fail every time the demo run was re-armed.
    await expect(map).toHaveAttribute('data-tiles', 'on');
    await expect(page.getByTestId('stop-map-tiles').locator('image').first()).toHaveCount(1);

    // Attribution is a licence requirement, not decoration.
    await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  });

  test('still plots the run when the tiles cannot be fetched', async ({ page, browser }) => {
    test.setTimeout(120_000);

    // What "no signal" looks like to a page.
    await page.route('**://tile.openstreetmap.org/**', (route) => route.abort());

    await armedDriver(page, browser);

    const map = page.getByTestId('stop-map');
    await map.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    // Markers and the route are server-rendered, so they are present regardless of the
    // network. Two stops means at least two filled circles plus the "is next" ring.
    const circles = await map.locator('circle').count();
    expect(circles).toBeGreaterThanOrEqual(3);

    // And the map still knows what it is: the fallback is not an error state.
    await expect(map).toBeVisible();
  });
});
