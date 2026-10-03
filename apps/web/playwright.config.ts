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

  // Manual-only, and deliberately outside the default run.
  //
  // A `zz-` prefix does not exclude anything -- Playwright globs every file under testDir,
  // so this spec was picked up by `pnpm exec playwright test` and by CI. It creates real
  // auth users and real tenants on the shared project, which is not something a green
  // pipeline should ever do on its own.
  //
  // It is here rather than deleted because the signup path cannot be verified any other way:
  // it needs sign-ups enabled, a unique address per run, and an email click. Run it by hand
  // with E2E_BASE_URL pointed at the deployment you mean to test.
  testIgnore: ['**/zz-signup-live.spec.ts'],
  fullyParallel: true,

  // Two workers, not Playwright's CPU/2 default.
  //
  // Every test here loads a full authenticated page and most of them sign in, so the
  // suite is bound by how many concurrent document loads the app under test can
  // serve, not by how many CPUs the runner has. At four workers the local server
  // started logging `The destination stream closed early`, sign-ins stopped
  // completing, and eight tests failed with "the restored session did not survive" --
  // which is a message about the harness, not about the app.
  //
  // Halving the concurrency made it disappear. The suite takes about a minute either
  // way, because the time is in page loads, not in assertions. Raise this only
  // alongside evidence that the target can take it.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A failure here is a real signal, so the trace is kept. It is a screenshot of
  // the page at the moment it broke, which is the difference between reading a
  // stack trace and seeing the 500 page.
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',

    // Vercel's deployment protection, when the target is a preview URL.
    //
    // Preview deployments are behind SSO, so a CI browser gets the login page instead
    // of the app -- and the suite's first failure would be "sign in", pointing at the
    // authentication code. The bypass secret is a Vercel project setting
    // (Deployment Protection -> Bypass Protection), passed in as a header.
    //
    // Absent locally, so nothing changes for a developer running against their own
    // machine: an undefined header is simply not sent.
    ...(process.env.E2E_BYPASS_TOKEN
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': process.env.E2E_BYPASS_TOKEN,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
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
