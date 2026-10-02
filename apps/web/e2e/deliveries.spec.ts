import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { signedInContext } from './helpers/session';

/**
 * The delivery surfaces, in a browser.
 *
 * ── what this covers, and what it deliberately does not ──────────────────────
 *
 * This asserts that the two screens render what they claim to: the dispatcher's run
 * board with its stops and dispatch controls, and the driver's run with the stop
 * list, the map, and a signature pad that actually captures a mark.
 *
 * It does not submit a delivery. That is not an oversight about coverage but a
 * decision about layers: submitting consumes the demo run, so a second run of this
 * suite would assert against state the first one changed. The whole transition
 * chain -- arrive before signing, sign with a stated meaning, no stopping a run with
 * an unvisited stop, a signature that cannot be rewritten -- is asserted in
 * supabase/tests/delivery.test.sql, where each rule is one transaction and the
 * fixtures can be built and thrown away per assertion. A browser test that signs for
 * a real stop proves less about the rules and more about the demo tenant's current
 * contents.
 */

/**
 * These tests cannot run in parallel, and that is a property of the fixture rather than
 * a setting somebody forgot.
 *
 * There is exactly one demo trip. The dispatcher tests dispatch and assign it, the
 * driver tests deliver its stops, and `rearmDemoRun` puts it back -- so two tests
 * running at once are operating on the same two rows. Run the file in parallel and they
 * reset each other mid-assertion: twenty failures across both surfaces, and none of
 * them mentioning that they were fighting.
 *
 * Serial is the honest answer. The cost is that a failure skips the rest of the file,
 * which is why CI runs with `retries: 1` -- the group is retried as a unit before
 * anything is skipped.
 */
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, locale = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'));
  await page.waitForLoadState('networkidle');
}

/**
 * Put the demo run back to a state these tests can act on.
 *
 * Calls the app's own `api.reset_demo_run()` over PostgREST, with a signed-in
 * warehouse manager's token. It does not carry a service-role key and does not shell
 * out to a script.
 *
 * ── why it is not optional ────────────────────────────────────────────────────
 *
 * The driver tests need a stop that is still PENDING and a trip dated *today*. The demo
 * trip was seeded once with a `run_date` that was today on the day it was written, and
 * from then on it was a past date -- so two of these tests failed, with failures that
 * said nothing about dates and read as the driver screen being broken.
 *
 * The alternative was a suite that depends on a fixture which decays, plus CI resetting
 * it with a service-role key before every run. Holding the most powerful credential
 * this project has, in CI, writable from a pull request, to keep a date honest is a bad
 * trade for a function that only ever touches the demo tenant.
 *
 * ── why it signs in for itself ────────────────────────────────────────────────
 *
 * Because it cannot borrow the page's session. The driver tests are signed in as the
 * *driver*, and a driver is not a warehouse manager, so `reset_demo_run()` refuses
 * them -- which is the gate doing its job. So this opens its own short-lived admin
 * context, and the admin session is cached per worker rather than re-minted per test.
 */
/**
 * One admin page per worker, reused.
 *
 * The session was already cached; the *page* was not, so every test paid a fresh
 * context, a fresh page and a full `/en/admin` load just to make one POST. Against a
 * remote deployment under a parallel suite that is seconds each time, and it showed up
 * as a `beforeEach` timeout with no error in it.
 */
let adminPage: { context: BrowserContext; page: Page } | null = null;

async function adminSession(browser: Browser) {
  adminPage ??= { context: await signedInContext(browser), page: undefined as unknown as Page };
  if (!adminPage.page) {
    adminPage.page = await adminPage.context.newPage();
    await adminPage.page.goto('/en/admin');
  }
  return adminPage.page;
}

async function rearmDemoRun(browser: Browser) {
  try {
    const page = await adminSession(browser);

    // Same origin, session cookie, so this is the same call an administrator would
    // make from the app. The route does its own role check.
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/demo/rearm', { method: 'POST' });
      return { ok: response.ok, status: response.status, body: (await response.text()).slice(0, 200) };
    });

    if (!result.ok) {
      throw new Error(
        `could not re-arm the demo run: ${JSON.stringify(result)}. Without it the driver ` +
          'tests have no undelivered stop and no run dated today.',
      );
    }
  } finally {
    // Nothing to close: the admin context is per worker and outlives the call. Closing
    // it here was what made the next test pay for a new session.
  }
}

test.describe('the dispatcher surface', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('lists runs and their stops', async ({ page }) => {
    await page.goto('/en/admin/deliveries');

    await expect(page.getByRole('heading', { name: /deliveries/i })).toBeVisible();

    // Runs are listed before one is chosen, keyed by date rather than by id: the ids
    // are generated on each seed and the date is what a dispatcher recognises.
    await expect(page.getByTestId(/^run-\d{4}-\d{2}-\d{2}$/).first()).toBeVisible();

    // The stops of the chosen run. The detail column is empty until then, so the stop
    // list is not on screen at this point -- which is why this clicks first.
    await page.locator('a[href*="?run="]').first().click();
    await expect(page.getByTestId('stop-list').getByRole('listitem').first()).toBeVisible();
  });

  test('offers the planning forms', async ({ page }) => {
    await page.goto('/en/admin/deliveries');

    // Closed by default, because the screen is the day's work and not a menu.
    await expect(page.getByTestId('create-run')).toBeHidden();
    await expect(page.getByTestId('add-vehicle')).toBeHidden();

    await page.getByText(/plan a run/i).click();
    await expect(page.getByTestId('create-run')).toBeVisible();

    await page.getByText(/add a vehicle/i).click();
    await expect(page.getByTestId('add-vehicle')).toBeVisible();
  });

  test('says which run to select rather than showing a blank panel', async ({ page }) => {
    await page.goto('/en/admin/deliveries');

    // The detail column is empty until a run is chosen, and an empty panel is
    // indistinguishable from a broken one.
    await expect(page.getByText(/select a run/i)).toBeVisible();

    await page.getByTestId('stop-list').getByRole('listitem').first().isVisible().catch(() => {});
    await page.locator('a[href*="?run="]').first().click();
    await expect(page.getByText(/select a run/i)).toBeHidden();
  });
});

test.describe('the driver surface', () => {
  test.beforeEach(async ({ page, browser }, testInfo) => {
    // Arming is a context, a page load and a round trip, before the test's own work.
    // Under a loaded server that does not fit in the default 30s, and the symptom is a
    // timeout in `beforeEach` with the cause three lines above it.
    testInfo.setTimeout(120_000);

    // Armed before the driver signs in, and by its own admin context: the driver is not
    // a warehouse manager and `reset_demo_run()` refuses them.
    await rearmDemoRun(browser);
    await signIn(page, 'driver@demo.local');
  });

  test('a driver lands on the run, not on a dashboard', async ({ page }) => {
    // A driver opening this has one job. Landing on the warehouse dashboard first
    // would tell them this is a system they visit rather than one they drive.
    expect(new URL(page.url()).pathname).toBe('/en/driver');
  });

  test('shows the stop list in order', async ({ page }) => {
    await page.goto('/en/driver');

    await expect(page.getByRole('heading', { name: /today's run/i })).toBeVisible();
    await expect(page.getByTestId('stop-1')).toBeVisible();
    await expect(page.getByTestId('stop-2')).toBeVisible();
  });

  test('draws the map from recorded positions', async ({ page }) => {
    await page.goto('/en/driver');

    // One stop has been arrived at, so there is something to plot. The other has no
    // position -- nobody has been there -- and it is left off rather than plotted at
    // zero, zero off the coast of Africa.
    await expect(page.getByTestId('stop-map')).toBeVisible();
    await expect(page.getByText(/your stops, in order/i)).toBeVisible();
    // No distance is claimed between a stop that has a position and one that does
    // not. The distance caption and its "not a driving distance" qualifier are
    // covered in stop-map.test.ts, where two positioned stops can be given.
    await expect(page.getByText(/straight line/i)).toHaveCount(0);
  });

  test('offers the signature sheet only for the stop that has been arrived at', async ({ page }) => {
    await page.goto('/en/driver');

    // Exactly one sign sheet. Nine pads on one screen is nine ways to sign for the
    // wrong pharmacy.
    await expect(page.getByTestId(/^sign-sheet-/)).toHaveCount(1);
  });

  test('the signature pad captures a mark', async ({ page }) => {
    await page.goto('/en/driver');

    const pad = page.getByTestId('signature-canvas');
    await expect(pad).toBeVisible();
    // Scrolled into view first. page.mouse takes viewport coordinates, and a canvas
    // below the fold gives a box whose y is past the bottom of the screen -- so the
    // moves land on nothing and the pad reports an empty signature. Silent, and it
    // looks exactly like a broken component.
    await pad.scrollIntoViewIfNeeded();

    const box = await pad.boundingBox();
    expect(box).not.toBeNull();

    // Drawn with real pointer moves, not a synthetic event: the component listens
    // for pointer events, and a dispatchEvent would pass a unit test that says
    // nothing about whether a finger works.
    //
    // Polled rather than read once, because page.mouse moves do not wait for
    // hydration the way a click does. The first version of this test drew into an
    // unhydrated canvas -- the server-rendered markup was there, the event handlers
    // were not -- and failed on an empty value that looked like a component bug.
    const stored = page.locator('input[name="signature_preview"]');
    await pad.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const box = (await page.getByTestId('signature-canvas').boundingBox())!;
      await page.mouse.move(box!.x + 20, box!.y + 40);
      await page.mouse.down();
      await page.mouse.move(box!.x + 90, box!.y + 60, { steps: 8 });
      await page.mouse.move(box!.x + 140, box!.y + 30, { steps: 8 });
      await page.mouse.up();
      return stored.inputValue();
    }, { timeout: 10_000 }).toMatch(/^data:image\/png;base64,/);
    await expect(page.getByText(/signature captured/i)).toBeVisible();

    // And the pad says it captured something, so an empty pad is visibly empty.
    await expect(page.getByText(/signature captured/i)).toBeVisible();
  });

  test('asking for the meaning of the signature is not optional', async ({ page }) => {
    await page.goto('/en/driver');

    const sheet = page.getByTestId(/^sign-sheet-/);
    await expect(sheet.getByLabel(/what this signature means/i)).toHaveAttribute('required', '');
    await expect(sheet.getByLabel(/received by/i)).toHaveAttribute('required', '');
  });

  test('a failed delivery requires a reason', async ({ page }) => {
    await page.goto('/en/driver');

    await page.getByText(/cannot deliver this stop/i).click();
    const form = page.getByTestId(/^fail-/);
    await expect(form.getByLabel(/reason/i)).toHaveAttribute('required', '');
  });

  test('renders right to left in Arabic', async ({ page }) => {
    await page.goto('/ar/driver');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: /رحلة اليوم/ })).toBeVisible();
  });
});

test.describe('the driver surface is guarded', () => {
  test('a pharmacy manager cannot open it', async ({ page }) => {
    await signIn(page, 'pharmacy@demo.local');

    // The driver surface is where a signature is taken, so the guard is the control
    // and the hidden nav link is only a courtesy. This asserts the control.
    const response = await page.goto('/en/driver');
    expect(response?.status()).toBe(404);
  });

  test('a driver cannot open the warehouse inventory', async ({ page }) => {
    await signIn(page, 'driver@demo.local');

    const response = await page.goto('/en/admin/inventory/products');
    expect(response?.status()).toBe(404);
  });
});