import { test, expect, devices } from '@playwright/test';

/**
 * Screenshots of every surface, for looking at.
 *
 * A real browser session: it signs in with real credentials, waits for the data,
 * and captures what a person would actually see.
 *
 * The suite asserts on URLs and colours. Those are precise and they caught four
 * sign-in bugs, but they cannot tell you whether a page looks like a finished
 * product or a wireframe, and a header that drew the nav on top of the controls
 * passed every one of them. That judgement needs an eye on it, which is what
 * this file is for.
 *
 * Order matters: the login pages are captured while signed OUT, because the
 * login page redirects a signed-in visitor straight to their dashboard.
 */
const SHOTS = '/tmp/opencode/shots';

const LOGIN_PAGES = [
  { path: '/en/login', name: 'login-en' },
  { path: '/ar/login', name: 'login-ar' },
];

const APP_PAGES = [
  { path: '/en/admin', name: 'dashboard-en' },
  { path: '/ar/admin', name: 'dashboard-ar' },
  { path: '/en/admin/inventory', name: 'inventory-index-en' },
  { path: '/en/admin/inventory/products', name: 'products-en' },
  { path: '/ar/admin/inventory/products', name: 'products-ar' },
  { path: '/en/admin/inventory/batches', name: 'batches-en' },
  { path: '/ar/admin/inventory/batches', name: 'batches-ar' },
  { path: '/en/admin/inventory/requisitions', name: 'requisitions-en' },
  { path: '/ar/admin/inventory/requisitions', name: 'requisitions-ar' },
  { path: '/en/admin/inventory/stocktake', name: 'stocktake-en' },
  { path: '/ar/admin/inventory/stocktake', name: 'stocktake-ar' },
];

// 1280 rather than 1440: that is the width the header was reported as
// overlapping at, so it is the one worth keeping an image of.
test.use({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } });

for (const theme of ['light', 'dark'] as const) {
  test(`capture, ${theme}`, async ({ page }) => {
    // 1. Signed out: the login pages.
    for (const p of LOGIN_PAGES) {
      await page.goto(p.path);
      await page.evaluate((t) => localStorage.setItem('pharmaflow:theme', t), theme);
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: `${SHOTS}/${p.name}-${theme}.png`, fullPage: true });
      console.log(`  ${p.name}-${theme} -> ${page.url()}`);
    }

    // 2. Sign in.
    await page.goto('/en/login');
    await page.getByLabel(/email address/i).fill('admin@demo.local');
    await page.getByLabel(/password/i).fill('PharmaFlow#2026');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin', { timeout: 20_000 });

    // 3. Signed in: everything behind the guard.
    for (const p of APP_PAGES) {
      await page.evaluate((t) => localStorage.setItem('pharmaflow:theme', t), theme);
      await page.goto(p.path);
      await page.waitForLoadState('networkidle').catch(() => {});
      const cls = await page.evaluate(() => document.documentElement.className);
      await page.screenshot({ path: `${SHOTS}/${p.name}-${theme}.png`, fullPage: true });
      console.log(`  ${p.name}-${theme} -> ${page.url()}  [${cls.includes('dark') ? 'dark' : 'light'}]`);
    }

    expect(true).toBe(true);
  });
}
