import { test } from '@playwright/test';

// Which resource finishes last, and what did we download. Complements perf.spec.ts,
// which says a page is slow; this says which bytes made it slow.
test('what is the dashboard waiting for', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/en/login');
  await page.getByLabel(/email address/i).fill('admin@demo.local');
  await page.getByLabel(/password/i).fill('PharmaFlow#2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'));

  await page.goto('/en/admin', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const paint = performance.getEntriesByType('paint').map((p) => `${p.name}=${Math.round(p.startTime)}`);
    const bySize = [...res].sort((a, b) => b.transferSize - a.transferSize).slice(0, 8)
      .map((r) => ({ url: r.name.split('/').slice(-1)[0].slice(0, 34), kb: Math.round(r.transferSize / 1024), end: Math.round(r.responseEnd) }));
    const longest = [...res].sort((a, b) => b.responseEnd - a.responseEnd).slice(0, 5)
      .map((r) => ({ url: r.name.split('/').slice(-1)[0].slice(0, 34), end: Math.round(r.responseEnd), start: Math.round(r.startTime) }));
    return { paint, count: res.length, bySize, longest };
  });

  console.log('\n  paint:', JSON.stringify(data.paint));
  console.log('  resources:', data.count);
  console.log('  largest by transferred bytes:');
  for (const r of data.bySize) console.log(`    ${r.url.padEnd(36)} ${String(r.kb).padStart(5)} KB  end=${r.end}ms`);
  console.log('  last to finish:');
  for (const r of data.longest) console.log(`    ${r.url.padEnd(36)} start=${r.start}ms end=${r.end}ms`);
  console.log('');
});
