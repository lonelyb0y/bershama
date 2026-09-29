// Supabase clients.
//
// Two factories, and the distinction is a security boundary, not a convenience:
//
//   createSupabaseServerClient — runs as the signed-in user. RLS applies. Use
//                               for anything that reads or writes tenant data.
//   createSupabaseAdminClient  — runs as service_role, which has BYPASSRLS and
//                               sees every tenant. It bypasses tenant isolation
//                               entirely.
//
// The admin client accepts NO user input and is used only for the handful of
// operations RLS deliberately cannot perform: issuing an invitation (which must
// write a row the caller cannot yet see) and provisioning the first tenant.
// Every use is commented at the call site, because "just use the admin client"
// is how tenant isolation gets quietly deleted from a codebase.

import { createServerClient } from '@supabase/ssr';
import { API_DB_OPTION } from './api-schema';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Copy .env.example to .env.local at the repository root and fill it in.`,
    );
  }
  return value;
}

/**
 * A Supabase client bound to the current request's session cookies.
 *
 * Note the two Next.js 16 specifics:
 *   - `cookies()` is async, so it must be awaited.
 *   - The cookie store is READ-ONLY inside a Server Component. `setAll` will
 *     throw there, and that is expected: middleware already refreshes the
 *     session and writes the rotated token, so the render pass has nothing to
 *     do. Swallowing it keeps a legitimate render from failing.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component: the cookie store is read-only. See above.
          }
        },
      },
    },
  );
}

// `cache` dedupes within a single request. Without it, a page that reads the
// session in three places creates three clients and three network round trips.
export const getSupabase = cache(async () => {
  return createSupabaseServerClient();
});

// ── the api schema ───────────────────────────────────────────────────────────
//
// A separate client, not a mode of the public one, because reaching the api
// schema is a different conversation with the server: it needs the profile
// headers, and the path-based `.schema('api')` is a 404 on this project. See
// lib/supabase/api-schema.ts for the evidence and the security checks.
//
// Deliberately `cache`d like getSupabase, so a page that needs both pays for
// one client of each rather than one per call site.
export const getSupabaseApi = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
        // `db.schema`, NOT `global.headers`. See lib/supabase/api-schema.ts: the
        // header pair is silently dropped by supabase-js on POST, so `whoami`
        // resolved as public.whoami (PGRST202), getSession() read that as signed
        // out, and every authenticated page bounced the user to /login.
        db: { ...API_DB_OPTION },
        cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component: read-only cookie store. See above.
          }
        },
      },
    },
  );
});

// ── admin (BYPASSRLS) ────────────────────────────────────────────────────────
//
// SECURITY: bypasses tenant isolation. Never accept request input here. Never
// import this from a file that handles user-supplied data without an explicit
// tenant_id filter that you have verified.

export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
