import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The list surfaces render.
 *
 * ── why this exists ──────────────────────────────────────────────────────────────
 *
 * The catalogue was rebuilt as a real table and shipped broken: the page threw on
 * every visit and rendered "This page couldn't load". The build was green, the unit
 * tests passed, the type checker was happy, and the Browser job passed — because the
 * Browser job never visited the catalogue.
 *
 * A server component cannot hand a render function to a client component, and the
 * failure is a runtime crash rather than a compile error. The only thing that catches
 * it is a browser actually going there.
 *
 * So the smoke suite goes there.
 */
const SURFACES = [
  { path: '/en/admin/inventory/products', expect: 'table' },
  { path: '/en/admin/inventory/batches', expect: 'table' },
  { path: '/en/admin/alerts', expect: 'alert-list' },
  // The dashboard. Its charts are Bklit's now, which means they are client
  // components with a data boundary -- and a data boundary is exactly where a
  // chart breaks at runtime while every type check passes.
  { path: '/en/admin', expect: 'dashboard' },
  // The account settings. It is new, it is the only page a driver can reach
  // that an administrator cannot, and it carries a form, a database column and
  // a session scope -- all three of which are exactly the things that fail at
  // runtime rather than at build time.
  { path: '/en/settings', expect: 'settings' },
];

test.describe('the list surfaces render', () => {
  for (const surface of SURFACES) {
    test(`${surface.path} does not fall over`, async ({ page }) => {
      await signIn(page, process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local');

      const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'the page should not be an error').toBe(200);

      // The error boundary replaces the whole page, so the absence of the failure text
      // is the assertion, and the presence of the thing we wanted is the proof.
      await expect(page.getByText(/couldn.t load/i)).toHaveCount(0);
      await expect(page.getByText(/server error occurred/i)).toHaveCount(0);

      if (surface.expect === 'dashboard') {
        /*
         * The panels, not the charts.
         *
         * The charts are CONDITIONAL -- they render when there are fulfilled
         * deliveries, and the CI fixture has none -- so asserting them here
         * asserted that the fixture had deliveries, which is a claim about the
         * fixture and not about the dashboard. The chart's own mount is tested
         * in charts.test.tsx, where the data is deterministic.
         *
         * What this asserts is the thing that IS always true: the panels are
         * there, and the dashboard says what it has and what it has not.
         */
        await expect(page.getByRole('heading', { name: /ranked|realised/i })).toBeVisible();
        await expect(
          page.getByTestId('bar-trend-chart').or(page.getByText(/nothing delivered/i)),
        ).toBeVisible();
      }

      if (surface.expect === 'settings') {
        // The sections, not just the page. A settings page that renders but is
        // missing a section is a settings page with a hole in it.
        await expect(page.getByRole('heading', { name: /language/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /notification/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /security/i })).toBeVisible();
      }

      if (surface.expect === 'table') {
        await expect(page.locator('table')).toHaveCount(1);
      } else if (surface.expect === 'alert-list') {
        await expect(page.getByTestId('alert-list')).toBeVisible();
      }
    });
  }
});
