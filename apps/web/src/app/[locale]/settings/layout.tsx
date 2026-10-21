import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { AuthenticatedShell } from '@/components/authenticated-shell';
import { getSession } from '@/lib/session';
import { surfaceForRole } from '@/lib/roles';
import { isLocale, type Locale } from '@/i18n/routing';

/**
 * The account settings route.
 *
 * ── why it has its own layout rather than living under a surface ────────────
 *
 * Every surface has its own layout -- /admin, /pharmacy, /driver -- and each of
 * those guards its roles. Settings are reachable by every role, so it cannot
 * live under any one of them: a driver would have no way to reach their own
 * name and language.
 *
 * So the guard is here, and it picks the shell from the session's role. The
 * check is the same one the surface layouts make -- a session, and a role that
 * the chosen surface permits -- so there is one place where "may this person
 * be here" is decided.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;

  if (!isLocale(rawLocale)) {
    redirect('/en/login');
  }
  const locale: Locale = rawLocale;
  setRequestLocale(locale);

  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const surface = surfaceForRole(session.role);

  if (!surface) {
    // A role with no surface has nowhere to be. Sending it to the login page
    // is the honest answer: the person is signed in, but this account has no
    // place in the product yet.
    redirect(`/${locale}/login`);
  }

  return (
    <AuthenticatedShell params={params} surface={surface}>
      {children}
    </AuthenticatedShell>
  );
}
