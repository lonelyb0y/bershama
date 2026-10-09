import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The three-tier map fallback.
 *
 * The requirement this suite exists to protect is narrow and absolute: **a delivery never
 * shows a blank rectangle.** Google can fail for reasons nobody here controls -- a lapsed
 * key, a referrer allowlist that does not match the domain, a daily quota, a blocked script.
 * MapLibre can fail for its own reason -- no WebGL on an old or locked-down handset, and
 * drivers use whatever phone is in their pocket. The static map needs neither.
 *
 * So the assertions are about *which* tier rendered only where that is knowable, and about
 * the invariant everywhere else.
 */

const TESTIDS = {
  google: 'google-map',
  maplibre: 'maplibre-map',
  static: 'stop-map',
} as const;

/** How many of the three tiers are on screen. Must never exceed one. */
async function renderedTiers(page: import('@playwright/test').Page) {
  const found: string[] = [];
  for (const [name, id] of Object.entries(TESTIDS)) {
    if ((await page.getByTestId(id).count()) > 0) found.push(name);
  }
  return found;
}

test.describe('map fallback tiers', () => {
  test('exactly one map renders, and it has drawn something', async ({ page }) => {
    test.setTimeout(180_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    // The tier is chosen during hydration and can change when one fails, so this waits for
    // the choice to settle rather than snapshotting it. A single read catches Google
    // mid-load, before it has either drawn or given up.
    await expect
      .poll(async () => (await renderedTiers(page)).length, { timeout: 40_000 })
      .toBe(1);

    const [tier] = await renderedTiers(page);
    expect(
      tier,
      'exactly one tier must render -- two at once means a fallback did not replace its predecessor',
    ).toBeTruthy();

    // And it drew something. Visible with non-zero dimensions is satisfied by an empty div
    // with a height, which is exactly how the last version of this suite passed while the
    // map was blank.
    const container = page.getByTestId(TESTIDS[tier as keyof typeof TESTIDS]).first();
    await expect(container).toBeVisible();

    if (tier === 'google') {
      await expect
        .poll(
          () => container.evaluate((el) => el.querySelectorAll('img, canvas').length),
          { timeout: 30_000, message: 'the Google map rendered tiles or a canvas' },
        )
        .toBeGreaterThan(0);
    } else if (tier === 'maplibre') {
      // A MapLibre canvas. Without a basemap style the canvas is still there, which is the
      // point: markers and route draw on it even when no tiles can be fetched.
      await expect
        .poll(
          () => container.evaluate((el) => el.querySelectorAll('canvas').length),
          { timeout: 30_000, message: 'the MapLibre map created its canvas' },
        )
        .toBeGreaterThan(0);
    }
  });

  test('a rejected Google key falls through instead of leaving an empty map', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // The failure mode worth spending a test on: a key that is *present* and therefore
    // selects the Google tier, and is *wrong*, so the tier renders and then fails. Before
    // the fall-through existed that produced a blank rectangle with no error anywhere.
    await page.route('**/maps.googleapis.com/maps/api/js**', (route) => route.abort());

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await expect
      .poll(async () => (await renderedTiers(page)).length, { timeout: 40_000 })
      .toBe(1);

    const [tier] = await renderedTiers(page);

    // The point of the test. Without this the assertion above would pass just as happily
    // with 'google' still on screen -- which is the bug, because the request was aborted
    // and Google cannot possibly have drawn anything.
    expect(
      tier,
      'a rejected Google key must not leave the Google tier on screen',
    ).not.toBe('google');

    // MapLibre is interactive and needs no key, so it is the tier that should absorb this
    // failure. The static map is an acceptable last resort -- on a device with no WebGL it
    // is the only thing left -- so both are allowed, but Google is not.
    expect(['maplibre', 'static']).toContain(tier);
  });

  test('maplibre is only downloaded when it is needed', async ({ page }) => {
    test.setTimeout(180_000);

    // The lazy-load claim, checked rather than asserted. MapLibre is ~800 KB gzipped and
    // Google is the preferred tier, so on a healthy configuration it must never be fetched.
    // `test.skip` because this is only meaningful where a key is configured: with no key
    // MapLibre is the *first* tier and loading it is the correct behaviour.
    // Opt-in via MAP_EXPECT_GOOGLE=1 rather than read from the environment, for the same
    // reason the keyless privacy test is: `process.env` in the Playwright process is not
    // where the dev server reads its configuration from, so branching on it silently takes
    // the wrong path. This is a property of the server, so it is asserted by whoever runs
    // it rather than guessed at.
    test.skip(
      process.env.MAP_EXPECT_GOOGLE !== '1',
      'run with MAP_EXPECT_GOOGLE=1 against a server that has a working Google key',
    );

    const maplibreRequests: string[] = [];
    page.on('request', (req) => {
      if (/maplibre-gl|maplibre/i.test(req.url())) maplibreRequests.push(req.url());
    });

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_000);

    expect(
      maplibreRequests,
      `MapLibre should not load while Google works: ${maplibreRequests.join(', ')}`,
    ).toEqual([]);
  });
});