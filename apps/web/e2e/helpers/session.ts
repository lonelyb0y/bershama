import type { BrowserContext, Page } from '@playwright/test';

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
    await page.waitForLoadState('networkidle');

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
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}