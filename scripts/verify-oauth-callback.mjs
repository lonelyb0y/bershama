/**
 * Prove the OAuth callback actually sets cookies, without involving Google.
 *
 * The bug: the callback exchanged the code through a createBrowserClient, which in a
 * Route Handler has no cookie jar, so the session was fetched and dropped. Nothing
 * errored -- the button just "did nothing".
 *
 * The fix has to be proven end to end: a real authorisation code, exchanged by the real
 * production route, with a real Set-Cookie in the response.
 *
 * The code comes from GoTrue's own verify endpoint. The Admin API's generate_link hands
 * back a one-time token, and /auth/v1/verify accepts a `code_challenge` — which is how
 * a PKCE flow completes without a third-party provider. So this exercises exactly the
 * path Google would produce, minus Google.
 *
 *   1. mint a code_verifier and its S256 challenge
 *   2. ask the Admin API for a one-time token
 *   3. walk /auth/v1/verify with the challenge -> a redirect carrying `?code=`
 *   4. call the production /auth/callback with that code and the verifier cookie
 *   5. assert the response sets a session cookie
 *
 * Run: node scripts/verify-oauth-callback.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kswdttkwtqqlabcjsgcy.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL || 'https://pharmaflow-bay.vercel.app';
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
  process.exit(1);
}

const log = (...a) => console.log(...a);
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const email = `callback-probe-${Date.now()}@gmail.com`;
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const cookieName = `sb-${PROJECT_REF}-auth-token-code-verifier`;

// ── 1. a one-time token, from the Admin API ─────────────────────────────────
log('1. asking the Admin API for a one-time token');
const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ type: 'magiclink', email, options: { redirectTo: `${APP_URL}/auth/callback` } }),
});
const gen = await genRes.json();
if (!genRes.ok) {
  console.error('   failed:', JSON.stringify(gen).slice(0, 300));
  process.exit(1);
}
// The Admin API returns action_link at the top level, not under `properties`, and the
// verification type depends on whether the address already had an account: a new
// address gets a `signup` link, an existing one a `magiclink`. Guessing the type
// produces a verify call that silently does nothing.
const actionLink = gen.action_link ?? '';
const verificationType = gen.verification_type ?? 'magiclink';
const token = new URL(actionLink).searchParams.get('token');
if (!token) {
  console.error('   no one-time token in:', actionLink.slice(0, 200));
  process.exit(1);
}
log('   got a', verificationType, 'token for', email);

// ── 2. the verify endpoint, with the PKCE challenge ─────────────────────────
log('2. walking /auth/v1/verify with the S256 challenge');
const verifyUrl =
  `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(token)}` +
  `&type=${verificationType}&redirect_to=${encodeURIComponent(`${APP_URL}/auth/callback`)}` +
  `&code_challenge=${challenge}&code_challenge_method=s256`;
const verifyRes = await fetch(verifyUrl, { redirect: 'manual' });
const location = verifyRes.headers.get('location') ?? '';
log('   verify status:', verifyRes.status);
const code = new URL(location, APP_URL).searchParams.get('code');
if (!code) {
  console.error('   no code in the redirect:', location.slice(0, 300));
  process.exit(1);
}
log('   got an authorisation code');

// ── 3. the production callback, with the verifier cookie ───────────────────
log('3. calling the production /auth/callback');
const callbackRes = await fetch(`${APP_URL}/auth/callback?code=${encodeURIComponent(code)}&next=/en`, {
  redirect: 'manual',
  headers: { Cookie: `${cookieName}=${verifier}` },
});
log('   status :', callbackRes.status);
log('   location:', (callbackRes.headers.get('location') ?? '(none)').slice(0, 160));

const setCookies = callbackRes.headers.getSetCookie?.() ?? [];
const sessionCookie = setCookies.find((c) => /auth-token\.\d/.test(c));
log('   set-cookie headers:', setCookies.length);
for (const c of setCookies) log('     ', c.split(';')[0].slice(0, 60), '...');

// ── 4. the verdict ─────────────────────────────────────────────────────────
log('\n── verdict ──');
if (!sessionCookie) {
  log('   FAIL: the callback did not set a session cookie.');
  log('   The exchange succeeded but the session went nowhere -- the original bug.');
} else {
  log('   PASS: the callback set a session cookie.');
}
const loc = callbackRes.headers.get('location') ?? '';
log(loc.includes('/setup')
  ? '   and it sent the user to /setup (signed in, no organisation yet) — correct.'
  : loc.includes('/login')
    ? '   but it bounced to /login — the session still is not being kept.'
    : '   and it redirected to ' + loc);

// tidy up
await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
})
  .then((r) => r.json())
  .then((d) => {
    for (const u of d.users ?? []) {
      if (u.email === email) {
        fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        log('\n   removed the probe user');
      }
    }
  });

process.exit(sessionCookie ? 0 : 1);
