import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

/**
 * The list surfaces render.
 *
 * ── why this exists ──────────────────────────────────────────────────────────────
 *
 * The catalogue was rebuilt as a real table and shipped broken: the page threw on
 * every visit and rendered "This page couldn't load". The build was green, the unit
 * tests passed, the type checker was happy, and the Browser job passed — because the
 * Browser job never visited the catalogue.
 *
 * A server component cannot hand a render function to a client component, and the
 * failure is a runtime crash rather than a compile error. The only thing that catches
 * it is a browser actually going there.
 *
 * So the smoke suite goes there.
 *
 * ── signed in, unless the surface is public ─────────────────────────────────────
 *
 * `signedIn: false` is not a preference. Both public forms redirect a visitor who
 * already has a session — the sign-in page sends them to their home route, the
 * sign-up page to the admin surface — because a signed-in person has no business
 * creating a second organisation.
 *
 * This suite used to sign in before every surface, including those two. So the
 * browser arrived at `/en/login` with a valid session, the server redirected it to
 * `/admin`, and the assertion that the email field was on the page failed with
 * "element(s) not found" — a message that points at the markup and is really about
 * the harness. Two forms, one mistake, and the failure read like a design bug.
 *
 * The public surfaces are therefore visited as an anonymous visitor, which is the
 * only state in which they exist.
 */
const SURFACES = [
  // The inventory hub. It is the page the other two hang off, and it was rebuilt
  // from four figures and three links into four figures, a table and the lots that
  // need attention first.
  { path: '/en/admin/inventory', expect: 'hub' },
  { path: '/en/admin/inventory/products', expect: 'products' },
  { path: '/en/admin/inventory/batches', expect: 'table' },
  { path: '/en/admin/alerts', expect: 'alert-list' },
  // The dashboard. Its charts are Bklit's now, which means they are client
  // components with a data boundary -- and a data boundary is exactly where a
  // chart breaks at runtime while every type check passes.
  { path: '/en/admin', expect: 'dashboard' },
  // The three public forms. They share a shell, and the shell is new -- a bar, a
  // split, a footer -- so a mistake in it would show on all three at once.
  { path: '/en/login', expect: 'auth', signedIn: false },
  { path: '/en/signup', expect: 'auth', signedIn: false },
  // The account settings. It is new, it is the only page a driver can reach
  // that an administrator cannot, and it carries a form, a database column and
  // a session scope -- all three of which are exactly the things that fail at
  // runtime rather than at build time.
  { path: '/en/settings', expect: 'settings' },
];

test.describe('the list surfaces render', () => {
  /*
   * Ninety seconds, not Playwright's thirty.
   *
   * These run against a Vercel *preview*, where the first request for a route
   * compiles it. The batches surface measured 29.9s and the catalogue 30.0s on
   * the last run -- they passed, but only just, and one run earlier the batches
   * page timed out at thirty and passed on the retry in 8.1s. A timeout that
   * fires on a cold compile is a flake, not a signal, and the job it takes down
   * is the one that would have caught a real crash.
   *
   * Sixty seconds would cover the measured worst case. Ninety covers a cold
   * compile behind a slow one without pretending the suite can wait forever.
   */
  test.setTimeout(90_000);

  for (const surface of SURFACES) {
    test(`${surface.path} does not fall over`, async ({ page }) => {
      if (surface.signedIn !== false) {
        await signIn(page, process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local');
      }

      const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'the page should not be an error').toBe(200);

      // The error boundary replaces the whole page, so the absence of the failure text
      // is the assertion, and the presence of the thing we wanted is the proof.
      await expect(page.getByText(/couldn.t load/i)).toHaveCount(0);
      await expect(page.getByText(/server error occurred/i)).toHaveCount(0);

      if (surface.expect === 'hub') {
        /*
         * The three panels, by role and by name.
         *
         * The hub's job is to answer "where is my stock and what is about to
         * expire" on the screen, so the figures, the locations and the
         * at-risk lots are the page. Each is a labelled <section>, which gives
         * it the `region` role -- so naming the region is naming the panel,
         * without pinning the copy of a heading that is allowed to change.
         */
        await expect(page.getByRole('heading', { level: 1, name: /inventory/i })).toBeVisible();
        await expect(page.getByRole('region', { name: /key figures/i })).toBeVisible();
        await expect(page.getByRole('region', { name: /by location/i })).toBeVisible();
      }

      if (surface.expect === 'dashboard') {
        /*
         * The dashboard was rebuilt on the Stitch design. The panels are
         * there, and the dashboard says what it has and what it has not.
         */
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }

      if (surface.expect === 'auth') {
        /*
         * The floating label, the panel, and the telemetry.
         *
         * The label is the thing that breaks: it is absolutely positioned over
         * the control, and a control that does not reserve room for it puts a
         * caption on top of a text field.
         *
         * By the accessible name, not a test id: the field's name is what a
         * screen reader reads, so an assertion on it is an assertion about the
         * thing being reachable, not about a selector that happens to exist.
         *
         * And deliberately loose about the words. The two forms name the field
         * differently -- "Email address" on sign-in, "Work email" on sign-up --
         * because they live in different translation namespaces, and an earlier
         * version of this assertion matched `/email address/i` on both and so
         * failed on sign-up for a reason that had nothing to do with the page.
         * What is being asserted is that a control called something-email is
         * reachable by name, on either form.
         */
        const email = page.getByLabel(/email/i).first();
        await expect(email).toBeVisible();

        // And that the name comes from a <label for> -- not from an aria-label,
        // and not from a caption floating above the box. The label that names
        // the field must be the one that carries the floating treatment, or
        // the caption and the value will land on top of each other.
        const id = await email.getAttribute('id');
        expect(id, 'the email field should have an id a <label for> can point at').toBeTruthy();
        await expect(page.locator(`label[for="${id}"]`)).toHaveClass(/pf-field__label/);

        // The telemetry panel is the half of the page that argues the product,
        // and it is on both forms. The heading is the proof it is there.
        await expect(page.getByRole('heading', { name: /live inventory telemetry/i })).toBeVisible();
      }

      if (surface.expect === 'settings') {
        // The sections, not just the page. A settings page that renders but is
        // missing a section is a settings page with a hole in it.
        await expect(page.getByRole('heading', { name: /language/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /notification/i })).toBeVisible();
        await expect(page.getByRole('heading', { name: /security/i })).toBeVisible();
      }

      if (surface.expect === 'table') {
        await expect(page.locator('table')).toHaveCount(1);
      }
    });
  }
});
