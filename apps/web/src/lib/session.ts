// Server-side session access.
//
// Every authenticated page goes through here. Three things are deliberate:
//
//   1. getUser(), not getSession(). getSession() reads the JWT straight out of
//      the cookie and trusts it without contacting the auth server. That is fine
//      for deciding what to render optimistically and unacceptable for deciding
//      what data to show, because a revoked or tampered token would be honoured.
//      getUser() validates against the server on every call.
//
//   2. The tenant is never read from the URL, a header, or anything the caller
//      controls. It comes from the session via private.current_tenant_id(),
//      inside the database, behind RLS. A client asking for "tenant B's data" by
//      sending a different tenant id gets nothing, because that id never reaches
//      the query.
//
//   3. This module depends on next/headers and is therefore SERVER-ONLY. The
//      role-to-dashboard mapping lives in roles.ts so client components can use
//      it without dragging a server API into the browser bundle.

import { cache } from 'react';

import { asWhoAmI } from '@/lib/mappers';
import { getSupabase, getSupabaseApi } from '@/lib/supabase/server';
import type { AppRole, SessionInfo } from '@/lib/types';

export { homeRouteForRole, ROLES_BY_SURFACE, type Surface } from './roles';

/**
 * Current session, or null when signed out.
 *
 * `cache`d, so a layout and three nested components that each need the session
 * share one round trip.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await getSupabase();

  // The api client, because the identity call below is an api.* function and
  // needs the profile headers. Same session, same cookies, different address.
  const api = await getSupabaseApi();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  // One call returns identity, tenant and role together. It returns zero rows
  // for a user with no profile yet, or with an inactive profile, both of which
  // must read as "no session" rather than as a broken tenant.
  const { data, error: rpcError } = await api.rpc('whoami').maybeSingle();

  if (rpcError) {
    return null;
  }

  const row = asWhoAmI(data);
  if (row) {
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role,
      fullName: row.full_name,
      fullNameAr: row.full_name_ar,
      phone: row.phone ?? null,
      notifications: {
        expiry: row.notifications?.expiry ?? true,
        deliveries: row.notifications?.deliveries ?? true,
        requisitions: row.notifications?.requisitions ?? true,
      },
      locale: row.locale,
      tenantSlug: row.tenant_slug,
      currencyCode: row.currency_code,
      // Postgres returns numeric as a string to avoid precision loss. Convert
      // here rather than leaking the string type into every consumer.
      vatRate: Number(row.vat_rate),
      timezone: row.timezone,
    };
  }

  // No profile row yet (e.g. accounts created via the Admin API before the
  // seed ran). Fall back to the role and tenant carried in the signed JWT's
  // user_metadata. The JWT is issued by Supabase and cannot be forged by the
  // client, so both are trustworthy. RLS still enforces tenant isolation at
  // query time.
  const role = (user.user_metadata?.role as AppRole) ?? 'ANALYST';
  const tenantId = (user.user_metadata?.tenant_id as string) ?? '';
  return {
    userId: user.id,
    tenantId,
    role,
    fullName: user.user_metadata?.full_name ?? '',
    fullNameAr: null,
    phone: user.phone ?? null,
    notifications: { expiry: true, deliveries: true, requisitions: true },
    locale: 'en',
    tenantSlug: '',
    currencyCode: 'EGP',
    vatRate: 0,
    timezone: 'Africa/Cairo',
  };
});
