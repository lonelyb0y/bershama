import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { SetupForm } from '@/components/setup-form';
import { getSession, homeRouteForRole } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/routing';

/**
 * The recovery path for a half-created account.
 *
 * Someone who confirmed their email and then closed the tab before provisioning has an
 * `auth.users` row and no `profiles` row. That user can read nothing -- every RLS policy
 * compares `tenant_id` against `private.current_tenant_id()`, which is NULL for them --
 * and `getSession()` returns null because `api.whoami()` has no row to return, so the
 * normal layout would bounce them to /login with no explanation and no way forward.
 *
 * This page is that way forward. It sits outside AuthenticatedShell precisely because
 * AuthenticatedShell is what would refuse to render it: there is no role yet, and there
 * is no surface. The only thing it checks is that a session exists, which is the one
 * precondition that does hold.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Three states, and the middle one is the reason this page exists. getSession()
  // collapses the first two into a single `null`, so it cannot answer this question on
  // its own:
  //
  //   no auth session at all      -> null -> /login
  //   session, no profile         -> null -> RENDER, and this is the whole point
  //   session, already provisioned -> a session -> their home
  //
  // Getting this wrong in the naive direction is not a cosmetic bug. Redirecting every
  // null at /login sends the half-made user back to the page they cannot get past, with
  // no explanation -- which is the exact loop this route was built to break. So the
  // signed-in-but-profileless case is established directly, by asking the auth server who
  // they are rather than asking whether they have an organisation.
  const session = await getSession();
  if (session) redirect(`/${locale}${homeRouteForRole(session.role)}`);

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect(`/${locale}/login`);

  const t = await getTranslations('setup');

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <SetupForm locale={locale} />
        <p className="mt-6 text-center text-xs text-[color:var(--text-muted)]">{t('footnote')}</p>
      </div>
    </main>
  );
}
