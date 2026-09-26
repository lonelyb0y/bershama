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
