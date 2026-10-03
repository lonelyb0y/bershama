import type { Page } from '@playwright/test';

/**
 * Wait until the authenticated shell has actually rendered.
 *
 * ── why not `waitForLoadState('networkidle')` ──────────────────────────────────
 *
 * Because `networkidle` waits for the network to be *quiet*, and a busy network is not
 * a slow page. Against a cold preview something is always in flight -- a font, a chunk,
 * an analytics beacon -- and sixteen tests failed in CI at exactly 30s on this wait
 * while passing locally against a warm server. The assertion that cared about had
 * nothing to do with any of it.
 *
 * Playwright's own guidance is the same: it is discouraged in favour of waiting for
 * specific UI, which retries and reports what it was looking for.
 *
 * ── what this waits for instead ────────────────────────────────────────────────
 *
 * The control cluster in the header. It is on the authenticated layout, so it is
 * present only once the session resolved and the server component has streamed --
 * which is precisely "the app is usable now" -- and it is present on every surface, so
 * one selector serves every spec. It also happens to be what a click would land on, so
 * a test that skipped this wait used to click markup with no handler on it and see
 * nothing happen.
 *
 * `state: 'attached'` rather than `visible`: it renders before fonts settle, and a
 * font swap is not the thing being waited for.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.getByTestId('header-cluster').waitFor({ state: 'attached', timeout: 60_000 });
}