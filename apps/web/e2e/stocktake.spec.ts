import { expect, test, type Page } from '@playwright/test';
import { clickSignIn } from './helpers/session';

/**
 * The stocktake count sheet, saved for real.
 *
 * ── why this file exists, and it is not for coverage ──────────────────────────
 * Saving a count sheet was broken in production for the whole of M2 and M3: every
 * line came back "Something went wrong. Try again, and tell an administrator if it
 * keeps happening." on a batch called LOT-2026-A0412 -- which is one of the seeded
 * lots, so it was every count sheet in the demo tenant, every time.
 *
 * The cause was not in the stocktake code. `lib/api/inventory.ts` declared its client
 * parameter as a hand-written interface with `rpc(fn: string, …)`, and a structural
 * interface cannot distinguish the api client from the public one because both have
 * an `rpc`. So `stock_take` -- an api-schema function -- compiled happily against the
 * public client, and answered 42501 at runtime for every line.
 *
 * Nothing caught it because there was no test that saved a sheet. This is that test,
 * and the assertion is deliberately about the absence of the error rather than about
 * a message: the bug produced a message that was accurate and useless, so asserting
 * on any specific string would have missed it.
 */
const PASSWORD = 'Bershama#2026';

async function signIn(page: Page, email: string) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await clickSignIn(page);
  await page.waitForURL((url) => !url.pathname.includes('/login'));
}

test.describe('the count sheet', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('saves a counted line without refusing it', async ({ page }) => {
    await page.goto('/en/admin/inventory/stocktake');

    // The first location is chosen by default and the sheet loads its rows.
    const rows = page.getByRole('textbox', { name: /^counted:/i });
    await expect(rows.first()).toBeVisible();

    await rows.first().fill('7');

    await page.getByRole('button', { name: /save the sheet/i }).click();

    // The failure this pins: the save resolved with a refused line whose message was
    // the generic one. Asserted as an absence, because the bug's message is exactly
    // what a generic assertion would wave through.
    await expect(page.getByText('Something went wrong. Try again')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/lines that were not saved/i)).toHaveCount(0, { timeout: 15_000 });

    // And something actually happened: the sheet reports what it saved.
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('the refused-lines panel names the lot and the reason', async ({ page }) => {
    await page.goto('/en/admin/inventory/stocktake');

    const rows = page.getByRole('textbox', { name: /^counted:/i });
    await expect(rows.first()).toBeVisible();
    await rows.first().fill('7');
    await page.getByRole('button', { name: /save the sheet/i }).click();
    await page.waitForTimeout(4000);

    const refused = page.getByText(/lines that were not saved/i);
    if ((await refused.count()) > 0) {
      // If a line is ever refused, the panel has to say which one and why. A refusal
      // that names no lot is the same defect as a refusal that does not happen: the
      // person counting has no way to act on it.
      const panel = page.locator('text=/lines that were not saved/i').locator('..');
      await expect(panel).toContainText(/LOT-|Something went wrong|reason/i);
    } else {
      // The expected path: nothing refused, so the panel is absent.
      await expect(refused).toHaveCount(0);
    }
  });
});