import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * Self-serve signup, M5+.
 *
 * ## What is asserted, and why
 *
 * Two things, deliberately.
 *
 * What is left here is only what a browser can check: that the pages render, in both
 * locales, and that they route a person to the right place given who they are.
 *
 * The security properties are asserted elsewhere and more strongly, deliberately.
 * supabase/tests/self_serve_signup.test.sql has 17 assertions on api.provision_tenant,
 * including the one-organisation-per-person gate, and that gate was proved to fail on
 * demand by removing it and watching assertion #6 go red. It was then verified directly
 * against the hosted project, where calling it as the seeded tenant administrator is
 * refused with "already belongs to an organisation" and creates zero tenants.
 *
 * A browser fetch cannot see the session cookie PostgREST needs, so re-asserting the gate
 * from here would have been a weaker copy of a stronger check that also could not have
 * run.
 *
 * ## What is NOT asserted here, and why
 *
 * The full happy path -- sign up, provision, land on the dashboard -- cannot run in CI.
 * It needs Supabase's "Allow new users to sign up" enabled, which is dashboard
 * configuration with no SQL or MCP surface, and it would create a real tenant on the
 * shared project every run. The provisioning function itself is covered properly by
 * supabase/tests/self_serve_signup.test.sql (17 assertions, including the one-per-person
 * gate proved to fail on demand via a canary) and was verified against the hosted project
 * directly. What is left for the browser is the part only a browser can check.
 */
test.describe('self-serve signup', () => {
  test('the signup page offers a form, in English and in Arabic', async ({ page }) => {
    for (const locale of ['en', 'ar'] as const) {
      await page.goto(`/${locale}/signup`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('signup-org')).toBeVisible();
      await expect(page.getByTestId('signup-name')).toBeVisible();
      await expect(page.getByTestId('signup-email')).toBeVisible();
      await expect(page.getByTestId('signup-password')).toBeVisible();
      await expect(page.getByTestId('signup-submit')).toBeVisible();

      // A password field without autocomplete is a password-manager trap, and this is the
      // form where new credentials are created rather than recalled.
      await expect(page.getByTestId('signup-password')).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      await expect(page.getByTestId('signup-email')).toHaveAttribute('autocomplete', 'email');
    }
  });

  test('a signed-in user is sent away from signup rather than shown a form that must fail', async ({
    page,
  }) => {
    await signIn(page, 'admin@demo.local');
    await page.goto('/en/signup', { waitUntil: 'domcontentloaded' });

    // api.provision_tenant would refuse them anyway. Redirecting means they are not shown
    // a form whose submission is guaranteed to fail.
    await page.waitForURL((url) => !url.pathname.endsWith('/signup'), { timeout: 30_000 });
    await expect(page.getByTestId('signup-submit')).toHaveCount(0);
  });

  test('the setup page sends a completed member onward instead of re-onboarding them', async ({
    page,
  }) => {
    await signIn(page, 'admin@demo.local');
    // No waitForHydration here, and the absence is the point: /setup sits outside
    // AuthenticatedShell because that shell is what would refuse to render it -- there is
    // no role and no surface yet. Waiting for the authenticated header would be waiting
    // for something that can never appear on this page.
    await page.goto('/en/setup', { waitUntil: 'domcontentloaded' });

    // They already have an organisation, so /setup has nothing to do. SetupForm treats
    // the "already belongs" refusal as success and redirects to the app rather than
    // showing an error nobody can act on.
    await page.waitForURL((url) => !url.pathname.endsWith('/setup'), { timeout: 60_000 });
  });

  test('a signed-out visitor is sent from setup back to sign in', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/en/setup', { waitUntil: 'domcontentloaded' });

    await page.waitForURL(/\/login/, { timeout: 30_000 });
  });

  test('the signup page does not overflow in Arabic', async ({ page }) => {
    await page.goto('/ar/signup', { waitUntil: 'domcontentloaded' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});