'use client';

// Browser Supabase client.
//
// This one holds the PUBLISHABLE key, which is public by design. It is safe in
// the bundle because RLS decides what it can reach: the same key on another
// website can read exactly the same rows and no more. The entire security model
// depends on the policies in supabase/migrations being correct, which is why
// those policies have their own pgTAP suite.
//
// There is deliberately no admin client for the browser. The secret key cannot
// be used from a browser at all (Supabase returns 401 for a secret key in a
// browser User-Agent), and shipping it in a bundle would expose every tenant's
// data.
//
// This module must stay free of `next/headers` and any other server-only import.
// Client components import it; a server-only dependency here fails the build.

import { createBrowserClient } from '@supabase/ssr';

import { API_DB_OPTION } from './api-schema';

let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
          'Copy .env.example to .env.local at the repository root.',
      );
    }

    client = createBrowserClient(url, key);
  }

  return client;
}

// ── the api schema, in the browser ──────────────────────────────────────────
//
// Needed by the sign-in form, which asks `api.whoami` for the caller's role
// before routing them. Separate from the public client for the reason in
// api-schema.ts: reaching the api schema needs the profile headers, and
// `.schema('api')` is a 404 here.
let apiClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseApiClient() {
  if (!apiClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
          'Copy .env.example to .env.local at the repository root.',
      );
    }

  apiClient = createBrowserClient(url, key, {
    // `db.schema`, NOT `global.headers`. See lib/supabase/api-schema.ts.
    db: { ...API_DB_OPTION },

    // isSingleton: false, and this line is load-bearing.
    //
    // createBrowserClient keeps a module-level `cachedBrowserClient` and, in a
    // browser, returns it for every later call while IGNORING the new options.
    // The public client is created first during sign-in, so the api client got
    // handed that same public client back -- no db.schema, no api routing -- and
    // `rpc('whoami')` went out as public.whoami (PGRST202). The role came back
    // empty, `role ?? 'ANALYST'` filled the gap, and every user was routed to
    // /admin regardless of their actual role.
    //
    // Two different configurations need two different clients, so the api one
    // must opt out of the cache rather than join it.
    isSingleton: false,
  });
  }

  return apiClient;
}
