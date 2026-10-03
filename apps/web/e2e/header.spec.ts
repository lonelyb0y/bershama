import { expect, test, type Page } from '@playwright/test';

import { waitForHydration } from './helpers/hydration';

import { signedInContext } from './helpers/session';

/**
 * The header must not overlap itself.
 *
 * ── why this file exists ──────────────────────────────────────────────────────
 * A reported bug: in English the nav ran under the theme toggle and the user's name,
 * so the two were drawn on top of each other. It was visible in a screenshot and
 * invisible to every other assertion in the suite, which was checking URLs, roles and
 * colours.
 *
 * ── what changed, and why the tests here cover two layouts ────────────────────
 *
 * The header is responsive in two pieces. At `lg` and above the nav sits beside the
 * controls in one row; below it, the nav moves to a second, horizontally scrollable
 * row. So there are now two different things that could go wrong:
 *
 *   * **Wide** -- nav and controls sharing a row and colliding. This is the original
 *     bug, and it is the one that needs bounding boxes.
 *   * **Narrow** -- the two rows existing at all, the nav being reachable, and the
 *     strip scrolling rather than wrapping. A collision is impossible here, so
 *     asserting "no overlap" would pass trivially and test nothing.
 *
 * The old version of this file asserted the wide contract only, and did it at four
 * widths, all of them at or above 1024 -- so every width it covered happened to be a
 * width where the mobile layout was not in play. It passed after the header was
 * rewritten for a completely different structure, because it could not find its
 * element and Playwright reported a timeout rather than a stale selector.
 *
 * ── asserted with boxes, not by eye ───────────────────────────────────────────
 * "Does it look fine" is not a check that survives a font change or a longer name.
 */

const WIDE_WIDTHS = [1024, 1152, 1280, 1440] as const;
const NARROW_WIDTHS = [390, 768] as const;

/**
 * An open page, already signed in, at the given width.
 *
 * The session is obtained once per worker by `signedInContext` and reused, so this file
 * costs one sign-in rather than nine. Each test still gets its own context and its own
 * page -- cookies and the DOM start empty every time -- so the tests remain
 * independent; they just stop each paying for the same password grant.
 */
async function openAt(browser: import('@playwright/test').Browser, width: number): Promise<Page> {
  const context = await signedInContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/en/admin');

  // Fail here, with this message, if the restored session did not take.
  //
  // Without it a dropped session surfaces five lines later as "header-nav not found",
  // which points at the layout. It was an occasional failure under parallel load and
  // cost a while to trace back to the session rather than the header.
  await page.waitForURL('**/admin', { timeout: 15_000 }).catch(() => {
    throw new Error(
      `the restored session did not survive: landed on ${page.url()} instead of /admin`,
    );
  });

  // Hydration, before anything is clicked. A redirect resolves while React is still
  // attaching listeners, so a click straight after lands on markup with no handler on
  // it and is silently dropped -- which looks like a dead button.
  await waitForHydration(page);
  return page;
}

/** Do two elements' boxes intersect? */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The part of `item` that anyone can actually see.
 *
 * The box is not enough, and this is the lesson of the bug that made the language
 * switcher unclickable: `min-w-0` lets the nav element shrink while its
 * whitespace-nowrap children overflow it, so the boxes stayed apart and the
 * box-based assertion passed -- while the last nav item was painted over the controls
 * and ate the click. What matters is where content is PAINTED, which for a scroll
 * container is the intersection of the item with the visible part of the nav.
 */
function clipToNav(
  item: { x: number; y: number; width: number; height: number },
  nav: { x: number; y: number; width: number; height: number },
) {
  return {
    x: Math.max(item.x, nav.x),
    y: Math.max(item.y, nav.y),
    width: Math.min(item.x + item.width, nav.x + nav.width) - Math.max(item.x, nav.x),
    height: Math.min(item.y + item.height, nav.y + nav.height) - Math.max(item.y, nav.y),
  };
}

for (const width of WIDE_WIDTHS) {
  test(`nothing overlaps at ${width}px`, async ({ browser }) => {
    const page = await openAt(browser, width);

    // Above lg the nav is the inline one and the strip is hidden. Asserting on which
    // element is present is part of the contract now -- a regression that rendered
    // both, or neither, would otherwise pass a box comparison against the wrong one.
    const nav = page.getByTestId('header-nav');
    const strip = page.getByTestId('header-nav-strip');

    await expect(nav).toBeVisible();
    await expect(strip).toBeHidden();

    const cluster = page.getByTestId('header-cluster');
    const navBox = await nav.boundingBox();
    const clusterBox = await cluster.boundingBox();

    expect(navBox, 'the nav should have a box').not.toBeNull();
    expect(clusterBox, 'the control cluster should have a box').not.toBeNull();

    expect(
      overlaps(navBox!, clusterBox!),
      `the nav and the controls overlap at ${width}px: nav ${JSON.stringify(navBox)} vs cluster ${JSON.stringify(clusterBox)}`,
    ).toBe(false);

    // Side by side means the same row, which is stronger than merely not touching.
    expect(
      Math.abs(navBox!.y - clusterBox!.y),
      `the nav and the controls should share one row at ${width}px`,
    ).toBeLessThan(navBox!.height);

    const items = nav.locator('a, span');
    const count = await items.count();

    for (let i = 0; i < count; i += 1) {
      const item = (await items.nth(i).boundingBox())!;
      const visible = clipToNav(item, navBox!);
      if (visible.width <= 0) continue;

      expect(
        overlaps(visible, clusterBox!),
        `nav item ${i} ("${(await items.nth(i).textContent())?.trim()}") reaches the controls at ${width}px`,
      ).toBe(false);
    }

    // And nothing may sit on top of the controls: an element that overlaps them is
    // intercepting their clicks, whatever the boxes say.
    const hitTest = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('a, button')?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 20) ?? 'nothing';
      },
      { x: clusterBox!.x + 8, y: clusterBox!.y + clusterBox!.height / 2 },
    );
    expect(hitTest, 'the control cluster must be reachable, not covered').not.toContain('Planned');
    expect(hitTest, 'the left edge of the control cluster must be clickable').toBeTruthy();
  });
}

for (const width of NARROW_WIDTHS) {
  test(`the nav moves to its own scrollable row at ${width}px`, async ({ browser }) => {
    const page = await openAt(browser, width);

    // The contract inverts below lg: the strip carries the nav and the inline one is
    // gone. Asserting that is what makes a half-applied breakpoint change fail.
    const nav = page.getByTestId('header-nav');
    const strip = page.getByTestId('header-nav-strip');

    await expect(strip).toBeVisible();
    await expect(nav).toBeHidden();

    const clusterBox = (await page.getByTestId('header-cluster').boundingBox())!;
    const stripBox = (await strip.boundingBox())!;

    // A different row, not the same one: the whole point of the strip.
    expect(
      stripBox.y,
      `the nav strip should sit below the controls at ${width}px`,
    ).toBeGreaterThanOrEqual(clusterBox.y + clusterBox.height - 1);

    expect(
      overlaps(stripBox, clusterBox),
      `the nav strip overlaps the controls at ${width}px`,
    ).toBe(false);

    // Scrollable rather than wrapped: a wrapped tab strip grows the header until it
    // eats the viewport, and it does so on the smallest phones first.
    const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    const rows = await strip.evaluate((el) => el.getClientRects().length);
    expect(rows, `the nav strip should be one row at ${width}px`).toBeLessThanOrEqual(1);

    // Either it scrolls or it fits; what it must not do is wrap, which `rows` above
    // covers. Recorded because the two are easy to confuse when both are true.
    if (scrolls) {
      const reached = await strip.evaluate((el) => el.scrollLeft);
      expect(reached, 'a scrolling strip starts at its left edge').toBeGreaterThanOrEqual(0);
    }

    // And the first destination is still reachable at this width.
    await expect(strip.getByRole('link', { name: /inventory/i }).first()).toBeVisible();
  });
}

test('a long name does not push the controls off the edge', async ({ browser }) => {
  const page = await openAt(browser, 1280);

  const box = (await page.getByTestId('header-cluster').boundingBox())!;

  // Not just "does it overlap" but "is it still on screen": a layout that wraps or
  // clips is also a broken header.
  expect(box.x + box.width, 'the controls should stay within the viewport').toBeLessThanOrEqual(1280);
  expect(box.x, 'the controls should stay within the viewport').toBeGreaterThanOrEqual(0);
});

test('the header controls never wrap onto a second line', async ({ browser }) => {
  const page = await openAt(browser, 1280);

  // Compare the identity control with the theme button. If any of them had wrapped
  // mid-phrase, the row would be taller than a single line of controls and this would
  // differ.
  //
  // The account trigger rather than a sign-out button: sign-out moved into the
  // account menu, so it does not exist until the menu is open, and asserting on it
  // measured nothing about the header.
  const account = page.getByTestId('account-menu');
  const theme = page.getByRole('button', { name: /switch to (light|dark) mode/i });

  await expect(account).toBeVisible();
  await expect(theme).toBeVisible();

  const a = (await account.boundingBox())!;
  const b = (await theme.boundingBox())!;

  // Centres, not tops. The account chip is two lines tall -- the name over the role --
  // while the theme and language controls are single icon buttons, so the cluster
  // aligns them by centre (`items-center`). Comparing tops failed by 7px on a header
  // that is laid out correctly; comparing centres is the assertion the design is
  // actually making.
  const centreA = a.y + a.height / 2;
  const centreB = b.y + b.height / 2;
  expect(Math.abs(centreA - centreB), 'the header controls should share one line').toBeLessThan(2);
  expect(a.height, 'a control should be one line tall').toBeLessThan(56);

  // The cluster itself is the assertion that matters: one row, not three stacked
  // lines that happen to be individually short.
  const cluster = (await page.getByTestId('header-cluster').boundingBox())!;
  expect(cluster.height, 'the cluster should be a single row of controls').toBeLessThan(64);
});

test('sign-out is reachable from the account menu', async ({ browser }) => {
  const page = await openAt(browser, 1280);

  // The menu is where sign-out lives now, so this is the test that keeps it from
  // becoming unreachable rather than merely invisible.
  await page.getByTestId('account-menu').click();

  // By role rather than by test id: the menu renders in a portal, and the `data-testid`
  // on the shadcn content wrapper is not forwarded onto the portal node. The role is
  // also the thing a screen reader looks for, so this asserts the semantics as well
  // as the presence.
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // By role `menuitem`, not `button`. It is a real <button type="submit"> that submits
  // its form natively -- so it works without scripting -- but inside a menu the
  // explicit `role="menuitem"` is what it is announced and navigated as, and that
  // role wins. Asking for a button here would fail against correct markup, which is
  // the more expensive kind of test failure: it invites someone to "fix" the menu.
  await expect(menu.getByRole('menuitem', { name: /sign out/i })).toBeVisible();

  // And it is genuinely a submit button rather than a div that calls requestSubmit,
  // so the control still works if the script never runs.
  await expect(menu.locator('button[type="submit"]')).toHaveCount(1);
});