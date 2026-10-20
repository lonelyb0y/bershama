import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * OAuth callback.
 *
 * Supabase redirects here with `?code=...` after a Google sign-in, exchanges
 * the code for a session, and sets the cookies. `skipBrowserRedirect` keeps
 * this server-side so the cookies are written by a Set-Cookie header this
 * response actually sends -- a client-side exchange would set them in the
 * browser instead, which is what `@supabase/ssr` is for, but the server route
 * keeps the redirect a single hop and avoids the intermediate page.
 *
 * `next` is read from the query rather than trusted from state: it decides
 * where the user lands, so it is validated against a locale and a known path
 * instead of being echoed. An open redirect here would be a credential leak.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '';
  const error = searchParams.get('error_description') ?? searchParams.get('error');

  // Recover the locale from a `next` of the form "/en/admin", else default.
  const match = /^\/([a-z]{2})(?:\/|$)/.exec(next);
  const locale = match ? match[1] : 'en';

  const safeNext = (() => {
    // Only same-origin, absolute paths. A protocol-relative "//evil.com" or an
    // absolute "https://evil.com" must not survive this.
    if (!next.startsWith('/') || next.startsWith('//')) return `/${locale}/login`;
    return next;
  })();

  if (error) {
    const url = new URL(`/${locale}/login`, origin);
    url.searchParams.set('error', error);
    return NextResponse.redirect(url);
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/${locale}/login`, origin));
  }

    // ── this must be a SERVER client ───────────────────────────────────────────
  //
  // The first version of this route used getSupabaseApiClient(), which is a
  // createBrowserClient. In a route handler there is no browser, so it has no cookie
  // jar to write to: exchangeCodeForSession() succeeded, the session went nowhere, the
  // browser stayed anonymous, and every "Continue with Google" sign-in ended at /login
  // with no error anywhere. The exchange was never the problem -- the session was
  // fetched and then dropped on the floor.
  //
  // createSupabaseServerClient() binds the client to the request's cookie store, so
  // the session is written as a Set-Cookie header on this response and the browser
  // sends it on the next request. In a Route Handler the cookie store is writable;
  // the read-only case is Server Components, and this is not one.
  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const url = new URL(`/${locale}/login`, origin);
    url.searchParams.set('error', exchangeError.message);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}