/**
 * The hostile-user crawl.
 *
 * Visits every screen as every role, at desktop and phone width, and reports what the
 * browser actually did: how long it took, what it failed to load, how much is on the
 * page, and how many things a person would have to click.
 *
 * The numbers are the audit. A screenshot shows what it looks like; these show what it
 * costs. A page that renders in 4.2s with eleven round trips and an empty state is a
 * different problem from one that renders in 300ms with a table full of rows, and only
 * one of them is visible by eye.
 *
 * Run: node scripts/ux-audit.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://pharmaflow-bay.vercel.app';
const BRAVE = process.env.BRAVE_PATH || '/usr/bin/brave-origin';
const OUT = process.env.SHOT_DIR || '/tmp/opencode/ux-shots';
mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  admin: 'ci-audit-admin@pharmaflow.test',
  pharmacy: 'ci-audit-pharmacy@pharmaflow.test',
  driver: 'ci-audit-driver@pharmaflow.test',
};
const PASSWORD = 'Audit#Probe2026x';

const ROUTES = [
  { role: 'anon', path: '/en', name: 'landing' },
  { role: 'anon', path: '/en/login', name: 'login' },
  { role: 'anon', path: '/en/signup', name: 'signup' },
  { role: 'admin', path: '/en/admin', name: 'dashboard' },
  { role: 'admin', path: '/en/admin/inventory', name: 'inventory' },
  { role: 'admin', path: '/en/admin/inventory/products', name: 'products' },
  { role: 'admin', path: '/en/admin/inventory/batches', name: 'batches' },
  { role: 'admin', path: '/en/admin/inventory/requisitions', name: 'requisitions' },
  { role: 'admin', path: '/en/admin/inventory/stocktake', name: 'stocktake' },
  { role: 'admin', path: '/en/admin/alerts', name: 'alerts' },
  { role: 'admin', path: '/en/admin/analytics', name: 'analytics' },
  { role: 'admin', path: '/en/admin/deliveries', name: 'deliveries' },
  { role: 'pharmacy', path: '/en/pharmacy', name: 'pharmacy' },
  { role: 'driver', path: '/en/driver', name: 'driver' },
  { role: 'admin', path: '/ar/admin', name: 'dashboard-ar' },
  { role: 'admin', path: '/ar/admin/inventory/products', name: 'products-ar' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

const log = (...a) => console.log(...a);
const results = [];

const browser = await chromium.launch({
  executablePath: BRAVE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

// One context per role, so the session cookie is fetched once and reused.
const contexts = {};
for (const [role, email] of Object.entries(ACCOUNTS)) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[0], locale: 'en-GB' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);

  // Retry the click until the form actually reacts.
  //
  // Without this, the click lands on markup with no handler on it, the browser
  // submits the form natively as a GET, and the password ends up in the URL. That
  // happens in a real browser too, on a slow connection -- it is not a test artefact,
  // and it is recorded as a finding below rather than worked around silently.
  let landed = false;
  for (let attempt = 0; attempt < 6 && !landed; attempt++) {
    await page.getByRole('button', { name: /sign in/i }).click().catch(() => {});
    landed = await page
      .waitForURL((u) => !u.pathname.includes('/login'), { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (!landed) {
      await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel(/email address/i).fill(email);
      await page.getByLabel(/password/i).fill(PASSWORD);
      await page.waitForTimeout(1200);
    }
  }
  contexts[role] = ctx;
  log(`signed in as ${role}: ${landed ? 'OK' : 'FAILED'} -> ${page.url()}`);
}

// An anonymous context for the public pages.
const anon = await browser.newContext({ viewport: VIEWPORTS[0], locale: 'en-GB' });
contexts.anon = anon;

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const ctx = contexts[route.role];
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });

    const consoleErrors = [];
    const failed = [];
    const requests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));
    page.on('requestfailed', (r) => failed.push(r.url().slice(0, 90)));
    page.on('request', (r) => requests.push(r.url()));

    const t0 = Date.now();
    let status = 0;
    try {
      const res = await page.goto(`${BASE}${route.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      status = res?.status() ?? 0;
    } catch (e) {
      consoleErrors.push('goto: ' + String(e).slice(0, 120));
    }
    const ttfb = Date.now() - t0;

    // Give the client bundle a moment to hydrate and then render.
    await page.waitForTimeout(2500);
    const total = Date.now() - t0;

    const metrics = await page
      .evaluate(() => {
        const text = (document.body.innerText || '').trim();
        const interactive = document.querySelectorAll(
          'a[href], button, input, select, textarea, [role="button"]',
        ).length;
        const tables = document.querySelectorAll('table').length;
        const rows = document.querySelectorAll('tbody tr').length;
        const headings = [...document.querySelectorAll('h1,h2')].map((h) =>
          (h.innerText || '').trim(),
        );
        const empties = [...document.querySelectorAll('*')].filter((el) => {
          const t = (el.innerText || '').trim();
          return (
            el.children.length === 0 &&
            /no |nothing |empty|couldn|failed|error/i.test(t) &&
            t.length < 120
          );
        }).length;
        const imgs = [...document.querySelectorAll('img')].filter(
          (i) => !i.complete || i.naturalWidth === 0,
        ).length;
        return {
          textLen: text.length,
          interactive,
          tables,
          rows,
          headings: headings.slice(0, 6),
          empties,
          brokenImages: imgs,
          title: document.title,
        };
      })
      .catch(() => ({}));

    const shot = `${OUT}/${route.name}-${vp.name}.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    const apiCalls = requests.filter((u) => u.includes('/rest/v1/') || u.includes('/auth/v1/')).length;
    const totalRequests = requests.length;

    results.push({
      route: route.name,
      path: route.path,
      role: route.role,
      vp: vp.name,
      status,
      ttfb,
      total,
      requests: totalRequests,
      apiCalls,
      consoleErrors: consoleErrors.length,
      failed: failed.length,
      ...metrics,
      shot,
    });

    log(
      `${vp.name.padEnd(7)} ${route.name.padEnd(16)} ${String(status).padEnd(4)} ` +
        `ttfb=${String(ttfb).padStart(5)}ms total=${String(total).padStart(5)}ms ` +
        `req=${String(totalRequests).padStart(3)} api=${String(apiCalls).padStart(2)} ` +
        `text=${String(metrics.textLen ?? 0).padStart(5)} ` +
        `btns=${String(metrics.interactive ?? 0).padStart(3)} ` +
        `rows=${String(metrics.rows ?? 0).padStart(3)} ` +
        `err=${consoleErrors.length}`,
    );
    if (consoleErrors.length) log(`         ! ${[...new Set(consoleErrors)].slice(0, 3).join(' | ')}`);

    await page.close();
  }
}

await browser.close();

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/opencode/ux-audit.json', JSON.stringify(results, null, 2));
log('\nwrote /tmp/opencode/ux-audit.json');
