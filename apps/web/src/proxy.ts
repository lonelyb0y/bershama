// Session refresh + locale routing.
//
// Next.js 16 renamed the `middleware` file convention to `proxy`. The exported
// function is still called `middleware`; only the filename changed. Using the old
// name still works but emits a deprecation warning on every build.
//
// Two jobs, composed in one middleware so there is a single pass over the
// request:
//
//   1. Supabase session refresh. JWTs are short-lived (1 hour). Without this, a
//      shift-long session silently starts failing every query, and the operator
//      loses work. getUser() validates the token against the auth server —
//      getSession() would only trust the cookie's own claim, which is not a
//      check at all.
//   2. next-intl locale negotiation, so /ar/... and /en/... both resolve and the
//      `dir` attribute is correct before render.
//
// This does NOT redirect unauthenticated users. Route guards live in the layouts
// for /admin, /pharmacy and /distributor, where the required role is known.
// Redirecting here would fire before the locale prefix resolved and loop against
// /login.
//
// NOTE: Node runtime, not Edge. getUser makes a network call, and this is the one
// file where a silent auth failure is expensive.

import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { getSupabase } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';

const handleIntl = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  // 1. Refresh the session, mutating the request cookies so the outgoing
  //    response carries the rotated token.
  let response = NextResponse.next({ request });

  const supabase = await getSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Liveness signal for the admin "who is online" view. Best-effort: a
    // failure here must never block navigation.
    //
    // `.catch` does not exist on a PostgrestFilterBuilder because it is a
    // thenable, not a Promise, so the rejection is handled with try/catch
    // instead of a trailing catch.
    try {
      await supabase.rpc('touch');
    } catch {
      // Intentionally ignored.
    }
  }

  // 2. Locale handling. Rewrites the URL to the /<locale>/... form and returns
  //    a redirect on the first visit when the locale is missing.
  response = handleIntl(request);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api, /_next, /_vercel  infrastructure paths
     *  - paths with a file extension (static assets, icons, manifests)
     */
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
