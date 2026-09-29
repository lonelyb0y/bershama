import { expect, test, type Page } from '@playwright/test';

/**
 * The header must not overlap itself.
 *
 * This exists because of a reported bug: in English the nav ran under the theme
 * toggle and the user's name, so the two were drawn on top of each other. It was
 * visible in a screenshot and invisible to every other assertion in the suite,
 * which was checking URLs, roles and colours.
 *
 * Asserted with bounding boxes at four widths rather than by eye, because "does
 * it look fine" is not a check that survives a font change or a longer name.
 * The widths are the interesting ones: below 1024 the nav is hidden and there is
 * nothing to collide with, and above 1440 there is room to spare. The trouble
 * lives in between, which is where a laptop actually sits.
 */
const WIDTHS = [1024, 1152, 1280, 1440] as const;

async function signIn(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin', { timeout: 20_000 });
}

/** Do two elements' boxes intersect? */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const width of WIDTHS) {
  test(`nothing overlaps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);

    const nav = page.getByRole('navigation', { name: /dashboard/i });
    // The right-hand cluster: the theme button, the language switcher, the name
    // and sign out all live in one container.
    const cluster = page.locator('header .ms-auto');

    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    const clusterBox = await cluster.boundingBox();

    expect(navBox, 'the nav should have a box').not.toBeNull();
    expect(clusterBox, 'the control cluster should have a box').not.toBeNull();

    expect(
      overlaps(navBox!, clusterBox!),
      `the nav and the controls overlap at ${width}px: nav ${JSON.stringify(navBox)} vs cluster ${JSON.stringify(clusterBox)}`,
    ).toBe(false);
  });
}

test('a long name does not push the controls off the edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  const cluster = page.locator('header .ms-auto');
  const box = await cluster.boundingBox();

  // Not just "does it overlap" but "is it still on screen": a layout that wraps
  // or clips is also a broken header.
  expect(box!.x + box!.width, 'the controls should stay within the viewport').toBeLessThanOrEqual(1280);
});

test('the header controls never wrap onto a second line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  // Compare the heights of the sign-out button and the theme button. If any of
  // them had wrapped mid-phrase, the row would be taller than a single line of
  // controls and this would differ.
  const signOut = page.getByRole('button', { name: /sign out/i });
  const theme = page.getByRole('button', { name: /switch to (light|dark) mode/i });

  const a = (await signOut.boundingBox())!;
  const b = (await theme.boundingBox())!;

  expect(Math.abs(a.y - b.y), 'the header controls should share one line').toBeLessThan(4);
  expect(a.height, 'a sign-out button should be one line tall').toBeLessThan(40);
});
