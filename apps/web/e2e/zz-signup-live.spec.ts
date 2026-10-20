import { expect, test } from '@playwright/test';

/**
 * The full self-serve path, for real.
 *
 * Deliberately not part of CI. It creates genuine rows on the project, it needs sign-ups
 * enabled, and it needs a unique address each run. Run it by hand when the onboarding path
 * changes:
 *
 *   E2E_BASE_URL=https://bershama-bay.vercel.app \
 *     pnpm exec playwright test e2e/zz-signup-live.spec.ts
 *
 * ## Two reasons it can legitimately stop early
 *
 * **Email confirmation.** With confirmation on -- the correct production setting -- `signUp`
 * returns no session and the account waits for a click on an email this test cannot open.
 * The run reports `awaiting-email` and stops, rather than pretending to have got further.
 *
 * **The Free plan's email rate limit.** Every confirmation sends an outbound email, and the
 * default limit is low enough that back-to-back manual runs exhaust it. GoTrue answers `429`,
 * which says nothing about the code under test -- it says the project spent its hourly quota.
 * So a refusal is reported as what it is instead of as a mystery timeout.
 *
 * ## Password
 *
 * `Quiet-rain-44-then-some-more` -- strong by this project's policy, and capitalised so it
 * also satisfies GoTrue's *default* character-class requirement. That requirement conflicts
 * with this project's policy on purpose; see docs/go-live-checklist.md, Password Strength.
 * Once the server-side setting is relaxed, drop the capital.
 */
test('a stranger can sign up, get an organisation, and reach the dashboard', async ({ page }) => {
  test.setTimeout(180_000);

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-signup-${stamp}@example.com`;
  const weak = 'password1234';
  const password = 'Quiet-rain-44-then-some-more';

  await page.goto('/en/signup', { waitUntil: 'domcontentloaded' });

  // ── the password policy blocks a weak one before anything is submitted ────────
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(weak);
  await expect(page.getByTestId('password-problem-tooCommon')).toBeVisible();
  await expect(page.getByTestId('signup-submit')).toBeDisabled();

  await page.getByTestId('signup-password').fill(password);
  await expect(page.getByTestId('password-strength')).toHaveAttribute('data-score', '4');
  await expect(page.getByTestId('signup-submit')).toBeEnabled();

  // ── fill the rest and submit ─────────────────────────────────────────────────
  await page.getByTestId('signup-org').fill(`E2E Pharmacy ${stamp}`);
  await page.getByTestId('signup-name').fill('E2E Tester');
  await page.getByTestId('signup-submit').click();

  const awaitingEmail = page.getByTestId('signup-awaiting-email');
  const header = page.locator('[data-testid="header-cluster"]');

  let refusal: string | null = null;
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    if (await awaitingEmail.isVisible().catch(() => false)) {
      console.log(`  AWAITING-EMAIL: ${email} exists, unconfirmed, no organisation.`);
      console.log(`  CLEANUP: delete the auth user ${email}.`);
      return;
    }
    if (await header.isVisible().catch(() => false)) break;

    const alert = await page
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => '');
    if (alert) {
      refusal = alert;
      // A refusal that mentions the quota is an operational fact, not a code fault.
      if (/rate limit|too many attempts|try again/i.test(alert)) break;
    }
    await page.waitForTimeout(1_000);
  }

  if (refusal) {
    console.log(`  REFUSED: ${refusal}`);
    if (/rate limit|too many attempts/i.test(refusal)) {
      console.log('  (Free-plan email quota -- not a code failure. Re-run later.)');
    } else {
      console.log(`  CLEANUP: check whether the auth user ${email} was created.`);
      throw new Error(`sign-up refused: ${refusal}`);
    }
    return;
  }

  expect(page.url()).toContain('/admin');
  console.log(`  THROUGH: ${email} reached ${page.url()}`);
  console.log(`  CLEANUP: tenant "E2E Pharmacy ${stamp}" and user ${email} need deleting.`);
});
