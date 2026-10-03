import { test } from '@playwright/test';
import { clickSignIn } from './helpers/session';

// Five samples of one surface, because a single run cannot distinguish a slow page
// from a slow edge node, and I have already made that mistake twice.
const PATH = process.env.PERF_PATH ?? '/en/admin/inventory/requisitions';

test('sample one surface repeatedly', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await clickSignIn(page);
  await page.waitForURL((u) => !u.pathname.includes('/login'));

  const fcps: number[] = [];
  const ttfbs: number[] = [];
  const slowest: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.goto(PATH, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const last = [...res].sort((a, b) => b.responseEnd - a.responseEnd)[0];
      return {
        ttfb: Math.round(nav.responseStart),
        fcp: fcp ? Math.round(fcp.startTime) : -1,
        slowest: last ? `${last.name.split('?')[0].split('/').pop()?.slice(0, 40)} end=${Math.round(last.responseEnd)}` : 'none',
        count: res.length,
      };
    });
    fcps.push(m.fcp);
    ttfbs.push(m.ttfb);
    slowest.push(`${m.fcp}ms (${m.count} reqs, last: ${m.slowest})`);
  }
  const best = Math.min(...fcps);
  console.log(`\n  ${PATH}`);
  console.log(`  ttfb: ${ttfbs.join(' ')}`);
  slowest.forEach((s, i) => console.log(`    run ${i + 1}: FCP ${s}`));
  console.log(`  best FCP: ${best}ms   median: ${fcps.sort((a, b) => a - b)[2]}ms\n`);
});
