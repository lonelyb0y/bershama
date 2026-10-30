import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import { RunControls } from '@/components/delivery/run-controls';
import { DeliveryMap } from '@/components/delivery/delivery-map';
import { LivePositionReporter } from '@/components/delivery/live-position-reporter';
import { ServiceWorkerRegistration } from '@/components/delivery/service-worker-registration';
import { ArriveButton } from '@/components/delivery/stop-actions';
import { SignSheet } from '@/components/delivery/stop-actions';
import { FailStopForm } from '@/components/delivery/stop-actions';

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
  const tDel = await getTranslations('deliveries');
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
          .select('id, sequence, status, facility_id, arrived_at, delivered_at, latitude, longitude')
          .eq('trip_id', trip.id)
          .order('sequence', { ascending: true })
      ).data ?? []
    : [];

  const stopList: StopRow[] = stops as StopRow[];

  const pendingStops = stopList.filter(
    (s) => s.status !== 'DELIVERED' && s.status !== 'FAILED'
  ).length;
  const completedStops = stopList.filter((s) => s.status === 'DELIVERED').length;

  const mapStops = stopList.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    label: s.facility_id,
    latitude: s.latitude,
    longitude: s.longitude,
    status: s.status,
    isNext: s.status === 'PENDING' && stopList[0]?.id === s.id,
    isApproximate: s.latitude === null || s.longitude === null,
  }));

  return (
    <div className="bg-[var(--surface)] text-[var(--text)] flex flex-col">
      <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex-1 flex flex-col gap-4">
        {/* ── HEADLINE & TELEMETRY ── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 pb-3 border-b border-[var(--border)]/30">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{t('runConsole.title')}</span>
                <span className="text-[var(--text-muted)]/50">/</span>
                <span className="font-arabic text-[11px] text-[var(--text-muted)] font-normal">{t('runConsole.arName')}</span>
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
                    data-testid={`stop-${stop.sequence}`}
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
                    {stop.status === 'PENDING' && (
                      <div className="flex items-center gap-2 ml-4">
                        <ArriveButton
                          stopId={stop.id}
                          latitude={String(stop.latitude ?? '')}
                          longitude={String(stop.longitude ?? '')}
                          labels={{ arrive: tDel('driver.arrive'), queued: tDel('driver.queued') }}
                          messages={{}}
                        />
                        <SignSheet
                          stopId={stop.id}
                          latitude={String(stop.latitude ?? '')}
                          longitude={String(stop.longitude ?? '')}
                          labels={{
                            recipient: tDel('driver.recipient'),
                            recipientPlaceholder: tDel('driver.recipientPlaceholder'),
                            meaning: tDel('driver.meaning'),
                            sign: tDel('driver.sign'),
                            queued: tDel('driver.queued'),
                            clear: tDel('driver.clear'),
                            signHere: tDel('driver.signHere'),
                            unsignedInstead: tDel('driver.unsignedInstead'),
                            unsignedReason: tDel('driver.unsignedReason'),
                            unsignedReasonPlaceholder: tDel('driver.unsignedReasonPlaceholder'),
                            signed: tDel('driver.signed'),
                          }}
                          messages={{}}
                          meanings={tDel('driver.meanings') as unknown as Record<string, string>}
                        />
                        <FailStopForm
                          stopId={stop.id}
                          labels={{
                            fail: tDel('driver.cannotDeliver'),
                            reason: tDel('driver.reason'),
                            reasonPlaceholder: tDel('driver.reasonPlaceholder'),
                            queued: tDel('driver.queued'),
                          }}
                          messages={{}}
                          reasons={tDel('driver.failReasons') as unknown as Record<string, string>}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* ── RUN CONTROLS ── */}
        {trip && (
          <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-3 lg:p-4">
            <RunControls
              tripId={trip.id}
              tripStatus={trip.status}
              openStops={pendingStops}
              labels={{
                start: tDel('driver.start'),
                close: tDel('driver.closeRun'),
              }}
              messages={{}}
            />
          </section>
        )}

        {/* ── MAP ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-3 lg:p-4">
          <DeliveryMap
            stops={mapStops}
            caption={tDel('driver.mapCaption')}
            emptyLabel={tDel('driver.mapEmpty')}
          />
        </section>

        {trip && <LivePositionReporter tripId={trip.id} enabled={true} />}
        <ServiceWorkerRegistration />
      </section>
    </div>
  );
}
