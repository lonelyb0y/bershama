import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { homeRouteForRole } from '@/lib/roles';
import type { Database } from '@/lib/database.types';

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

  // Resolve the caller's role so a signed-in user lands on their own surface,
  // not on the marketing page. Use the same supabase client that performed the
  // exchange: its session is in memory, so getUser and the profiles lookup both
  // see it. (getSession() would NOT work here -- it builds a fresh client that
  // reads request cookies, and the session cookie was just written to this
  // response's Set-Cookie header, not to the incoming request.)
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.redirect(new URL(`/${locale}/login`, origin));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = (profile as Database['public']['Tables']['profiles']['Row'] | null)?.role;

  // Default: the role's home route, with the locale prefix this app requires.
  const defaultTarget = role ? `/${locale}${homeRouteForRole(role)}` : `/${locale}/login`;

  // Honor a validated `next` deep link; otherwise fall back to the role home.
  const target =
    next && next.startsWith('/') && !next.startsWith('//') ? next : defaultTarget;

  return NextResponse.redirect(new URL(target, origin));
}