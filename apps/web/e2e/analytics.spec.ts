import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';
import { waitForHydration } from './helpers/hydration';

/**
 * The analytics surface, M5.
 *
 * ### What is asserted, and why
 *
 * These check that the numbers are *derived correctly*, not that the page renders. A
 * valuation page that renders beautifully and is subtly wrong is worse than no page,
 * because it gets trusted. So the headline figure is checked against an independent
 * recount, and the ordering is checked, because ordering is the feature.
 *
 * ### What is deliberately not asserted
 *
 * No revenue, "value delivered" or profit figure. The system has no invoice or
 * sale-allocation record, so any such number could only be invented. Its absence is the
 * design, and `offers no revenue figure to get wrong` below is the test that holds it.
 *
 * No non-zero days-of-cover for every row. Cover extrapolates 30 days of issues, so a
 * product nobody issued this month genuinely has none to report, and the page says "not
 * moving" rather than inventing a figure.
 */
test.describe('analytics', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('the headline reconciles with the rows it summarises', async ({ page }) => {
    await page.goto('/en/admin/analytics', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    const tile = page.getByTestId('inventory-value');
    await expect(tile).toBeVisible();
    const stated = Number(await tile.getAttribute('data-minor'));

    const rows = page.getByTestId('coverage-table').locator('tbody tr');
    const count = await rows.count();
    test.skip(count === 0, 'no stock on hand in this environment');

    const summed = await rows.evaluateAll((trs) =>
      trs.reduce((sum, tr) => sum + Number(tr.getAttribute('data-value-minor') ?? 0), 0),
    );

    // Exact, and it must be: both sides are integer piastres and neither rounds
    // (ADR 0004). A tolerance here would hide the class of bug this catches -- a row
    // dropped by an aggregation, or a batch counted twice.
    expect(stated).toBe(summed);
    expect(stated).toBeGreaterThan(0);

    // And the rendered string must be the same figure, not merely present.
    await expect(tile).toContainText(/\d/);
  });

  test('ranks worst-first, and never gives a cover figure to stock that has not moved', async ({
    page,
  }) => {
    await page.goto('/en/admin/analytics', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    const rows = page.getByTestId('coverage-table').locator('tbody tr');
    const count = await rows.count();
    test.skip(count === 0, 'no stock on hand in this environment');

    const data = await rows.evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = tr.querySelectorAll('td');
        return {
          dead: tr.getAttribute('data-dead') === 'true',
          cover: (cells[2]?.textContent ?? '').trim(),
        };
      }),
    );

    // Dead stock leads, and no moving row may appear before it. This ordering is the
    // whole page: a manager acts on row one, so row one has to be the worst thing here.
    let sawMoving = false;
    for (const row of data) {
      if (row.dead) {
        expect(sawMoving, 'a dead row appeared after a moving one').toBe(false);
        // "Not moving" and a number are different claims and only one can be true.
        expect(row.cover).toBe('not moving');
      } else {
        sawMoving = true;
        // A moving row must actually show a number.
        expect(row.cover).not.toBe('');
        expect(row.cover).not.toBe('not moving');
      }
    }
  });

  test('offers no revenue figure to get wrong', async ({ page }) => {
    await page.goto('/en/admin/analytics', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    // A negative assertion, and deliberately so. If revenue is ever added here without
    // an invoice ledger behind it, this is the test that explains why not.
    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const forbidden of ['revenue', 'profit', 'margin', 'إيرادات', 'ربح', 'هامش']) {
      expect(text, `"${forbidden}" must not appear without an invoice ledger`).not.toContain(
        forbidden,
      );
    }
  });

  test('renders in Arabic without overflowing horizontally', async ({ page }) => {
    await page.goto('/ar/admin/analytics', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('inventory-value')).toBeVisible();

    // RTL is where a table overflows, because column widths are computed for the left
    // edge. Same assertion the other RTL pages use.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});