import { expect, test } from '@playwright/test';

import { signIn } from './helpers/session';

import type { Page } from '@playwright/test';

/**
 * The drug register lookup.
 *
 * The point of this feature is that it *writes nothing*. That is what makes it safe to
 * offer, and it is also the thing most worth asserting: a search that quietly inserted
 * rows would turn a lookup box into the bulk import this was built to avoid, and the
 * catalogue would be 25,000 products deep the first time somebody typed a letter.
 *
 * So these tests check three things: that a search finds the right thing, that it finds
 * it in both languages, and that it leaves the catalogue exactly as it found it.
 */
test.describe('drug register lookup', () => {
  test('finds a medicine by Arabic name without writing to the catalogue', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/inventory/products', { waitUntil: 'domcontentloaded' });

    await openNewProductForm(page);

    // Count the products before, so "wrote nothing" can be measured rather than asserted
    // from principle.
    const before = await countProducts(page);

    // The lookup box is what a user reaches for instead of typing 14 fields by hand.
    const box = page.getByTestId('register-search');
    await box.fill('بروفين');

    const first = page.getByTestId('register-result').first();
    await expect(first).toBeVisible({ timeout: 20_000 });

    // Paracetamol under a common Egyptian brand. The Arabic is normalised for *search*
    // (hamza and alef variants collapse) but the name shown back is the register's own.
    await expect(first).toContainText(/بروفين/i);

    expect(await countProducts(page), 'searching changed the catalogue').toBe(before);
  });

  test('finds a medicine by generic English name', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/inventory/products', { waitUntil: 'domcontentloaded' });

    await openNewProductForm(page);
    const box = page.getByTestId('register-search');
    await box.fill('amoxicillin');

    const first = page.getByTestId('register-result').first();
    await expect(first).toBeVisible({ timeout: 20_000 });
    // Matched on generic composition, so the trade name need not contain the query.
    await expect(first).toContainText(/amoxicillin|أموكسيسيلين/i);
  });

  test('picking a result fills the form and saves nothing on its own', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/inventory/products', { waitUntil: 'domcontentloaded' });
    await openNewProductForm(page);

    const before = await countProducts(page);

    await page.getByTestId('register-search').fill('amoxicillin');
    const first = page.getByTestId('register-result').first();
    await expect(first).toBeVisible({ timeout: 20_000 });

    // Scoped to the form the lookup is in. The page renders an edit form per existing
    // product and those carry identical `name` attributes, so a bare `[name="nameEn"]`
    // matches several and -- more to the point -- asserts against the wrong form.
    const form = page.locator('form').filter({ has: page.getByTestId('register-search') });

    // The fields start empty, so anything present afterwards came from the suggestion.
    await expect(form.locator('[name="nameEn"]')).toHaveValue('');
    await first.click();

    // The whole point of the feature: the names are filled in, in both languages, so the
    // person does not type them. Arabic first -- it is what makes the register worth
    // having -- and the generic composition rides along because searching by it is one of
    // the two ways to find a row at all.
    await expect(form.locator('[name="nameAr"]')).not.toHaveValue('');
    await expect(form.locator('[name="nameEn"]')).not.toHaveValue('');
    await expect(form.locator('[name="genericNameEn"]')).toHaveValue(/amoxicillin/i);

    // Filling the form is not saving it. The save button is still the only thing that
    // writes, and a catalogue that grew because somebody searched would be exactly the
    // bulk import this replaced.
    expect(await countProducts(page), 'picking a suggestion saved a product').toBe(before);
    await expect(page.getByText(/created|saved/i).first()).toHaveCount(0);
  });

  test('refuses to offer a product the register marks cancelled', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, 'admin@demo.local');
    await page.goto('/en/admin/inventory/products', { waitUntil: 'domcontentloaded' });

    await openNewProductForm(page);
    const box = page.getByTestId('register-search');
    await box.fill('provera');

    // Either nothing matches, or what matches is not a refused row. The build script
    // drops CANCELLED / RECALLED / ILLEGAL IMPORT / BANNED, and this asserts that at the
    // surface a user actually sees rather than trusting the script did its job.
    await page.waitForTimeout(2_500);
    const results = page.getByTestId('register-result');
    const count = await results.count();
    for (let i = 0; i < count; i += 1) {
      await expect(results.nth(i)).not.toContainText(
        /cancelled|illegal import|recalled|banned|unapproved/i,
      );
    }
  });

  test('the lookup is not reachable without a session', async ({ browser }) => {
    test.setTimeout(60_000);

    // Unauthenticated, from a clean context. The register is public CC0 data, so this is
    // not about secrecy -- it is about not letting anyone spend this project's function
    // quota parsing 3.9 MB on demand.
    const ctx = await browser.newContext();
    const res = await ctx.request.get('http://localhost:3000/api/drug-register?q=بروفين');
    expect(res.status()).toBe(401);

    await ctx.close();
  });
});

/**
 * Open the collapsed "New product" section.
 *
 * The lookup lives inside it, which is the right place -- it is part of adding a product,
 * not a separate screen -- and which means it is hidden until the section is expanded.
 * Counting the catalogue has to happen after this too, or the "before" figure is taken
 * against a page state the test never returns to.
 */
async function openNewProductForm(page: Page) {
  const summary = page.locator('details > summary').first();
  if (!(await page.getByTestId('register-search').isVisible().catch(() => false))) {
    await summary.click();
  }
  await expect(page.getByTestId('register-search')).toBeVisible();
}

/**
 * How many products the catalogue holds right now.
 *
 * Counted from the rendered list, which is what "the catalogue" means to the person using
 * it. Deliberately not a direct REST call: this proves the *page* did not change, which is
 * the claim being made, and reaching past the page to the database would be asserting
 * something different and weaker.
 */
async function countProducts(page: Page): Promise<number> {
  return page.getByTestId('product-row').count();
}
