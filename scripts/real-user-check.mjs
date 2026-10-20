// Real-user walkthrough, driven in Brave.

// Not a test suite -- a diagnostic. It walks the paths a new person takes and reports
// what the browser actually saw: console errors, failed requests, and where each flow
// ended up. It is how the Google callback bug was found -- the button worked, and the
// session was being thrown away afterwards.
//
// Run: node scripts/real-user-check.mjs [baseUrl]
import { chromium } from '@playwright/test';

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
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/auth/v1/') || u.includes('/rest/v1/')) {
    apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '').slice(0, 120)}`);
  }
});

const errorsSeen = () => [...consoleErrors, ...failedRequests.map((f) => `REQ FAIL ${f}`)];

// ── 1. the login page ────────────────────────────────────────────────────────
head('1. Login page');
await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
log('  heading  :', await page.locator('h1').first().innerText().catch(() => '(none)'));
log('  buttons  :', (await page.getByRole('button').allInnerTexts()).join(' | '));
log('  links    :', (await page.getByRole('link').allInnerTexts()).join(' | '));

// ── 2. the Google button ────────────────────────────────────────────────────
head('2. "Continue with Google"');
const googleBtn = page.getByRole('button', { name: /google/i });
if (await googleBtn.count()) {
  await googleBtn.click();
  await page.waitForTimeout(4000);
  log('  landed   :', page.url().slice(0, 160));
  const q = new URL(page.url()).searchParams;
  if (q.get('client_id')) log('  client_id:', q.get('client_id'));
  if (q.get('redirect_uri')) log('  redirect :', q.get('redirect_uri'));
  if (q.get('error')) log('  ERROR    :', q.get('error'), q.get('error_description') || '');
} else {
  log('  !! the Google button is not on the page');
}

// ── 3. sign up, and see whether the app becomes usable without an email ─────
head('3. Signup -> can the person get in and set up an organisation?');
await page.goto(`${BASE}/en/signup`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const email = `realuser-check-${Date.now()}@gmail.com`;
await page.locator('#org').fill('Real User Pharmacy');
await page.locator('#name').fill('Real User');
await page.locator('#email').fill(email);
await page.locator('#new-password').fill('Pr0be#Temp2026x');
log('  filled   :', email);

const before = errorsSeen().length;
await page.getByRole('button', { name: /create organisation/i }).click();
await page.waitForTimeout(9000);

log('  url      :', page.url().slice(0, 160));
log('  text     :', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 320));
const newErrors = errorsSeen().slice(before);
if (newErrors.length) log('  browser errors:\n    ' + newErrors.join('\n    '));

// ── 4. are the session cookies actually set? ────────────────────────────────
head('4. Session cookies after signup');
const cookies = await context.cookies();
const authCookies = cookies.filter((c) => /auth|token|sb-/i.test(c.name));
log('  auth-related cookies:', authCookies.length ? authCookies.map((c) => c.name).join(', ') : '(none)');
log('  cookie count        :', cookies.length);

// ── 5. does a signed-in session reach a real surface? ───────────────────────
head('5. Where does a signed-in person land?');
await page.goto(`${BASE}/en`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
log('  url      :', page.url().slice(0, 160));
log('  heading  :', await page.locator('h1').first().innerText().catch(() => '(none)'));
log('  text     :', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300));

head('6. API calls');
for (const c of apiCalls) log('   ', c);

head('7. Every console error and failed request');
const all = errorsSeen();
if (!all.length) log('  none');
else all.forEach((e) => log('   ', e));

await browser.close();
log('\nSIGNUP_EMAIL=' + email);
