import { expect, type BrowserContext, type Page } from '@playwright/test';

import { waitForHydration } from './hydration';

/** Playwright's storageState shape; named here so the cache has a type. */
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Sign in once per worker, then reuse the session.
 *
 * ── why ───────────────────────────────────────────────────────────────────────
 *
 * Every spec here signed in per test. `header.spec.ts` does it nine times -- once per
 * viewport width -- and each sign-in is a full round trip: a reCAPTCHA token, a
 * password grant against the hosted Supabase project, and a role lookup. That is both
 * slow and a contention problem: nine identical password grants running concurrently
 * against one demo account is enough to make some of them fail, and a failed sign-in
 * presents as a page that never rendered its header, which reads as a layout bug.
 *
 * The suite passed reliably when that file ran alone and failed three widths when four
 * specs ran together. That is the worst shape for a test suite: correct, and only
 * sometimes.
 *
 * ── how ───────────────────────────────────────────────────────────────────────
 *
 * One sign-in per worker process, cached as `storageState` and applied to every
 * subsequent context. A fresh context per test is still what Playwright gives us --
 * cookies, localStorage and the DOM all start empty -- so tests remain independent;
 * they just stop each paying for the same session.
 *
 * The cache is keyed by account, because the driver and the administrator are
 * different users with different roles, and a test that signs in as a driver must not
 * inherit an administrator's session.
 */

const cache = new Map<string, unknown>();

/**
 * Click Sign in, and keep clicking until the app actually reacts.
 *
 * ── why ────────────────────────────────────────────────────────────────────────
 *
 * A click on the login form's button before React hydrates hits markup with no
 * handler on it. Playwright is honest about this -- the element is there, visible and
 * enabled -- so the click "succeeds" and nothing happens: no reCAPTCHA call, no
 * password grant, no navigation. It then surfaces much later as
 * `waitForURL: Timeout 60000ms exceeded`, which reads like a slow server and is not.
 *
 * It is the same failure `waitForHydration` was written for, one step too early: that
 * helper waits for the header, which by definition cannot exist until the sign-in it is
 * waiting for has already happened. So it could never help here, and calling it *after*
 * the click only checked that the page we never left had a header on it -- it did not.
 *
 * Rather than guess at a hydration marker the login page may not have, retry the thing
 * we actually need. `toPass` re-runs the block, and the second click lands on a hydrated
 * form. This is self-correcting for any future change to how the form mounts, which a
 * hand-picked marker would not be.
 */
export async function clickSignIn(page: Page): Promise<void> {
  try {
    await clickUntilSignedIn(page);
  } catch (cause) {
    // Say what the page said. A retry loop that times out tells the reader only that
    // "something" was wrong for 45 seconds; the reason is on the screen, in the alert
    // the form rendered, and it is the difference between a reCAPTCHA refusal, a rate
    // limit and a typo in the password.
    const alert = await page
      .locator('[role="alert"], [role="status"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
    const detail = [
      `still at ${new URL(page.url()).pathname}`,
      alert.length ? `alert: ${alert.join(' | ')}` : null,
      heading ? `heading: ${heading}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`sign-in never left the login form (${detail})`, { cause });
  }
}

async function clickUntilSignedIn(page: Page): Promise<void> {
  await expect(async () => {
    // Check where we are *before* clicking. Two failures hid in the other order:
    //
    //  - A retry after a successful sign-in clicks a button that is no longer there,
    //    because the form was unmounted by the navigation it triggered. The click
    //    throws before the URL is ever examined, so the retry could never succeed no
    //    matter how patient it was.
    //  - A per-attempt wait shorter than a real sign-in (three seconds, against a cold
    //    production route) declared success a failure, and then clicked again.
    //
    // So: click only if we are still on the form, and allow an attempt long enough to
    // actually finish.
    if (new URL(page.url()).pathname.includes('/login')) {
      await page.getByRole('button', { name: /sign in/i }).click();
    }
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
  }).toPass({
    // 45s, not 90s: this runs inside a caller's test, and `alerts.spec.ts` budgets 60s
    // for the whole test. A helper that can outlive its caller guarantees the failure it
    // was written to prevent.
    timeout: 45_000,
    intervals: [250, 500, 1_000, 2_000, 3_000],
  });
}


async function signInOnce(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
): Promise<unknown> {
  const cached = cache.get(email);
  if (cached) return cached;

  // A throwaway context whose only job is to obtain the session.
  const context = await browser.newContext({ locale: 'en-GB' });
  const page = await context.newPage();

  try {
    await page.goto('/en/login');
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin', { timeout: 30_000 });
    // Hydration, or the first click in a test lands on markup with no handler on it.
    await waitForHydration(page);

    // Never cache a session that has not actually landed. A sign-in that resolved the
    // URL but never finished mounting would otherwise be handed to every later test in
    // the worker, turning one flaky sign-in into a dozen failures that all point at the
    // wrong file.
    await page.getByTestId('header-cluster').waitFor({ state: 'visible', timeout: 15_000 });

    const state = await context.storageState();
    cache.set(email, state);
    return state;
  } finally {
    await context.close();
  }
}

/**
 * A context that is already signed in.
 *
 * Takes a `browser` rather than a `page` because it creates the context itself --
 * `test.use({ storageState })` cannot express "sign in once, lazily, and only for the
 * specs that need it".
 */
export async function signedInContext(
  browser: import('@playwright/test').Browser,
  email = 'admin@demo.local',
  password = 'PharmaFlow#2026',
): Promise<BrowserContext> {
  const state = (await signInOnce(browser, email, password)) as StorageState;
  return browser.newContext({ locale: 'en-GB', storageState: state });
}

/**
 * Sign a page in, reusing the cached session where one exists.
 *
 * The simple form to migrate a spec to: it keeps each test's own page and context, and
 * only removes the repeated network round trip.
 */
export async function ensureSignedIn(page: Page, email = 'admin@demo.local'): Promise<void> {
  if (await page.getByTestId('header-cluster').isVisible().catch(() => false)) return;
  await signIn(page, email);
}

export async function signIn(
  page: Page,
  email = 'admin@demo.local',
  password = 'PharmaFlow#2026',
): Promise<void> {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await clickSignIn(page);
  // `/admin` specifically: a role that lands anywhere else belongs to a different test's
  // assertion, and treating that as a successful sign-in would let it through silently.
  await page.waitForURL('**/admin', { timeout: 60_000 });
  await waitForHydration(page);
}