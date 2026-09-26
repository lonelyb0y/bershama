import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSession } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

export default async function PharmacyDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('m0');
  const tNav = await getTranslations('nav');
  const session = await getSession();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {tNav('dashboard')}
        </h1>
        <p className="text-[color:var(--text-muted)] mt-1 text-sm">
          {session?.fullName}
        </p>
      </header>

      <section className="rounded-xl border p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {tNav('requisitions')}
        </h2>
        <p className="text-[color:var(--text-muted)] mt-3 text-sm">
          {t('comingSoon')}
        </p>
        <p className="text-[color:var(--text-muted)] mt-2 text-sm">
          Browsing the bilingual catalogue and submitting a requisition is the M2
          → M3 work. Prices will be in {session?.currencyCode}, stored as integer
          piastres and displayed with Latin digits.
        </p>
      </section>
    </div>
  );
}
