import { expect, test, type Page } from '@playwright/test';

import { waitForHydration } from './helpers/hydration';

/**
 * Sign-in, and the loop it caused.
 *
 * This is the test that would have caught the bug reported as "after login it
 * throws me to the same URL": the form accepted the credentials, called
 * router.replace(), and the server redirected straight back to the form. The
 * browser said sign-in worked; the server disagreed about whether anyone was
 * signed in.
 *
 * The assertions are on the URL the browser ENDS UP at, not on whether the
 * request succeeded. A sign-in that 302s straight back to /login is a 200 for
 * every API involved and a total failure for the person using it.
 */

// The seeded demo accounts. The password is not a secret -- it is in
// supabase/seed.sql and in the README -- and these are throwaway credentials on a
// deployment behind Vercel Deployment Protection.
const ACCOUNTS = [
  { email: 'admin@demo.local', surface: 'admin', name: 'Ahmed Hassan' },
  { email: 'pharmacy@demo.local', surface: 'pharmacy', name: null },
    // DRIVER since M4, so this lands on /driver. It was a DISTRIBUTOR before,
    // which was honest about there being no driver surface to route to.
    { email: 'driver@demo.local', surface: 'driver', name: null },
] as const;

async function signIn(page: Page, email: string, locale = 'en') {
  await page.goto(`/${locale}/login`);

  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.describe('the app is reachable', () => {
  test('serves the sign-in page', async ({ page }) => {
    const response = await page.goto('/en/login');

    // A 500 here is what the deployed project returned with no environment
    // variables configured: requireEnv() threw on the first request.
    expect(response?.status(), 'the login page should render, not 500').toBe(200);
    await expect(page.getByRole('heading', { name: /pharmaflow/i })).toBeVisible();
  });

  test('serves the Arabic sign-in page right to left', async ({ page }) => {
    const response = await page.goto('/ar/login');
    expect(response?.status()).toBe(200);
    // The direction is the whole point of the Arabic half, and a regression here
    // is invisible to any test that does not look at the html element.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test.describe('signing in', () => {
  for (const account of ACCOUNTS) {
    test(`${account.email} lands on /${account.surface} and stays there`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });

      await signIn(page, account.email);

      // The assertion that matters: the URL the browser settles on.
      //
      // Before the fix this ended on /en/login again -- the form accepted the
      // credentials, the client navigated to the dashboard, the server saw no
      // session and redirected back. Every layer reported success.
      await page.waitForURL(`**/${account.surface}`, { timeout: 20_000 });
      await expect(page).toHaveURL(new RegExp(`/${account.surface}$`));

      // And it is a real dashboard, not an error page wearing the right URL.
      await expect(page.getByRole('navigation')).toBeVisible();
      await expect(page.getByText(/sign in/i)).toHaveCount(0);

      // A PGRST202 from the proxy is the signature of a call going to the wrong
      // schema, and it is caught by the console rather than by the status code.
      const schemaErrors = consoleErrors.filter((e) => /PGRST202|does not exist/i.test(e));
      expect(schemaErrors, 'no api.* function should be called on the public schema').toEqual(
        [],
      );
    });
  }

  test('the session survives a reload, so it is a cookie and not memory', async ({
    page,
  }) => {
    await signIn(page, 'admin@demo.local');
    await page.waitForURL('**/admin', { timeout: 20_000 });

    await page.reload();

    // If the session lived in localStorage only, the server would see no cookie
    // and bounce straight back to the form on every refresh. That is precisely
    // the bug this test exists for.
    //
    // Asserted on the exact pathname, not a trailing /admin regex. A regex like
    // /\/admin$/ is also satisfied by /en/en/admin -- the doubled-locale 404 -- so
    // the weak version of this assertion passed while the app was broken. It is
    // the same mistake the curl checks kept making: matching something that looks
    // right instead of the thing that is right.
    expect(new URL(page.url()).pathname).toBe('/en/admin');
  });

  test('signs out', async ({ page }) => {
    await signIn(page, 'admin@demo.local');
    await page.waitForURL('**/admin', { timeout: 20_000 });
    // Hydration, or the click lands on markup with no handler on it yet.
    await waitForHydration(page);

    // Sign-out moved into the account menu when the header was rebuilt, so the old
    // one-line version of this test was clicking a button that no longer exists in the
    // DOM. It had been failing since then, and the failure was accurate: the test was
    // not wrong to report it.
    //
    // What it was not reporting was the reason. The menu itself was crashing the route
    // -- `MenuGroupContext is missing` -- so opening it replaced the page with the
    // global error boundary. The test said "sign-out is not clickable", which pointed
    // at the button; the button was fine.
    await page.getByTestId('account-menu').click();
    await expect(page.getByRole('menu')).toBeVisible();

    // `menuitem`, not `button`: it is a real submit button, but a menu item's explicit
    // role is what it is announced and navigated as.
    //
    // POST, not a link: a GET sign-out can be triggered by any page loading an
    // image at that URL, which is why the route is a POST in the first place.
    await page.getByRole('menuitem', { name: /sign out/i }).click();

    await page.waitForURL('**/login', { timeout: 20_000 });
    await expect(page.getByLabel(/email address/i)).toBeVisible();
  });
});

test.describe('the guard', () => {
  test('redirects an anonymous visitor away from a protected page', async ({ page }) => {
    await page.goto('/en/admin');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('is not fooled by a doubled locale', async ({ page }) => {
    // The URL from the bug report. A nonsense path must be a 404, not a
    // redirect that lands somewhere plausible and confusing.
    const response = await page.goto('/ar/ar/admin');
    expect(response?.status()).toBe(404);
  });

  test('a pharmacy manager does not reach the admin surface', async ({ page }) => {
    // RLS and the route guard are separate defences. This asserts the guard,
    // which is the one a user hits.
    await signIn(page, 'pharmacy@demo.local');
    await page.waitForURL('**/pharmacy', { timeout: 20_000 });

    // 404, not a redirect, and this is the intended behaviour rather than a
    // tolerance: a user who guesses /admin should not learn that the surface
    // exists, let alone that their role is what stopped them. A redirect to
    // /pharmacy would confirm the page is real.
    //
    // The URL therefore stays on /en/admin, so the assertion is on the status
    // code. Asserting the URL changed -- the first version of this test -- would
    // have failed against correct code and passed against a guard that silently
    // let people through to a dashboard.
    const response = await page.goto('/en/admin');
    expect(response?.status()).toBe(404);

    // And nothing from the admin surface leaked into the response.
    await expect(page.getByRole('heading', { name: /dashboard/i })).toHaveCount(0);
  });
});
