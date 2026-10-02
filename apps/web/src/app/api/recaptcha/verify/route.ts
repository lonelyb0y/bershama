import { NextResponse } from 'next/server';

import { verifyRecaptchaToken } from '@/lib/recaptcha-server';

/**
 * Verify a reCAPTCHA token before the client sends a password anywhere.
 *
 * ── why this route exists ────────────────────────────────────────────────────
 *
 * `supabase.auth.signInWithPassword` runs in the browser, so the server cannot verify
 * a token as part of that call. The check therefore has to happen *before* it, on a
 * separate round trip. Doing it after would mean the credential check had already run
 * -- a bot would still have burned a real sign-in attempt against the rate limiter,
 * and the attempts that get limited would be the staff sharing an office IP, which is
 * the opposite of the intent.
 *
 * ── what it returns ───────────────────────────────────────────────────────────
 * A verdict, not a session. The route says whether the submission may proceed and
 * nothing else: it does not mint a session, does not see the password, and does not
 * learn whether the account exists. The client then makes its own Supabase call, and
 * the session still comes from Supabase.
 *
 * ── rate limiting ─────────────────────────────────────────────────────────────
 * An open verification endpoint is free for an attacker to hammer: it would spend
 * this deployment's outbound calls and Google's quota on their behalf. There is a
 * per-IP budget below.
 *
 * It is honest about its own weakness: an in-memory counter is per serverless
 * instance, so a burst spread across instances gets more than its share, and a
 * determined attacker rotates source addresses for free. It exists to make casual
 * abuse expensive, not to be a rate limiter -- that wants a shared store, which is a
 * separate decision with its own availability cost.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.RECAPTCHA_VERIFY_RPM ?? '20');

/** `Map` rather than a bare object: the keys are arbitrary IP strings. */
const hits = new Map<string, { count: number; resetAt: number }>();

function overBudget(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

// The map is module state, so a long-lived instance accumulates one entry per address
// seen. Sweeping expired entries on write bounds it without needing a timer.
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, WINDOW_MS);
  timer.unref?.();
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  if (overBudget(ip)) {
    return NextResponse.json(
      { ok: false, reason: 'verify_failed' },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'verify_failed' }, { status: 400 });
  }

  const { token, action } = (body ?? {}) as { token?: unknown; action?: unknown };

  const verdict = await verifyRecaptchaToken(
    typeof token === 'string' && token.length > 0 ? token : null,
    { action: typeof action === 'string' ? action : undefined, remoteIp: ip },
  );

  return NextResponse.json(verdict, {
    // Not cached: two people behind one NAT must not share a verdict.
    headers: { 'cache-control': 'no-store' },
  });
}