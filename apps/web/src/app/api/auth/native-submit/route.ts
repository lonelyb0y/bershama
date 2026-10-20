import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Where the sign-in form goes if it is submitted before React has hydrated.
 *
 * ── why this exists ────────────────────────────────────────────────────────────
 *
 * The sign-in form is a client component: its submit handler calls preventDefault()
 * and signs in through supabase-js. But a form with no `action` and no `method` is a
 * GET to the current URL, and a GET puts every field in the query string.
 *
 * So clicking "Sign in" before the bundle has hydrated sent the browser to
 *
 *   /en/login?email=someone%40gmail.com&password=PharmaFlow%232026
 *
 * The password in a URL is in the address bar, in the browser history, in the
 * Referer header of anything the page loads next, and in every proxy and server log
 * between the person and the page. It happened on a slow connection, on a cold
 * cache, or when the device was under load -- exactly when nobody is looking.
 *
 * The crawlers fell into it on their first run, which is how it was found.
 *
 * ── what this route does ───────────────────────────────────────────────────────
 *
 * Nothing. It receives the POST, discards the body, and sends the person back to the
 * form. The credentials are not used, not logged and not forwarded anywhere; the
 * point is only that they travel in a request body rather than in a URL.
 *
 * By the time the form is interactive the handler is attached and none of this
 * happens. This route is the fallback for the window before that, and it puts the
 * password somewhere it cannot be read out of a scroll position.
 */
export async function POST(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get('locale') ?? 'en';

  // 303, so the browser follows with GET and the form is clean on arrival.
  return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
}
