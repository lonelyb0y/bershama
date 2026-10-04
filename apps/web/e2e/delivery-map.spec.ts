import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The map provider switch.
 *
 * The safety property is not "which provider is configured" -- it is **a map always
 * renders**. A delivery whose map is blank is worse than one whose tiles are less
 * familiar, and the reason that holds is that the keyless OpenStreetMap map is a fallback
 * rather than an error state.
 *
 * So most of these assertions are deliberately provider-agnostic. An earlier version
 * asserted `google-map` had *zero* matches, which passed only because no key happened to
 * be set in CI, and would have failed the moment a real key was added -- a test that
 * breaks when the feature starts working is a test asserting the environment, not the
 * behaviour.
 */
/**
 * Asserting on the environment from the test process does not work.
 *
 * `process.env` here is Playwright's environment, while the variable that decides the
 * provider is read by the *dev server*, from `.env.local` at the repository root. The two
 * are not the same, so branching on it produced a test that took the keyless branch and
 * then failed because Google was contacted anyway.
 *
 * Which is the more general lesson: a test that branches on configuration is asserting the
 * configuration, not the behaviour. The invariant is that exactly one map renders, and
 * that holds whichever provider is chosen -- so that is what gets asserted.
 */

/**
 * Wait for the map to settle on exactly one provider: never two, never none.
 *
 * Written with `expect.poll` rather than a single count, because the provider is chosen
 * during hydration and a one-shot count captures the page mid-transition. That produced a
 * genuinely confusing failure: the assertion message reported `keyless=1, google=0` -- a
 * correct state -- while the value it compared had been read a moment earlier and was 0.
 *
 * A settling condition needs an assertion that settles. Polling is the honest expression
 * of "eventually exactly one", where a single read is only ever a snapshot of a page that
 * is still arriving.
 */
async function expectExactlyOneMap(page: import('@playwright/test').Page) {
  const keyless = page.getByTestId('stop-map');
  const google = page.getByTestId('google-map');

  await expect
    .poll(
      async () => (await keyless.count()) + (await google.count()),
      { timeout: 30_000, message: 'exactly one map provider rendered' },
    )
    .toBe(1);

  // And it is visible, not merely present. A zero-height container would pass a count.
  await expect(keyless.or(google).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Did a map actually *draw*?
 *
 * This is the assertion whose absence let a real bug through. `expectExactlyOneMap` and a
 * non-zero bounding box both passed while the map was completely empty: the container had
 * a height, the provider rendered, no request failed, and nothing appeared. Checking that
 * an element exists is not the same as checking it drew.
 *
 * Polled, because tiles arrive after the element does.
 */
async function expectSomethingDrew(page: import('@playwright/test').Page) {
  // Settle the provider FIRST. Checking for drawn content while the choice is still being
  // made observes Google mid-load, before it has either drawn or given up -- which is how
  // this test reported "rendered no tiles" for a provider that had already fallen back.
  await expectExactlyOneMap(page);

  const google = page.getByTestId('google-map');

  // Only meaningful for the Google provider; the keyless map is hand-drawn SVG, so it has
  // no tiles to find. Skipping rather than failing keeps this assertion honest about what
  // it is checking.
  if ((await google.count()) === 0) return 'keyless';

  await expect
    .poll(
      async () =>
        google.first().evaluate(
          (el) =>
            // Google mounts its own DOM: a canvas for vector tiles, or img/div tiles for
            // raster, plus the style container. An empty container has none of them.
            el.querySelectorAll('canvas, img, .gm-style > div').length,
        ),
      { timeout: 30_000, message: 'the Google map rendered tiles or a canvas' },
    )
    .toBeGreaterThan(0);

  return 'google';
}

test.describe('delivery map', () => {
  test('the driver gets a map whichever provider is configured', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'driver@demo.local', 'PharmaFlow#2026', '**/driver');
    await page.goto('/en/driver', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expectExactlyOneMap(page);
  });

  test('the dispatcher gets a map whichever provider is configured', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await expectExactlyOneMap(page);
  });

  test('the map loads without logging an error', async ({ page }) => {
    test.setTimeout(120_000);

    // The failure mode that matters: a key that is present but wrong. Google answers 200
    // for the script and then fails at runtime with an on-page error, which would leave
    // the map container present and empty -- a rectangle of nothing, mid-delivery.
    //
    // So this checks for console errors rather than for the container's existence, which
    // is the difference between "the element is there" and "the map is there".
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    const mapErrors = errors.filter(
      (e) => /maps|google|INVALID_KEY|RefererNotAllowed|ApiNotActivated/i.test(e),
    );
    expect(mapErrors, `map failed to load: ${mapErrors.join(' | ')}`).toEqual([]);
  });

  test('a map container actually has size', async ({ page }) => {
    test.setTimeout(120_000);

    // Catches the empty-rectangle case specifically: an element that is present, visible
    // to Playwright, and nonetheless zero-by-zero because the renderer never drew into it.
    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    const provider = await expectSomethingDrew(page);

    const container = page.getByTestId('google-map').or(page.getByTestId('stop-map'));
    await expect(container).toBeVisible({ timeout: 30_000 });

    const box = await container.boundingBox();
    expect(box?.width ?? 0, 'map width').toBeGreaterThan(50);
    expect(box?.height ?? 0, 'map height').toBeGreaterThan(50);

    // Named so a failure says which provider was on screen and drew nothing, rather than
    // leaving it to be inferred.
    expect(provider, 'provider that rendered').toBeTruthy();
  });

  test('no request is made to Google when no key is configured', async ({ page }) => {
    test.setTimeout(120_000);

    // Opt-in, because it can only be run against a server started *without* a key, and
    // the test process cannot see the server's environment. `MAP_KEYLESS=1` is asserted by
    // the operator running it, which is honest: it is a property of the server, not of
    // this test.
    //
    // The reason it is worth having: privacy as much as cost. A deployment that has not
    // opted in should send no driver coordinates to a third party at all.
    test.skip(
      process.env.MAP_KEYLESS !== '1',
      'needs a server started without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; run with MAP_KEYLESS=1',
    );

    const googleRequests: string[] = [];
    page.on('request', (req) => {
      if (/googleapis|gstatic|google\.com\/maps/i.test(req.url())) googleRequests.push(req.url());
    });

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);

    expect(googleRequests, `unexpected Google requests: ${googleRequests.join(', ')}`).toEqual(
      [],
    );
  });
});