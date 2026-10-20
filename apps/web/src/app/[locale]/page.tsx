import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { getSession, homeRouteForRole } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/routing';

/**
 * The landing page: what PharmaFlow is, for whom, and why it can be trusted with a
 * regulated product.
 *
 * This used to be a build-status page — milestone, technology stack, and a table of
 * seeded demo credentials. It was accurate as of M0 and stopped being useful the moment
 * the product worked. A visitor's first question is "what does this do", not "which
 * milestone shipped", and publishing a password in the page that greets them was never
 * something to keep.
 *
 * The stack notes are not lost, they are just not the pitch: RLS and the audit trail are
 * load-bearing claims for a pharmaceutical product, so the security section stays -- as
 * a property of the product rather than a list of libraries.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('landing');
  const session = await getSession();

  // A signed-in user has no business on the marketing page. Send them to the surface
  // their role belongs on.
  if (session) {
    redirect(`/${locale}${homeRouteForRole(session.role)}`);
  }

  // Signed in, but with nothing to sign in *to*.
  //
  // getSession() is null for someone with no profiles row -- not because the session
  // is absent, but because whoami has no row to return. That is the state every new
  // person is in for a moment: authenticated by Google, or by a confirmed email, with
  // no organisation yet. Without this check they land on the landing page, signed in
  // and unable to do anything, with no indication that /setup is the next step.
  //
  // /setup is the route built for exactly that state, and it is the only thing that
  // can end it.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(`/${locale}/setup`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-14 p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <span className="text-sm font-semibold tracking-tight">{t('brand')}</span>
        <LocaleSwitcher />
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('headline')}
        </h1>
        <p className="text-[color:var(--text-muted)] max-w-2xl text-base">
          {t('lede')}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href={`/${locale}/signup`}
            className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-700)]"
          >
            {t('createOrg')}
          </Link>
          <Link
            href={`/${locale}/login`}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--surface-2)]"
          >
            {t('signIn')}
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {t('capabilitiesHeading')}
        </h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ['traceability', 'traceabilityBody'],
              ['expiry', 'expiryBody'],
              ['coldChain', 'coldChainBody'],
              ['fefo', 'fefoBody'],
              ['delivery', 'deliveryBody'],
              ['valuation', 'valuationBody'],
            ] as const
          ).map(([titleKey, bodyKey]) => (
            <li key={titleKey} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
              <p className="text-[color:var(--text-muted)] text-sm">
                {t(bodyKey)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {t('rolesHeading')}
        </h2>
        <ul className="grid gap-5 sm:grid-cols-3">
          {(
            [
              ['adminRole', 'adminRoleBody'],
              ['pharmacyRole', 'pharmacyRoleBody'],
              ['driverRole', 'driverRoleBody'],
            ] as const
          ).map(([titleKey, bodyKey]) => (
            <li key={titleKey} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
              <p className="text-[color:var(--text-muted)] text-sm">
                {t(bodyKey)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border p-6">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {t('securityHeading')}
        </h2>
        <ul className="text-[color:var(--text-muted)] flex flex-col gap-2 text-sm">
          {(
            [
              'securityRls',
              'securityAudit',
              'securityAppendOnly',
              'securityMfa',
              'securityArabic',
            ] as const
          ).map((key) => (
            <li key={key} className="flex gap-2">
              <span
                aria-hidden="true"
                className="text-[color:var(--color-brand-500)]"
              >
                &middot;
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-[color:var(--text-muted)] mt-auto flex flex-col gap-1 text-xs">
        <span>{t('footerLicence')}</span>
        <span>{t('footerTraceability')}</span>
      </footer>
    </main>
  );
}