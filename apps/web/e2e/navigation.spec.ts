import { expect, test, type Page } from '@playwright/test';

/**
 * No URL ever contains a doubled locale.
 *
 * This bug has now appeared twice, in two different files, both times by
 * interpolating `/${locale}` into a next-intl `Link` or `useRouter`. next-intl's
 * navigation expects a locale-less path and adds the locale itself, so
 * `/en/admin` becomes `/en/en/admin` -- a 404 on a perfectly reasonable looking
 * link.
 *
 * It got past every other check because the link itself is correct, the click
 * registers, and the destination is a 404 rather than an error. A test that
 * asserts "the logo has an href" passes. The only thing that catches it is
 * following the link and reading where it lands.
 *
 * So this walks the real interface: signs in, clicks every navigational link
 * from every page, and asserts the resulting URL is well formed.
 */
const DOUBLED = /\/(en|ar)\/\1(\/|$|\?)/;

async function signIn(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin', { timeout: 20_000 });
}

const PAGES = [
  '/en/admin',
  '/ar/admin',
  '/en/admin/inventory/stocktake',
  '/ar/admin/inventory/stocktake',
];

test.describe('navigation', () => {
  for (const from of PAGES) {
    test(`every link on ${from} lands somewhere real`, async ({ page }) => {
      await signIn(page);
      await page.goto(from);

      const links = await page.locator('a[href]').evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href')).filter(Boolean) as string[],
      );

      // Each link is followed in a fresh visit, so one broken link does not
      // change the page the next click happens from.
      for (const href of links) {
        await page.goto(from);

        // Not a raw goto(href): the doubled locale is produced by the client
        // router, so the href in the DOM is correct and only the navigation
        // reveals it.
        const link = page.locator(`a[href="${href}"]`).first();
        if ((await link.count()) === 0) continue;

        await link.click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => {});

        const landed = new URL(page.url());
        expect(
          DOUBLED.test(landed.pathname),
          `clicking "${href}" on ${from} landed on a doubled-locale URL: ${landed.pathname}`,
        ).toBe(false);

        // A link must not 404. A navigation item that 404s advertises workflow
        // that does not exist, which is the specific thing the nav is careful
        // about.
        const heading = await page.locator('h1').first().textContent().catch(() => null);
        expect(
          /page could not be found/i.test(heading ?? ''),
          `clicking "${href}" on ${from} produced a 404`,
        ).toBe(false);
      }
    });
  }

  test('the logo goes home, to the surface for the role, in both locales', async ({
    page,
  }) => {
    await signIn(page);

    for (const [start, expected] of [
      ['/en/admin/inventory/stocktake', '/en/admin'],
      ['/ar/admin/inventory/stocktake', '/ar/admin'],
    ] as const) {
        await page.goto(start);
        // Position, not accessible name. The logo link's aria-label is
        // t('common.appName'), which is Arabic on the Arabic page -- so a
        // locator matching /pharmaflow/i finds the link in English and then
        // waits thirty seconds for a link that will never appear. The logo is
        // the first link in the header, which is also how a person identifies
        // it.
        await page.locator('header a').first().click();

      // expect.poll rather than reading page.url() once after a fixed wait. A
      // client-side navigation settles whenever it settles, and the first version
      // of this test read the URL 400ms after the click and declared the logo
      // broken while it was still in flight. Retrying until the URL matches, or
      // until the timeout, asserts what is actually true and is not sensitive to
      // how fast the router happens to be.
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
        .toBe(expected);
      expect(DOUBLED.test(new URL(page.url()).pathname)).toBe(false);
    }
  });

  test('the language switcher keeps the page, not the locale prefix', async ({ page }) => {
    await signIn(page);
    await page.goto('/en/admin/inventory/stocktake');

    await page.getByRole('button', { name: /العربية/ }).click();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe('/ar/admin/inventory/stocktake');
    expect(DOUBLED.test(new URL(page.url()).pathname)).toBe(false);
  });
});
