import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The map provider switch.
 *
 * The safety property is the fallback, not Google. A key is a preference; if it is absent
 * or broken the run must still render, because a delivery whose map is blank is worse than
 * a delivery whose tiles are less familiar.
 *
 * These run with no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set, so they exercise the keyless
 * path. That is deliberate: the keyless path is the one that has to work unconditionally,
 * since it is what runs when the key is missing.
 */
test.describe('delivery map', () => {
  test('the driver still gets a map with no Google key configured', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'driver@demo.local', 'PharmaFlow#2026', '**/driver');
    await page.goto('/en/driver', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Whichever map renders, *a* map renders. This is the assertion that would fail if
    // someone made the provider switch unconditional.
    await expect(page.getByTestId('stop-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('google-map')).toHaveCount(0);
  });

  test('the dispatcher still gets a map with no Google key configured', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/demo/rearm', { method: 'POST' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[data-testid^="run-"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('stop-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('google-map')).toHaveCount(0);
  });

  test('no request is made to Google when no key is configured', async ({ page }) => {
    test.setTimeout(120_000);

    // The stronger version of the same claim: without a key the app must not even reach
    // for the third party. A deployment with no key should send no driver coordinates off
    // the machine at all, which is the privacy argument for leaving it unset.
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