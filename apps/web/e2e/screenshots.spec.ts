import { test, expect, devices } from '@playwright/test';
import { clickSignIn } from './helpers/session';

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
      await page.evaluate((t) => localStorage.setItem('bershama:theme', t), theme);
      await page.reload();
      // `domcontentloaded` rather than hydration: this file only captures and asserts a
      // 2xx, and the authenticated pages are server-rendered, so the pixels are correct
      // before React attaches anything. Waiting for hydration here timed out on the
      // signed-out login pages, which have no header.
      await page.waitForLoadState('domcontentloaded');
      await page.screenshot({ path: `${SHOTS}/${p.name}-${theme}.png`, fullPage: true });
      console.log(`  ${p.name}-${theme} -> ${page.url()}`);
    }

    // 2. Sign in.
    await page.goto('/en/login');
    await page.getByLabel(/email address/i).fill('admin@demo.local');
    await page.getByLabel(/password/i).fill('Bershama#2026');
    await clickSignIn(page);
    await page.waitForURL('**/admin', { timeout: 20_000 });

    // 3. Signed in: everything behind the guard.
    for (const p of APP_PAGES) {
await page.evaluate((t) => localStorage.setItem('bershama:theme', t), theme);
        const res = await page.goto(p.path);
        const cls = await page.evaluate(() => document.documentElement.className);

        // Assert the page rendered *before* capturing it.
        //
        // This file used to end on `expect(true).toBe(true)`: it checked URLs and
        // colours, never that a page rendered. So a page returning 500 was
        // screenshotted -- the image on disk said "This page couldn't load" -- and the
        // run reported two passed. That is exactly what happened while the dashboard
        // was broken in production.
        expect(res?.status(), `${p.path} returned ${res?.status()}`).toBeLessThan(400);
        await expect(page.getByText(/couldn['’]?t load/i)).toHaveCount(0);
        await expect(page.locator('h1').first()).toBeVisible();

        await page.screenshot({ path: `${SHOTS}/${p.name}-${theme}.png`, fullPage: true });
        console.log(`  ${p.name}-${theme} -> ${page.url()}  [${cls.includes('dark') ? 'dark' : 'light'}]`);
      }
  });
}
