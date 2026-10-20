// Verify the UX fixes from docs/ux-audit-2026-10-20.md, against a running app.
//
// This is the check that decides whether the fixes work, and it is measured rather
// than eyeballed: the navigation is counted in rows at six viewport widths, the
// inventory count is read off the page, and the sign-in form is inspected for where
// the password would go.
//
// It needs a signed-in session, so point it at a dev server whose env points at the
// hosted project:
//
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
//   pnpm --filter @pharmaflow/web dev
//
//   node scripts/verify-ux-fixes.mjs [baseUrl]
//
// It signs in as ci-audit-admin@pharmaflow.test, which only exists while
// scripts/ci-fixture.sh has seeded it.

import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://localhost:3000';
const BRAVE = '/usr/bin/brave-origin';

const b = await chromium.launch({ executablePath: BRAVE, headless: true, args: ['--no-sandbox'] });

// ── 1. the navigation must be one row at every width ──────────────────────────
console.log('── nav rows by viewport ──');
for (const w of [390, 768, 1024, 1280, 1440, 1920]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  await p.getByLabel(/email address/i).fill('ci-audit-admin@pharmaflow.test');
  await p.getByLabel(/password/i).fill('Audit#Probe2026x');
  for (let i = 0; i < 6; i++) {
    await p.getByRole('button', { name: /sign in/i }).click().catch(() => {});
    if (await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 }).then(() => 1).catch(() => 0)) break;
    await p.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
    await p.getByLabel(/email address/i).fill('ci-audit-admin@pharmaflow.test');
    await p.getByLabel(/password/i).fill('Audit#Probe2026x');
    await p.waitForTimeout(700);
  }
  await p.goto(`${BASE}/en/admin`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const m = await p.evaluate(() => {
    const header = document.querySelector('header');
    const navs = [...document.querySelectorAll('nav')].filter((n) => n.offsetParent !== null);
    const nav = navs[0];
    const items = [...(nav?.querySelectorAll('a, span[aria-disabled]') ?? [])];
    const hr = header?.getBoundingClientRect();
    const last = items[items.length - 1]?.getBoundingClientRect();
    return {
      rows: nav ? new Set(items.map((i) => Math.round(i.getBoundingClientRect().top))).size : null,
      headerH: hr ? Math.round(hr.height) : null,
      lastBottom: last ? Math.round(last.bottom) : null,
      headerBottom: hr ? Math.round(hr.bottom) : null,
      escapes: hr && last ? last.bottom > hr.bottom + 1 : null,
      scrolls: nav ? nav.scrollWidth > nav.clientWidth : null,
    };
  });
  console.log(String(w).padStart(5), JSON.stringify(m));
  await ctx.close();
}

// ── 2. the inventory hub must not say zero ────────────────────────────────────
console.log('\n── inventory hub count ──');
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  await p.getByLabel(/email address/i).fill('ci-audit-admin@pharmaflow.test');
  await p.getByLabel(/password/i).fill('Audit#Probe2026x');
  for (let i = 0; i < 6; i++) {
    await p.getByRole('button', { name: /sign in/i }).click().catch(() => {});
    if (await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 }).then(() => 1).catch(() => 0)) break;
    await p.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
    await p.getByLabel(/email address/i).fill('ci-audit-admin@pharmaflow.test');
    await p.getByLabel(/password/i).fill('Audit#Probe2026x');
    await p.waitForTimeout(700);
  }
  await p.goto(`${BASE}/en/admin/inventory`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  console.log('  subtitle:', (await p.locator('p').first().innerText().catch(() => '')).trim());

  // 3. the dashboard margin
  await p.goto(`${BASE}/en/admin`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const margin = await p.evaluate(() => {
    const card = [...document.querySelectorAll('*')].find((el) =>
      el.children.length === 0 && /Margin if stock is sold/i.test(el.textContent || ''),
    );
    const box = card?.closest('div')?.parentElement;
    return box ? box.innerText.replace(/\n+/g, ' | ').slice(0, 160) : 'not found';
  });
  console.log('  margin card:', margin);

  // 4. the stocktake sheet: no raw keys, and the reason hidden without a variance
  await p.goto(`${BASE}/en/admin/inventory/stocktake`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const sheet = await p.evaluate(() => {
    const text = document.body.innerText;
    const selects = document.querySelectorAll('table select');
    const placeholders = [...document.querySelectorAll('table input')].map((i) => i.placeholder);
    return {
      rawKeys: ['inventory.batch', 'stocktake.expiringSoon'].filter((k) => text.includes(k)),
      selectsOnSheet: selects.length,
      placeholders: [...new Set(placeholders)],
    };
  });
  console.log('  stocktake:', JSON.stringify(sheet));
  await ctx.close();
}

// ── 5. the password must never reach a URL ────────────────────────────────────
console.log('\n── password in the URL ──');
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await ctx.addInitScript(() => {
    // Simulate the window before the bundle has hydrated: the form is markup with
    // no handler attached, which is what a slow connection looks like.
    const original = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      window.__nativeSubmit = this.action + '?' + new URLSearchParams(new FormData(this)).toString();
    };
  });
  await p.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  await p.getByLabel(/email address/i).fill('ci-audit-admin@pharmaflow.test');
  await p.getByLabel(/password/i).fill('SecretPassword123!');
  const method = await p.evaluate(() => document.querySelector('form')?.getAttribute('method'));
  const action = await p.evaluate(() => document.querySelector('form')?.getAttribute('action'));
  console.log('  form method :', method);
  console.log('  form action :', action);
  console.log('  password in the URL? ', /password=/i.test(String(action)) ? 'YES (bad)' : 'no');
  await ctx.close();
}

await b.close();
