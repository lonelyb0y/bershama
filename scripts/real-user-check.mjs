/**
 * Real-user walkthrough, driven in Brave.
 *
 * Not a test suite -- a diagnostic. It walks the three paths a new person takes and
 * reports what the browser actually saw: console errors, failed requests, and where
 * each flow ended up. Written to answer "the Google button does nothing" and "the
 * email never arrives" with evidence rather than with a guess.
 *
 * Run: node scripts/real-user-check.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://pharmaflow-bay.vercel.app';
const BRAVE = process.env.BRAVE_PATH || '/usr/bin/brave-origin';

const log = (...a) => console.log(...a);
const head = (s) => log(`\n\x1b[1;36m── ${s}\x1b[0m`);

const browser = await chromium.launch({
  executablePath: BRAVE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.newContext({ locale: 'en-GB' });
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
const apiCalls = [];

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) =>
  failedRequests.push(`${r.method()} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`),
);
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/auth/v1/') || u.includes('/rest/v1/')) {
    apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '').slice(0, 120)}`);
  }
});

const errorsSeen = () => {
  const out = [];
  for (const e of consoleErrors) out.push(e);
  for (const f of failedRequests) out.push(`REQ FAIL ${f}`);
  return out;
};

// ── 1. the login page ────────────────────────────────────────────────────────
head('1. Login page');
await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
log('  url      :', page.url());
log('  heading  :', await page.locator('h1').first().innerText().catch(() => '(none)'));
log('  buttons  :', (await page.getByRole('button').allInnerTexts()).join(' | '));
log('  links    :', (await page.getByRole('link').allInnerTexts()).join(' | '));

// ── 2. the Google button ────────────────────────────────────────────────────
head('2. "Continue with Google"');
const googleBtn = page.getByRole('button', { name: /google/i });
if (await googleBtn.count()) {
  const before = errorsSeen().length;
  await googleBtn.click();
  await page.waitForTimeout(4000);
  log('  landed   :', page.url().slice(0, 200));
  const q = new URL(page.url()).searchParams;
  if (q.get('client_id')) log('  client_id:', q.get('client_id'));
  if (q.get('redirect_uri')) log('  redirect :', q.get('redirect_uri'));
  if (q.get('scope')) log('  scope    :', q.get('scope'));
  if (q.get('error')) log('  ERROR    :', q.get('error'), q.get('error_description') || '');
  const newErrors = errorsSeen().slice(before);
  if (newErrors.length) log('  browser errors:\n    ' + newErrors.join('\n    '));
} else {
  log('  !! the Google button is not on the page');
}

// ── 3. the signup page ──────────────────────────────────────────────────────
head('3. Signup page');
await page.goto(`${BASE}/en/signup`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
log('  url      :', page.url());
log('  heading  :', await page.locator('h1').first().innerText().catch(() => '(none)'));

const stamp = Date.now();
const email = `realuser-check-${stamp}@gmail.com`;
const password = 'Pr0be#Temp2026x';
await page.locator('#org').fill('Real User Pharmacy');
await page.locator('#name').fill('Real User');
await page.locator('#email').fill(email);
await page.locator('#new-password').fill(password);
log('  filled   :', email);

const before = errorsSeen().length;
await page.getByRole('button', { name: /create organisation/i }).click();
await page.waitForTimeout(8000);

log('  after submit url :', page.url().slice(0, 200));
const bodyText = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400);
log('  visible text     :', bodyText);
const newErrors = errorsSeen().slice(before);
if (newErrors.length) log('  browser errors:\n    ' + newErrors.join('\n    '));
log('  signup created   :', email);

head('4. API calls made during signup');
for (const c of apiCalls) log('   ', c);

// ── 5. the setup page (where a Google user lands) ───────────────────────────
head('5. /setup — where a Google sign-in lands');
await page.goto(`${BASE}/en/setup`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
log('  url      :', page.url());
log('  heading  :', await page.locator('h1').first().innerText().catch(() => '(none)'));
log('  text     :', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300));

head('6. Every console error and failed request');
const all = errorsSeen();
if (!all.length) log('  none');
else all.forEach((e) => log('   ', e));

await browser.close();
log('\nSIGNUP_EMAIL=' + email);
