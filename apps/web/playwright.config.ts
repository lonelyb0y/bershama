import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These exist because five bugs reached production that nothing else caught:
 *
 *   1. the stocktake embed was ambiguous, so the page silently loaded empty
 *   2. every movement call went to the `public` schema
 *   3. the `api` schema was not routable, and the Dashboard setting did not
 *      reach the role PostgREST reads
 *   4. `next dev` could not see the root `.env.local`, so the app never started
 *   5. the email provider was off, so nobody could sign in at all
 *
 * Not one of those is visible to a unit test, a stub, or the pgTAP suites.
 * Every one of them is a question only a real browser can answer: does the app
 * start, does the server render, does the cookie reach the server, does the
 * guard let the right person through.
 *
 * ── pointed at localhost, pointed at HOSTED Supabase ───────────────────────
 *
 * Two deliberate choices, both forced by how this environment is built:
 *
 * The app is not tested against `pnpm supabase:start`. The local Supabase stack
 * does not serve schema-qualified paths at all, so the `api` schema is
 * unreachable from it and every test that calls a real api.* function would fail
 * for a reason that has nothing to do with the code. So `.env.local` points at
 * the deployed Supabase project and the tests run against a local dev server.
 *
 * And not against the deployed Vercel URL by default: it sits behind Deployment
 * Protection, which redirects a browser to a Vercel SSO page. A test runner has
 * no session there, so it would get 302s and test the login portal. Set
 * E2E_BASE_URL to point at a deployment once a bypass token can be supplied, or
 * leave it unset and test the app as it actually runs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A failure here is a real signal, so the trace is kept. It is a screenshot of
  // the page at the moment it broke, which is the difference between reading a
  // stack trace and seeing the 500 page.
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  // Started on demand. `pnpm dev` rather than `next start`, because the build
  // step for this app is slow enough that running it before every test run would
  // dominate the suite.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000/en/login',
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
