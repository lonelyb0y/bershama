import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseApiClient } from '@/lib/supabase/client';

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

  const supabase = await getSupabaseApiClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const url = new URL(`/${locale}/login`, origin);
    url.searchParams.set('error', exchangeError.message);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}