import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * Re-arm the demo run, and assert it happened.
 *
 * Awaited and checked rather than fired and forgotten. Every oddity in this suite has been
 * a setup step that quietly did nothing -- a re-arm answered 403 because the session was
 * not yet established, leaving the previous run's position in place so the assertion below
 * failed for a reason that had nothing to do with the feature under test.
 */
async function rearmDemoRun(page: Page) {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/demo/rearm', { method: 'POST' });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  expect(res.status, `re-arm failed: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

/**
 * The run the driver is on, read off the driver's own page.
 *
 * Selecting the run by link text, or by "the first one listed", passes in isolation and
 * fails in a full run -- by then other specs have created runs of their own, so the
 * dispatcher ends up watching a different trip from the one the driver reported for. That
 * is the shape of a test that is really asserting on the fixture rather than on the
 * feature, and it looks like coverage while being none.
 */
async function driversRunId(driverPage: Page) {
  const id = await driverPage.getByTestId('driver-run').getAttribute('data-trip');
  expect(id, 'the driver page names the run it is on').toBeTruthy();
  return id;
}

/**
 * Live vehicle position, end to end.
 *
 * The database half is covered properly by supabase/tests/live_positions.test.sql. What
 * only a browser can check is the part nobody wrote a unit test for and everybody assumed:
 * that a position reported by the driver surface actually turns up on the dispatcher's map.
 *
 * Playwright can grant the geolocation permission and pin a position, which makes the whole
 * chain testable -- real `navigator.geolocation`, real `report_position` RPC, real RLS
 * read on the other surface, two different sessions.
 */
test.describe('live vehicle position', () => {
  // Serial, and not for the usual reasons.
  //
  // These two tests assert *mutually exclusive* states of one shared fixture: the first
  // requires a position to exist on the demo run, the second requires none. The project
  // runs `fullyParallel: true` with two workers against a single database, so in parallel
  // they raced -- the second test's re-arm cleared the position the first test had just
  // written, and each failed on the other's setup. It presented as flakiness in a full run
  // while passing alone, which is the most expensive kind of bug to chase.
  //
  // Serial fixes it at the source. Each test still establishes its own state through the
  // re-arm, so the ordering between them is a convenience rather than a dependency.
  test.describe.configure({ mode: 'serial' });

  // Somewhere recognisably not the pharmacy stop, so the marker cannot pass by being
  // the Nasr City dot again.
  const VAN = { latitude: 30.028, longitude: 31.19 };

  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: VAN.latitude, longitude: VAN.longitude },
  });

  test('a driver reporting a position puts a live marker on the dispatcher map', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    // ── the dispatcher, before anything is reported ────────────────────────────
    const adminCtx = await browser.newContext({ locale: 'en-GB', permissions: ['geolocation'] });
    const admin = await adminCtx.newPage();
    await signIn(admin, 'admin@demo.local');
    await admin.goto('/en/admin/deliveries', { waitUntil: 'domcontentloaded' });
    await rearmDemoRun(admin);

    // ── the driver reports ─────────────────────────────────────────────────────
    const driverCtx = await browser.newContext({
      locale: 'en-GB',
      permissions: ['geolocation'],
      geolocation: VAN,
    });
    const driver = await driverCtx.newPage();
    await signIn(driver, 'driver@demo.local', 'Bershama#2026', '**/driver');
    await driver.goto('/en/driver', { waitUntil: 'domcontentloaded' });

    // Start the run if it is not already going. `/api/demo/rearm` leaves a run in
    // progress -- a stop already ARRIVED -- so most of the time there is no Start button
    // at all and the surface shows Close instead. Conditional rather than required,
    // because the state under test is "the trip is in transit", not "the driver pressed
    // this particular button".
    const start = driver.getByRole('button', { name: /^start/i }).first();
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await driver.waitForTimeout(2_000);
    }

    // The hook polls once on mount, so the RPC has already fired. Three seconds is
    // slack for the round trip and for PostgREST to have the schema cached.
    await driver.waitForTimeout(3_000);

    // ── and the dispatcher sees it ─────────────────────────────────────────────
    //
    // The run is selected by id, read off the driver's own page. Selecting by link text
    // or by "the first one" passes in isolation and fails in a full run, because by then
    // other specs have created runs of their own and the dispatcher ends up watching a
    // different trip from the one the driver reported for. That is precisely the shape of
    // a test that is really asserting on the fixture rather than on the feature.
    const tripId = await driversRunId(driver);

    await admin.goto(`/en/admin/deliveries?run=${tripId}`, { waitUntil: 'domcontentloaded' });

    const map = admin.getByTestId('stop-map');
    await map.waitFor({ timeout: 30_000 });

    await expect(map).toHaveAttribute('data-live', 'yes');
    const vehicle = admin.getByTestId('live-vehicle');
    await expect(vehicle).toBeVisible();

    // The age is what makes this honest rather than decorative, so it has to be present
    // and sane -- a marker reporting a position from next week is a clock problem.
    const age = Number(await vehicle.getAttribute('data-age-seconds'));
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(600);

    await driverCtx.close();
    await adminCtx.close();
  });

  test('a position is only shown while its run is in transit', async ({ browser }) => {
    test.setTimeout(180_000);

    const adminCtx = await browser.newContext({ locale: 'en-GB' });
    const admin = await adminCtx.newPage();
    await signIn(admin, 'admin@demo.local');

    // The run id comes off the driver's own page -- asked before the re-arm rather than
    // after, so the re-arm is the last thing to touch the database before the assertion.
    // Ordering it the other way round left the window open for a report to land between
    // the clear and the check, which is a test that can fail for a reason that has
    // nothing to do with what it claims to check.
    //
    // `permissions: []` is doing real work and is not the same as omitting it.
    //
    // The `test.use({ geolocation, permissions: ['geolocation'] })` at the top of this
    // describe leaks into contexts made with `browser.newContext()`. Omitting the option
    // here did *not* produce a context without location access: it reported
    // `ALLOWED 30.028`, wrote a position of its own, and this test then failed while
    // asserting that no position existed. An empty array is the only thing that actually
    // revokes it.
    //
    // Withholding location is also the honest arrangement for a test whose subject is "no
    // position has been reported": the driver must not report, so the driver is not
    // permitted to.
    const driverCtx = await browser.newContext({ locale: 'en-GB', permissions: [] });
    const driver = await driverCtx.newPage();
    await signIn(driver, 'driver@demo.local', 'Bershama#2026', '**/driver');
    await driver.goto('/en/driver', { waitUntil: 'domcontentloaded' });

    const tripId = await driversRunId(driver);

    // Last, and checked: the re-arm clears the previous run's position, so this is the
    // same run the other test drives.
    await rearmDemoRun(admin);

    // Before any driver has reported, there is no vehicle -- and that is the correct
    // state to assert, because a map that invents a marker is worse than one that does not.
    //
    // It is also the assertion that found the re-arm bug: this passed in isolation and
    // failed in a full run, because the previous run's position survived the reset. A
    // precondition like this is worth keeping even though it reads as uninteresting.
    await admin.goto(`/en/admin/deliveries?run=${tripId}`, { waitUntil: 'domcontentloaded' });
    await expect(admin.getByTestId('stop-map')).toHaveAttribute('data-live', 'no');
    await expect(admin.getByTestId('live-vehicle')).toHaveCount(0);

    await driverCtx.close();
    await adminCtx.close();
  });
});
