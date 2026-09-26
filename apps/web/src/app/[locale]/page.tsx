import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { getSession, homeRouteForRole } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('m0');
  const session = await getSession();

  // A signed-in user has no business on the marketing/status page. Send them to
  // the surface their role belongs on.
  if (session) {
    redirect(`/${locale}${homeRouteForRole(session.role)}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-10 p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-[color:var(--text-muted)] mt-1">{t('subtitle')}</p>
        </div>
        <LocaleSwitcher />
      </header>

      <section className="rounded-xl border p-6">
        <h2 className="text-lg font-medium">{t('milestone')}</h2>
        <p className="text-[color:var(--text-muted)] mt-2 text-sm">
          {t('signInToVerify')}
        </p>
        <a
          href={`/${locale}/login`}
          className="mt-4 inline-flex rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-700)]"
        >
          {t('signInToVerify')}
        </a>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase">
            {t('tech')}
          </h3>
          <ul className="text-[color:var(--text-muted)] mt-3 space-y-1.5 text-sm">
            {[
              'Supabase Postgres — Auth, RLS, Storage, Realtime, pg_cron',
              'Next.js 16 · React 19 · TypeScript',
              'English + Arabic, full RTL from the first commit',
              'PWA: installable, works offline',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-[color:var(--color-brand-500)]">
                  &middot;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase">
            {t('security')}
          </h3>
          <ul className="text-[color:var(--text-muted)] mt-3 space-y-1.5 text-sm">
            {[
              'Row Level Security on every table, enforced by the database',
              'Privilege grants revoked, then re-granted per operation',
              'Append-only audit trail, immutable by trigger',
              'Invite-only: no public signup endpoint',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-[color:var(--color-brand-500)]">
                  &middot;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border p-6">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {t('demoAccounts')}
        </h2>
        <p className="text-[color:var(--text-muted)] mt-2 text-sm">
          Local development only. Created by <code>supabase/seed.sql</code>, never
          by a migration, so they cannot reach a hosted project.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[color:var(--text-muted)] border-b text-start">
                <th className="p-2 text-start font-medium">Email</th>
                <th className="p-2 text-start font-medium">Role</th>
                <th className="p-2 text-start font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['admin@demo.local', 'TENANT_ADMIN'],
                ['pharmacy@demo.local', 'PHARMACY_MANAGER'],
                ['driver@demo.local', 'DISTRIBUTOR'],
              ].map(([email, role]) => (
                <tr key={email} className="border-b last:border-0">
                  <td className="p-2 font-mono" dir="ltr">
                    {email}
                  </td>
                  <td className="p-2">
                    <code>{role}</code>
                  </td>
                  <td className="p-2 font-mono" dir="ltr">
                    PharmaFlow#2026
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-[color:var(--text-muted)] mt-auto text-xs">
        AGPL-3.0 · Egypt · WHO GDP-aligned batch traceability
      </footer>
    </main>
  );
}
