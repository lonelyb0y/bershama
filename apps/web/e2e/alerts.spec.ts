import { test, expect } from '@playwright/test';

import { waitForHydration } from './helpers/hydration';

/** Sign in through the UI, the way a person does, then wait for hydration. */
async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'));
  await waitForHydration(page);
}

test.describe('the alert centre', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('runs the scan and shows what it raised', async ({ page }) => {
    await page.goto('/en/admin/alerts');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The scan is a warehouse-manager action, so the button has to exist for an
    // administrator. Its absence would mean the surface shipped read-only.
    await expect(page.getByTestId('run-alert-scan')).toBeVisible();
    await page.getByTestId('run-alert-scan').click();

    // The scan's *result*, not merely that the page survived.
    //
    // The first version of this test clicked the button and asserted the list still
    // rendered, which passed while the scan was throwing on a column that does not
    // exist -- `batches.batch_code`. A button that fails has to fail its test.
    await expect(page.getByText(/scan complete/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('scan-error')).toHaveCount(0);
    await expect(page.getByTestId('alert-error')).toHaveCount(0);

    // And whichever way it went, this must still be the alert centre rather than an
    // error boundary -- the assertion that would have caught the Base UI crash.
    await expect(page.getByTestId('alert-list')).toBeVisible();
    await expect(page.getByText(/couldn.t load/i)).toHaveCount(0);
  });

  test('severities are ordered worst first', async ({ page }) => {
    await page.goto('/en/admin/alerts');
    await expect(page.getByTestId('alert-list')).toBeVisible();

    const severities = await page.locator('[data-severity]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-severity')),
    );

    const rank: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };
    const ranks = severities.map((s) => rank[s ?? 'INFO'] ?? 9);
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  test('acknowledging an alert changes what it asks for', async ({ page }) => {
    await page.goto('/en/admin/alerts');
    await expect(page.getByTestId('alert-list')).toBeVisible();

    // Scan first, so the test does not depend on whether a previous run left an open
    // alert behind. That also makes it independent of test order, which matters
    // because this file is not serial and the scan test may run after this one.
    await page.getByTestId('run-alert-scan').click();
    await expect(page.getByText(/scan complete/i)).toBeVisible({ timeout: 20_000 });

    const ackForm = page.locator('[data-testid^="ack-"]').first();
    test.skip((await ackForm.count()) === 0, 'the scan raised nothing open to acknowledge');

    const alertId = (await ackForm.getAttribute('data-testid'))?.replace('ack-', '') ?? '';
    const row = page.locator(`[data-testid="resolve-${alertId}"]`).locator('xpath=ancestor::li');

    // Acknowledged is not resolved, so the row stays on the page -- deliberately. It
    // stops being *work* and becomes a record that someone looked at it.
    //
    // The first version of this test asserted the row disappeared, which is the wrong
    // model: it would mean acknowledging an alert destroyed the only record that it had
    // ever been raised, and "what happened to last week's expiry alerts" becomes
    // unanswerable.
    await expect(row.getByText(/acknowledged/i)).toHaveCount(0);
    await ackForm.getByRole('button').click();

    await expect(row.getByText(/acknowledged/i)).toBeVisible({ timeout: 15_000 });
    // The acknowledge button is gone because there is nothing left to acknowledge --
    // resolve is still offered, because the alert is still open.
    await expect(page.locator(`[data-testid="ack-${alertId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="resolve-${alertId}"]`)).toHaveCount(1);

    // Resolving is the end of it: the alert leaves the default view, which lists OPEN
    // and ACK. It is not gone -- "?status=all" still has it, and a scan will raise it
    // again while the problem persists -- but it is no longer asking for anything.
    await page.locator(`[data-testid="resolve-${alertId}"]`).getByRole('button').click();
    await expect(page.locator(`[data-testid="resolve-${alertId}"]`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // And it is still on the record, which is the half that matters for an audit.
    await page.goto('/en/admin/alerts?status=all');
    await expect(page.locator('[data-testid="alert-list"]')).toBeVisible();
    await expect(page.getByText(/resolved/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a pharmacy account cannot reach the alert centre at all', async ({ browser }) => {
    // There is no analyst in the seed, so this uses the pharmacy account instead --
    // the point is the same and stronger: a role that has no business in a warehouse
    // alert centre should be refused by the guard rather than shown a page whose every
    // button returns 403.
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();

    // Not the shared `signIn`: that waits for the authenticated header, and a pharmacy
    // account is deliberately kept off the admin surface -- so the thing being asserted
    // here is precisely that it never gets one. Wait for the session to resolve and
    // land wherever it lands.
    await page.goto('/en/login');
    await page.getByLabel(/email address/i).fill('pharmacy@demo.local');
    await page.getByLabel(/password/i).fill('PharmaFlow#2026');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });

    await page.goto('/en/admin/alerts', { waitUntil: 'domcontentloaded' });

    // `notFound()` rather than a redirect, deliberately: a user who guesses /admin
    // should not learn that the path exists. So the URL is unchanged and the assertion
    // is about the page, not the address -- an earlier version of this test checked the
    // URL and passed only because a 404 keeps it.
    await expect(page.getByRole('heading', { name: /alerts/i })).toHaveCount(0);
    await expect(page.getByTestId('alert-list')).toHaveCount(0);

    await context.close();
  });
});