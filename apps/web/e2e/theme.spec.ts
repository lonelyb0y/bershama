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

  test('the theme is applied before the first paint, with no flash', async ({ page }) => {
    // Intercept the stylesheets as they are requested. If the theme were applied
    // from a client effect, the first paint would be light and these would be
    // checked against that.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/login', { waitUntil: 'domcontentloaded' });

    const cls = await page.evaluate(() => document.documentElement.className);
    expect(cls, 'the class must be set by the inline head script').toContain('dark');
  });
});
