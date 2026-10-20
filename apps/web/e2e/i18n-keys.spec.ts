import { expect, test } from '@playwright/test';

/**
 * The i18n regression guard.
 *
 * Commit c1c6f5f (the password policy) added translation keys as *dotted strings*:
 * `signup.strength.0`, `signup.password.tooShort`, and so on. next-intl/i18next reads
 * everything before the first dot as a namespace, so each of those was rejected at render
 * time with:
 *
 *   IntlError: INVALID_KEY: Namespace keys cannot contain the character "."
 *
 * That is not confined to the signup page. The catalogue is loaded whole, so the error
 * fired on every surface in the app -- the driver and dispatcher pages included -- and
 * broke rendering there too.
 *
 * The reason it shipped: the parity test compares the *key sets* of en.json and ar.json,
 * and `"strength.0"` as a flat string and `"strength": {"0": ...}` as a nested object both
 * flatten to the same set of paths. Parity cannot see this class of mistake, so the only
 * thing that can is loading a page and looking at the console.
 */
test('no surface logs an i18next INVALID_KEY error', async ({ page }) => {
  test.setTimeout(180_000);

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /INVALID_KEY|IntlError/.test(m.text())) {
      problems.push(m.text());
    }
  });
  page.on('pageerror', (e) => {
    if (/INVALID_KEY|IntlError/.test(e.message)) problems.push(e.message);
  });

  // The signup page is where the bad keys lived, so it is the one that must be visited
  // for this to mean anything. The others are here because the error was global: the same
  // catalogue is loaded on every surface.
  for (const path of [
    '/en/signup',
    '/ar/signup',
    '/en/login',
    '/ar/login',
    '/en/driver',
    '/en/admin/deliveries',
  ]) {
    problems.length = 0;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // Give next-intl a moment to render and complain; the error is thrown on first t().
    await page.waitForTimeout(1_500);
    expect(problems, `i18n errors on ${path}`).toEqual([]);
  }
});

test('the signup form resolves its strength keys to strings', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/en/signup', { waitUntil: 'domcontentloaded' });

  const password = page.getByTestId('signup-password');
  await expect(password).toBeVisible();
  // Typed rather than filled. `fill()` sets the value in one shot, and while React does
  // normally see that as a change, this component derives `strength` on every keystroke
  // and starts it at null -- so the meter only exists once a change has been processed.
  // Typing keeps the test honest about what it is waiting for.
  await password.pressSequentially('Bershama#2026', { delay: 20 });

  // `role="meter"` carries `aria-label={t('strength')}` and the live paragraph below it
  // carries `t('passwordGood')` or `t('strengthScale.N')`. Asserting on those two is a
  // direct check that the keys resolve to strings -- which is exactly what broke when
  // `strength` and `password` were turned into objects to hold their children.
  const meter = page.getByRole('meter');
  await expect(meter).toBeVisible();

  const label = await meter.getAttribute('aria-label');
  expect(label?.trim(), 'the meter label resolves to text, not [object Object]').toBeTruthy();
  expect(label).not.toContain('[object');
  expect(label).not.toContain('.');

  // Scoped inside the strength block. The signup page has more than one
  // `aria-live="polite"` region -- error announcements among them -- so a bare
  // `p[aria-live="polite"]` with `.first()` is whichever happens to come first in the
  // document. That was the flake: it passed on retry and failed on the first attempt
  // depending on how much of the form had rendered by then.
  const live = page
    .getByTestId('password-strength')
    .locator('p[aria-live="polite"]');
  await expect(live).toBeVisible();
  const text = (await live.innerText()).trim();
  expect(text, 'the strength caption resolves to real text').toBeTruthy();
  expect(text).not.toContain('strengthScale');
  expect(text).not.toContain('passwordRules');
});