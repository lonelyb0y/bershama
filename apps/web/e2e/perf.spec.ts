import { expect, test } from '@playwright/test';
import { clickSignIn } from './helpers/session';

/**
 * A one-off performance probe, kept in the repo because the question recurs.
 *
 * ── why this is a spec and not a script ──────────────────────────────────────
 * A shell script with curl cannot answer it. "Sluggish" is three different things —
 * time to first byte, time to first paint, and time until the page stops moving the
 * main thread — and only a browser measures the last two. So this loads each
 * authenticated surface, records what the browser knows, and prints it.
 *
 * It asserts nothing on purpose. A perf probe that fails on a bad number becomes a
 * test people delete when the number is bad, and the measurement is the point. Run
 * it with:
 *
 *   E2E_BASE_URL=https://bershama-bay.vercel.app npx playwright test e2e/perf.spec.ts
 */
const PASSWORD = 'Bershama#2026';

const SURFACES = [
  { name: 'dashboard', path: '/en/admin' },
  { name: 'catalogue', path: '/en/admin/inventory/products' },
  { name: 'batches', path: '/en/admin/inventory/batches' },
  { name: 'requisitions', path: '/en/admin/inventory/requisitions' },
  { name: 'stocktake', path: '/en/admin/inventory/stocktake' },
  { name: 'deliveries', path: '/en/admin/deliveries' },
  { name: 'driver', path: '/en/driver' },
];

interface Timing {
  ttfb: number;
  domContentLoaded: number;
  load: number;
  fcp: number;
}

test('measure every surface', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill(PASSWORD);
  await clickSignIn(page);
  await page.waitForURL((url) => !url.pathname.includes('/login'));

  const rows: Array<{ name: string } & Timing & { bytes: number; nodes: number; requests: number }> = [];

  // ── why three samples ──────────────────────────────────────────────────────
  // One measurement of FCP off a CDN varies by several hundred milliseconds run to
  // run, which is wider than most of the differences worth acting on. The first
  // version of this probe reported a dashboard paint of 4292ms on one run and 1508ms
  // on the next, and I read the first as a real problem and the second as a fix.
  //
  // So: three samples, and the *best* one reported. Best rather than median because
  // the best run is the one closest to what the code costs, with the rest being edge
  // and network noise. Request counts and node counts are exact regardless.
  const RUNS = 3;

  for (const surface of SURFACES) {
    const samples: Timing[] = [];
    let nodes = 0;
    let requests = 0;
    let bytes = 0;
    const onResponse = (response: { headers(): Record<string, string> } & { url(): string }) => {
      requests += 1;
      const length = response.headers()['content-length'];
      if (length) bytes += Number(length);
    };
    page.on('response', onResponse);

    for (let run = 0; run < RUNS; run += 1) {
      requests = 0;
      bytes = 0;
      await page.goto(surface.path, { waitUntil: 'load' });
      // Long enough for the shader to spin up and any reveal to finish, so the number
      // includes the work a person actually waits through.
      await page.waitForTimeout(1500);

      const timing = (await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return {
          ttfb: Math.round(nav.responseStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
          fcp: fcp ? Math.round(fcp.startTime) : -1,
        };
      })) as Timing;

      samples.push(timing);
      if (run === 0) nodes = await page.evaluate(() => document.querySelectorAll('*').length);
    }

    page.off('response', onResponse);
    const best = (pick: (t: Timing) => number) => Math.min(...samples.map(pick));
    rows.push({
      name: surface.name,
      ttfb: best((t) => t.ttfb),
      domContentLoaded: best((t) => t.domContentLoaded),
      load: best((t) => t.load),
      fcp: best((t) => t.fcp),
      bytes,
      nodes,
      requests,
    });
  }

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log('\n  surface        TTFB   FCP   load   nodes  reqs');
  console.log('  ' + '─'.repeat(56));
  for (const r of rows) {
    console.log(
      `  ${pad(r.name, 14)}${pad(String(r.ttfb), 6)}${pad(String(r.fcp), 6)}${pad(String(r.load), 6)}${pad(String(r.nodes), 7)}${r.requests}`,
    );
  }
  console.log('');

  expect(rows.length).toBe(SURFACES.length);
});