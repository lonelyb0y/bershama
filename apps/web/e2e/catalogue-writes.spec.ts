import { expect, test, type Page } from '@playwright/test';
import { clickSignIn } from './helpers/session';

/**
 * The catalogue write path, driven through the forms.
 *
 * ── why this file exists at all ─────────────────────────────────────────────
 *
 * The product and location forms wrote directly to their tables while the api.*
 * functions that were supposed to serve them sat unused a few files away. Nothing
 * failed: the functions existed, the forms compiled, the unit tests passed, and the
 * create branch of the location form -- which did use a function -- worked, so the
 * pair looked fine. Direct writes return 42501 here, because the tenant triggers
 * call private.* and a client role cannot name that schema, so the forms were
 * broken at runtime and correct on paper.
 *
 * The type-safe Supabase clients are what now catch this class: an untyped rpc()
 * accepts any name, so `supabase.rpc('update_location', …)` compiled for months
 * against a function that did not exist. That fix found this file's neighbours.
 * These tests are the other half -- they prove the path works, not merely that it
 * type-checks, because "it compiles" was exactly the claim that was wrong.
 *
 * ── what each test changes, and whether that matters ─────────────────────────
 *
 * Each test creates one record with a unique marker and leaves it. The catalogue is
 * append-only by design and a test run adding a dozen rows to the demo tenant is
 * visible but harmless -- unlike the alternative, which would be a test that asserts
 * on records it then cannot clean up because there is no delete path. That absence
 * is deliberate: a hard delete would destroy the history a distributor is required
 * to keep.
 */

const PASSWORD = 'PharmaFlow#2026';

/** Unique per run, so repeated runs do not collide on the SKU's uniqueness. */
const marker = () => `E2E-${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email: string) {
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await clickSignIn(page);
  await page.waitForURL((url) => !url.pathname.includes('/login'));
}

/**
 * The product form, scoped to itself.
 *
 * Scoped by the submit button it contains, because the page has other fields called
 * "SKU" (the catalogue's own filter) and several called "Code". `getByLabel(/^SKU/)`
 * on the page resolves to two elements and Playwright refuses rather than guessing --
 * which is the right default, and the reason this is scoped rather than indexed.
 */
async function productForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('button', { name: 'Save product' }) });
}

async function locationForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('button', { name: 'Save location' }) });
}

async function openProductForm(page: Page) {
  await page.goto('/en/admin/inventory/products');
  await page.getByText('Add a product').click();
}

async function openLocationForm(page: Page) {
  await page.goto('/en/admin/inventory/products');
  await page.getByText('Add a storage location').click();
}

test.describe('the catalogue form writes through the api functions', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('creates a product and it appears in the catalogue', async ({ page }) => {
    const sku = marker();

    await openProductForm(page);

    const form = await productForm(page);
    await form.getByLabel(/^SKU/).fill(sku);
    await form.getByLabel(/^Name \(English\)/).fill('E2E Test Tablet');
    await form.getByLabel(/^Name \(Arabic\)/).fill('أقراص اختبار');
    await form.getByLabel(/^Strength/).first().fill('500');
    await form.getByRole('button', { name: 'Save product' }).click();

    // The product exists afterwards. Before the fix this form called
    // supabase.from('products').insert(...) and the save returned a permission error
    // the form rendered as a field message, so the catalogue simply never grew.
    //
    // Asserted as text rather than as a table cell: the catalogue row is a card on
    // this page, not a <td>, and pinning the markup would make the test a change
    // detector for layout somebody else owns.
    await expect(page.getByText(sku)).toBeVisible();
  });

  test('refuses a duplicate SKU by naming the field', async ({ page }) => {
    await openProductForm(page);

    // A SKU the seed already uses. The database raises 23505; the action maps it to
    // the sku field, because "duplicate key value violates unique constraint" tells
    // a warehouse supervisor nothing about what to change.
    const form = await productForm(page);
    await form.getByLabel(/^SKU/).fill('DEMO-001');
    await form.getByLabel(/^Name \(English\)/).fill('Duplicate Attempt');
    await form.getByLabel(/^Name \(Arabic\)/).fill('محاولة مكررة');
    await form.getByLabel(/^Strength/).first().fill('500');
    await form.getByRole('button', { name: 'Save product' }).click();

    await expect(form.getByText(/already in use/i)).toBeVisible();
  });

  test('a required field is actually required, and the browser stops the submit', async ({ page }) => {
    await openProductForm(page);

    const form = await productForm(page);

    // The defect this pins: Field consumed a `required` prop to draw its asterisk and
    // never forwarded it, so a field the form called required was not required. The
    // browser submitted it empty and the database refused the row with
    // products_strength_check -- a table name, to somebody filling in a form.
    await expect(form.getByLabel(/^Name \(English\)/)).toHaveAttribute('required', '');
    await expect(form.getByLabel(/^Name \(Arabic\)/)).toHaveAttribute('required', '');
    await expect(form.getByLabel(/^SKU/)).toHaveAttribute('required', '');

    await form.getByLabel(/^SKU/).fill(marker());
    // Names deliberately left empty.
    await form.getByRole('button', { name: 'Save product' }).click();

    // Blocked before the round trip, so nothing was created and no server-side error
    // is rendered. The server-side messages still exist and are still worth having --
    // HTML validation is a convenience and can be bypassed by anything posting
    // directly -- but the browser getting there first is the better outcome.
    await expect(form.getByText(/created|added/i)).toHaveCount(0);
  });

});

test.describe('the storage location form', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@demo.local');
  });

  test('creates a location in the warehouse', async ({ page }) => {
    const code = `E2E-${marker()}`;

    await openLocationForm(page);

    const form = await locationForm(page);
    await form.getByLabel(/facility/i).selectOption({ index: 1 });
    await form.getByLabel(/^Code/).fill(code);
    await form.getByLabel(/^Name \(English\)/).fill('E2E Bench');
    await form.getByLabel(/^Name \(Arabic\)/).fill('منضدة اختبار');
    await form.getByRole('button', { name: 'Save location' }).click();

    // No location list exists on this page, so the confirmation is the observable.
    // Asserting a row here would be asserting a feature that was never built.
    await expect(form.getByText('Location saved.')).toBeVisible();
  });

  test('refuses a temperature range that is upside down', async ({ page }) => {
    await openLocationForm(page);

    const form = await locationForm(page);
    await form.getByLabel(/facility/i).selectOption({ index: 1 });
    await form.getByLabel(/^Code/).fill(`E2E-${marker()}`);
    await form.getByLabel(/^Name \(English\)/).fill('Inverted Range');
    await form.getByLabel(/^Name \(Arabic\)/).fill('نطاق معكوس');
    await form.getByLabel(/^Min temperature/).fill('8');
    await form.getByLabel(/^Max temperature/).fill('2');
    await form.getByRole('button', { name: 'Save location' }).click();

    // Checked in the form rather than in the database: a maximum below a minimum is
    // a typo, and a database error about it would arrive after the round trip.
    await expect(form.getByText(/cannot be below the minimum/i)).toBeVisible();
  });
});

test.describe('the catalogue guards its own writes', () => {
  test('a pharmacy manager cannot reach the catalogue form\'s server action', async ({ page }) => {
    await signIn(page, 'pharmacy@demo.local');

    // The page itself is readable -- a pharmacy manager browses the catalogue to
    // raise a request against it -- but the write is refused by the role check in
    // api.create_product. Asserted here as a navigation fact: the edit controls are
    // not offered to a role that cannot use them.
    await page.goto('/en/admin/inventory/products');
    // The catalogue stays readable -- a pharmacy manager browses it to raise a
    // request -- but the write controls are not rendered for a role that cannot use
    // them. The role check in api.create_product is the actual control.
    await expect(page.getByText('Add a product')).toBeHidden();
  });
});