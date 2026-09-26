import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSession } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

export default async function DistributorDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('m0');
  const tNav = await getTranslations('nav');
  const tDelivery = await getTranslations('delivery');
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

      {/*
        The offline banner is a real component from M4 onwards, wired to a
        network listener and the Dexie outbox. Rendering it now, even in a static
        state, fixes the copy and the wording in both languages while it is still
        cheap to change.
      */}
      <section className="rounded-xl border p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {tNav('routes')}
        </h2>
        <p className="text-[color:var(--text-muted)] mt-3 text-sm">
          {tDelivery('offline')}
        </p>
        <p className="text-[color:var(--text-muted)] mt-2 text-sm">
          {t('comingSoon')}
        </p>
      </section>
    </div>
  );
}
