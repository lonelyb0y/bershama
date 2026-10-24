import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type TripRow = Database['public']['Tables']['trips']['Row'];
type StopRow = Database['public']['Tables']['delivery_stops']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function DriverPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('driver');
  const tNav = await getTranslations('nav');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.driver.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const { data: tripData } = await supabase
    .from('trips')
    .select('id, run_date, status, vehicle_id, driver_id, notes')
    .eq('driver_id', session.userId)
    .not('status', 'in', '(COMPLETED,CANCELLED)')
    .order('run_date', { ascending: true })
    .limit(1);

  const trip = (tripData ?? [])[0] as TripRow | undefined;

  const stops = trip
    ? (
        await supabase
          .from('delivery_stops')
          .select('id, sequence, status, facility_id, arrived_at, delivered_at')
          .eq('trip_id', trip.id)
          .order('sequence', { ascending: true })
      ).data ?? []
    : [];

  const stopList: StopRow[] = stops as StopRow[];

  const pendingStops = stopList.filter(
    (s) => s.status !== 'DELIVERED' && s.status !== 'FAILED'
  ).length;
  const completedStops = stopList.filter((s) => s.status === 'DELIVERED').length;

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)] flex flex-col">
      {/* ── TOP SHELL ── */}
      <header className="w-full bg-[var(--surface-raised)] border-b border-[var(--border)]/30 sticky top-0 z-50">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] ring-2 ring-[var(--primary)]/20" />
              <span className="pf-display text-sm font-semibold text-[var(--primary)] tracking-tight">
                Bershama Logistics
              </span>
            </Link>
            <div className="hidden lg:flex items-center h-5 w-[1px] bg-[var(--border)]/40" />
            <div className="hidden sm:flex items-center gap-2 bg-[var(--surface-2)] px-3 py-1 rounded-full border border-[var(--border)]/40">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
              <span className="font-mono text-[11px] text-[var(--text)]">
                Driver Run Console
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-4 h-full">
            <Link href="/driver" className="text-[var(--primary)] border-b-2 border-[var(--primary)] font-mono text-[11px] font-medium h-full flex items-center pt-0.5">
              {tNav('deliveries')}
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <button className="px-2 py-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text-muted)] hover:text-[var(--text)] font-cairo text-[11px] font-semibold border border-[var(--border)]/30 transition-colors" title={t('switchToArabic')}>
              <span className="w-3 h-3" />
              <span>العربية</span>
            </button>
            <div className="h-4 w-[1px] bg-[var(--border)]/40" />
            <div className="flex items-center gap-2 pl-1">
              <div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center text-[var(--primary)] font-mono text-[11px] font-semibold">
                {session.fullName?.slice(0, 2) || 'D'}
              </div>
              <div className="hidden xl:flex flex-col text-left leading-none">
                <span className="font-body-sm text-body-sm font-semibold text-[var(--text)]">{session.fullName}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)] font-normal">Driver · {trip?.vehicle_id ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex-1 flex flex-col gap-4">
        {/* ── HEADLINE & TELEMETRY ── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 pb-3 border-b border-[var(--border)]/30">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{t('runConsole.title')}</span>
                <span className="text-[var(--text-muted)]/50">/</span>
                <span className="font-cairo text-[11px] text-[var(--text-muted)] font-normal">{t('runConsole.arName')}</span>
              </div>
              <h1 className="pf-display text-[1.25rem] font-semibold tracking-[-0.02em] text-[var(--text)]">
                {t('runConsole.subtitle')}
              </h1>
            </div>
            <div className="flex items-center gap-3 bg-[var(--surface-2)] px-3 py-2 rounded-lg border border-[var(--border)]/30">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
                {t('runConsole.currentRun')}
              </span>
              <span className="text-[var(--text-muted)]/40 text-[10px]">|</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {trip?.id?.slice(0, 8) ?? '—'}
              </span>
            </div>
          </div>
        </section>

        {/* ── STOPS LIST ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-3 lg:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
              <h2 className="pf-display text-sm font-semibold tracking-wide text-[var(--text)]">
                {t('stops.title')}
              </h2>
              <span className="text-[11px] font-mono text-[var(--text-muted)] ml-2">
                {pendingStops} {t('stops.pending')} / {completedStops} {t('stops.completed')}
              </span>
            </div>
          </div>

          <div className="overflow-y-auto custom-scroll flex-1">
            <div className="space-y-2">
              {stopList.length === 0 ? (
                <div className="px-4 py-6 text-center text-[var(--text-muted)]">
                  <span className="w-8 h-8 text-[var(--text-muted)]/30" />
                  <p className="mt-3 text-[13px]">{t('stops.empty')}</p>
                </div>
              ) : (
                stopList.map((stop, i) => (
                  <div
                    key={stop.id}
                    className="bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-xl p-3 flex items-center justify-between hover:border-[var(--border)]/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-[var(--text)]">
                        {t('stops.stopNumber', { n: stop.sequence })}
                      </span>
                      <span className="text-[13px] text-[var(--text)]">{stop.facility_id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                          stop.status === 'DELIVERED'
                            ? 'text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30 bg-[var(--color-stock-ok)]/10'
                            : 'text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30 bg-[var(--color-stock-warning)]/10'
                        }`}
                      >
                        {stop.status === 'DELIVERED' ? t('status.done') : t('status.pending')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
