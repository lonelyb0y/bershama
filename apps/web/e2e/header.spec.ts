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

    /*
     * The box is not enough, and this is the lesson of the bug that made the
     * language switcher unclickable.
     *
     * `min-w-0` lets the nav element shrink while its whitespace-nowrap children
     * overflow it, so the boxes stayed apart and the box-based assertion above
     * passed -- while the last nav item was painted over the controls and ate
     * the click. What matters is where the content is actually PAINTED, which
     * for a scroll container is the intersection of the item and the visible
     * part of the nav.
     *
     * So each item is clipped to the nav's own box before being compared. An
     * item scrolled out of view legitimately has a rect past the container's
     * edge -- that is what scrolling means -- but the part of it anyone can
     * actually see must not reach the controls.
     */
    const items = nav.locator('a, span');
    const count = await items.count();

    for (let i = 0; i < count; i += 1) {
      const item = (await items.nth(i).boundingBox())!;
      const visible = {
        x: Math.max(item.x, navBox!.x),
        y: Math.max(item.y, navBox!.y),
        width: Math.min(item.x + item.width, navBox!.x + navBox!.width) - Math.max(item.x, navBox!.x),
        height: Math.min(item.y + item.height, navBox!.y + navBox!.height) - Math.max(item.y, navBox!.y),
      };

      if (visible.width <= 0) continue;

      expect(
        overlaps(visible, clusterBox!),
        `nav item ${i} ("${(await items.nth(i).textContent())?.trim()}") reaches the controls at ${width}px`,
      ).toBe(false);
    }

    // And nothing may sit on top of the controls: an element that overlaps them
    // is intercepting their clicks, whatever the boxes say.
    const hitTest = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('a, button')?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 20) ?? 'none';
    }, { x: clusterBox!.x + 8, y: clusterBox!.y + clusterBox!.height / 2 });
    expect(hitTest, 'the left edge of the control cluster must be clickable').not.toContain('Planned');
    expect(hitTest, 'the control cluster must be reachable, not covered').toBeTruthy();
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
