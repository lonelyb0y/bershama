import { expect, test, type Page } from '@playwright/test';
import { clickSignIn } from './helpers/session';
import { ADMIN_EMAIL, E2E_PASSWORD } from './helpers/accounts';

/**
 * Dark mode.
 *
 * Bershama is dark-first: the palette in globals.css has dark in `:root` and
 * light in `:root.light`, so the product's own theme is what a stylesheet alone
 * delivers -- no script, no stored preference, no flash, and no dependence on the
 * operating system's colour scheme.
 *
 * These tests assert the computed value, not the presence of a class. A test that
 * only checked for `.dark` on <html> would have passed against an earlier build
 * that shipped a complete dark theme which could not possibly apply.
 */
async function signIn(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await clickSignIn(page);
  await page.waitForURL('**/admin', { timeout: 20_000 });
}

/**
 * Is this colour dark?
 *
 * The palette is authored in oklch, and Chromium serialises the computed value
 * back as `lab(L a b)`. So there is no RGB triple to average -- the first version
 * of this helper ran a regex over the numbers and got 3.68 as a red channel,
 * which made a genuinely dark surface read as bright.
 *
 * lab L is perceptual lightness, 0 = black and 100 = white, so it answers the
 * question directly for the lab() form. The rgb() branch is kept for the case
 * where a browser serialises differently, so this does not quietly become a
 * no-op on another engine.
 */
function isDark(colour: string): boolean {
  const lab = colour.match(/lab\(\s*([\d.]+)/);
  if (lab) return Number(lab[1]) < 50;

  const rgb = colour.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((n) => Number(n.trim()));
    return (r + g + b) / 3 < 128;
  }

  throw new Error(`cannot judge brightness of "${colour}"`);
}

async function surface(page: Page) {
  await page.goto('/en/login');
}

/**
 * The body's background, once it has one.
 *
 * Retries rather than reading once, because a computed style is available before the
 * stylesheet that sets it has loaded. Reading it immediately after a reload returns
 * whatever the browser defaults to -- white -- which is indistinguishable from a
 * theme that did not apply.
 */
async function pollBackground(page: Page): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        last = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        return last;
      },
      { timeout: 10_000 },
    )
    .not.toBe('rgba(0, 0, 0, 0)');
  return last;
}

test.describe('dark mode', () => {
  test('defaults to the dark palette, whatever the system says', async ({ page }) => {
    /*
     * The reversal, and the whole point of it.
     *
     * Dark is the BASE in globals.css, not a variant of it. So with no stored
     * preference the page is the product's own theme, and the operating system's
     * colour scheme has no say in the matter -- a visitor whose laptop is set to
     * light sees the dark console, because that is what Bershama is.
     *
     * This test used to assert the opposite, and it was the right assertion for
     * the product as it was. It changed because the product changed, not because
     * the test was wrong.
     */
    await page.emulateMedia({ colorScheme: 'light' });
    await surface(page);

    // Not a class check. The actual painted value, which is the thing a person
    // would notice if it were wrong.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `body background ${bg} should be dark`).toBe(true);
  });

  test('the operating system preference does not change the default', async ({
    page,
  }) => {
    /*
     * The other half of the same reversal: a dark-scheme browser gets the same
     * answer, and so does a light-scheme one. There is no "follow the OS" state
     * any more, because the system preference is not a preference this product
     * has an opinion about.
     */
    await page.emulateMedia({ colorScheme: 'dark' });
    await surface(page);

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `body background ${bg} should be dark`).toBe(true);
  });

  test('an explicit choice overrides the OS in both directions', async ({ page }) => {
    // Light OS, dark choice.
    await page.emulateMedia({ colorScheme: 'light' });
    await surface(page);
    await page.evaluate(() => {
      localStorage.setItem('bershama:theme', 'dark');
    });
    await page.reload();

    // Polled rather than read once. getComputedStyle does not wait for the
    // stylesheet, so on a cold reload the body has no background yet and the first
    // version of this test failed intermittently with a white value -- which reads as
    // a theme bug and is not one.
    let bg = await pollBackground(page);
    expect(isDark(bg), `dark choice on a light OS: ${bg}`).toBe(true);

    // Dark OS, light choice. The other direction, which is the one that gets
    // missed: an explicit light must beat a dark system preference.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      localStorage.setItem('bershama:theme', 'light');
    });
    await page.reload();

    bg = await pollBackground(page);
    expect(isDark(bg), `light choice on a dark OS: ${bg}`).toBe(false);
  });

  test('no stored preference needs no JavaScript at all', async ({ page }) => {
    /*
     * The real anti-flash guarantee, and the reason the theme works with a
     * stylesheet alone.
     *
     * Dark is the base in globals.css, so the common case -- someone who has not
     * chosen -- is served by CSS, in the initial HTML, with no script and
     * therefore no possible flash.
     *
     * The class is asserted to be ABSENT here. If JavaScript were what is painting
     * the dark theme, a class would have to be present, and this would fail. It
     * would also fail if the class were `light`, because that is the other way to
     * be wrong: pinning light from a script is exactly the flash this design
     * refuses to have.
     */
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => localStorage.removeItem('bershama:theme')).catch(() => {});
    await page.goto('/en/login');
    await page.evaluate(() => localStorage.removeItem('bershama:theme'));

    const cls = await page.evaluate(() => document.documentElement.className);
    expect(cls, 'CSS should carry the system preference, not JavaScript').not.toContain('dark');
    expect(cls, 'and should not have pinned light either').not.toContain('light');

    // The page is nonetheless dark, because of the stylesheet alone.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `body background ${bg} should be dark from CSS alone`).toBe(true);
  });

  test('a stored choice is applied before the first paint', async ({ page }) => {
    /*
     * For an explicit stored choice the class comes from useLayoutEffect, which
     * React runs after the DOM is mutated and before the browser paints. So the
     * assertion is made after load, when hydration has run -- reading it at
     * DOMContentLoaded tests a moment that is before the effect by design, and
     * fails against code that is correct.
     */
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en/login');
    await page.evaluate(() => localStorage.setItem('bershama:theme', 'dark'));

    await page.goto('/en/login');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.className), { timeout: 5_000 })
      .toContain('dark');

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `a stored dark choice should win over a light OS: ${bg}`).toBe(true);
  });
});

  test('the theme survives client-side navigation, not just a fresh load', async ({
    page,
  }) => {
    /*
     * The bug this catches: the inline theme script was a bare <script> element
     * inside the layout, which React 19 never executes on the client. A full page
     * load worked -- the script was in the initial HTML -- and a client-side
     * navigation did not, so a dark-mode user clicked a link and landed on a
     * light page. Every theme test above uses page.goto, and all of them passed.
     *
     * Clicking the nav is the only way to reach the failure.
     */
    await signIn(page);
    // Set the preference, then LOAD it. Writing to localStorage does not change
    // the current document, and the inline script only runs on a fresh load --
    // so without the reload the class is correctly still `light` and the test
    // would be asserting a bug that is not there.
    await page.evaluate(() => localStorage.setItem('bershama:theme', 'dark'));
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.className)).toContain('dark');

    // A client-side navigation, via the nav rather than a URL.
    await page.locator('header a', { hasText: 'Batches' }).first().click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toContain('/inventory/batches');

    const cls = await page.evaluate(() => document.documentElement.className);
    expect(cls, 'the dark class should still be set after navigating').toContain('dark');

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `body background ${bg} should still be dark after navigating`).toBe(true);
  });
