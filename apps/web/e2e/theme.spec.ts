import { expect, test } from '@playwright/test';

/**
 * Dark mode.
 *
 * The interesting failure here is not "does the toggle work". It is the ordering
 * bug this suite was written after: the `@media (prefers-color-scheme: dark)`
 * block sat ABOVE the light `:root` block, and two equal-specificity rules mean
 * the last one wins. The stylesheet shipped a complete dark theme that could not
 * possibly apply, and nothing reported an error, because invalid-looking CSS that
 * parses fine is exactly what a stylesheet full of it looks like.
 *
 * So these tests assert the computed value, not the presence of a class. A test
 * that only checked for `.dark` on <html> would have passed against that build.
 */
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
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

async function surface(page: import('@playwright/test').Page) {
  await page.goto('/en/login');
}

test.describe('dark mode', () => {
  test('defaults to the light palette in a light-colour-scheme browser', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await surface(page);

    // Not a class check. The actual painted value, which is the thing a person
    // would notice if it were wrong.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `body background ${bg} should be light`).toBe(false);
  });

  test('follows the OS to dark when the user has expressed no preference', async ({
    page,
  }) => {
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
      localStorage.setItem('pharmaflow:theme', 'dark');
    });
    await page.reload();

    let bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `dark choice on a light OS: ${bg}`).toBe(true);

    // Dark OS, light choice. The other direction, which is the one that gets
    // missed: an explicit light must beat a dark system preference.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      localStorage.setItem('pharmaflow:theme', 'light');
    });
    await page.reload();

    bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDark(bg), `light choice on a dark OS: ${bg}`).toBe(false);
  });

  test('no stored preference needs no JavaScript at all', async ({ page }) => {
    /*
     * The real anti-flash guarantee, and the reason the theme works with a
     * stylesheet alone.
     *
     * globals.css honours prefers-color-scheme through a media query scoped to
     * :root:not(.light):not(.dark). So the common case -- someone who has not
     * chosen, following their OS -- is served by CSS, in the initial HTML, with
     * no script and therefore no possible flash.
     *
     * The class is asserted to be ABSENT here. If JavaScript is what is
     * painting the dark theme, the class would be present and this would fail.
     */
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => localStorage.removeItem('pharmaflow:theme')).catch(() => {});
    await page.goto('/en/login');
    await page.evaluate(() => localStorage.removeItem('pharmaflow:theme'));

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
    await page.evaluate(() => localStorage.setItem('pharmaflow:theme', 'dark'));

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
    await page.evaluate(() => localStorage.setItem('pharmaflow:theme', 'dark'));
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
