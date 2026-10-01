import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { StopMap, type MapStop } from '@/components/delivery/stop-map';
import { ArriveButton, FailStopForm, SignSheet } from '@/components/delivery/stop-actions';
import { RunControls } from '@/components/delivery/run-controls';
import { ServiceWorkerRegistration } from '@/components/delivery/service-worker-registration';
import type { Locale } from '@/i18n/routing';

/**
 * The driver surface: the run in your hand.
 *
 * ── one screen, in the order the work happens ───────────────────────────────
 *
 * A driver opening this has one job and a sequence of stops. So the screen is the
 * run: start it, work the stops in order, close it. No tabs, no detail route, no
 * back button to lose a place in the queue -- the stops that still need doing are
 * at the top and everything already dealt with is below, because that is the order
 * the day runs in and the order somebody glances at it.
 *
 * ── why a driver sees one run and not a list of runs ────────────────────────
 *
 * The query is filtered to `driver_id = me` and status not in (COMPLETED,
 * CANCELLED). A driver who can see yesterday's runs on the same screen as today's
 * will tap the wrong one, and the wrong one has no business being one tap away.
 * History is on the run detail a dispatcher can see, not on the phone.
 */
export default async function DriverPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('deliveries');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.driver.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const { data: tripData } = await supabase
    .from('trips')
    .select('id, vehicle_id, run_date, status, started_at, ended_at, notes')
    .eq('driver_id', session.userId)
    .not('status', 'in', '(COMPLETED,CANCELLED)')
    .order('run_date', { ascending: true })
    .limit(1);

  const trip = (tripData ?? [])[0] as
    | {
        id: string;
        vehicle_id: string | null;
        run_date: string;
        status: string;
        started_at: string | null;
        ended_at: string | null;
        notes: string | null;
      }
    | undefined;

  const stops = trip
    ? ((
        await supabase
          .from('delivery_stops')
          .select(
          'id, sequence, status, facility_id, arrived_at, delivered_at, closed_at, failure_reason, latitude, longitude',
        )
          .eq('trip_id', trip.id)
          .order('sequence', { ascending: true })
      ).data ?? []) as Array<{
        id: string;
        sequence: number;
        status: string;
        facility_id: string;
        arrived_at: string | null;
        delivered_at: string | null;
        closed_at: string | null;
        failure_reason: string | null;
        latitude: number | null;
        longitude: number | null;
      }>
    : [];

  // Facility names in one read for the whole run, rather than per stop.
  const facilityIds = [...new Set(stops.map((s) => s.facility_id))];
  const { data: facilityData } = await supabase
    .from('facilities')
    .select('id, name_en, name_ar, code')
    .in('id', facilityIds.length > 0 ? facilityIds : ['00000000-0000-0000-0000-000000000000']);

  const facilityName = new Map(
    ((facilityData ?? []) as Array<{ id: string; name_en: string; name_ar: string | null; code: string }>).map(
      (f) => [f.id, locale === 'ar' ? (f.name_ar ?? f.name_en) : f.name_en],
    ),
  );

  const { data: vehicleData } = trip?.vehicle_id
    ? await supabase.from('vehicles').select('code, plate_number').eq('id', trip.vehicle_id).maybeSingle()
    : { data: null };

  const vehicle = vehicleData as { code: string; plate_number: string | null } | null;

  // The next stop to work: the first one still open. Everything above it is closed,
  // so the top card is always the one that needs a decision.
  const nextStopId = stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED')?.id ?? null;

  const openStops = stops.filter((s) => s.status === 'PENDING' || s.status === 'ARRIVED');

  const mapStops: MapStop[] = stops.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    label: facilityName.get(s.facility_id) ?? s.facility_id,
    // Only a stop somebody actually reached has a position; the rest are unknown,
    // and the map says so rather than plotting them at zero, zero off the coast of
    // Ghana.
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    status: s.status as MapStop['status'],
    isNext: s.id === nextStopId,
  }));

  return (
    <div className="space-y-4">
      <ServiceWorkerRegistration />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('driver.title')}</h1>
        {trip && (
          <p className="text-sm text-current/60">
            {trip.run_date}
            {vehicle ? ` · ${vehicle.code}` : ''}
          </p>
        )}
      </header>

      {!trip && <p className="rounded-lg border border-dashed p-4 text-sm">{t('driver.noRun')}</p>}

      {trip && (
        <>
          <p className="text-sm">
            <span className="font-medium">{t(`status.trip.${trip.status}`)}</span>
            {trip.started_at ? ` · ${new Date(trip.started_at).toLocaleString(locale)}` : ''}
          </p>

          <RunControls
            tripId={trip.id}
            tripStatus={trip.status}
            openStops={openStops.length}
            messages={t.raw('messages')}
            labels={{
              start: t('driver.start'),
              close: t('driver.closeRun'),
            }}
          />

          <StopMap stops={mapStops} caption={t('driver.mapCaption')} emptyLabel={t('driver.mapEmpty')} />

          {stops.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-sm">{t('driver.noStops')}</p>
          )}

          <ul className="space-y-3">
            {stops.map((stop) => {
              const name = facilityName.get(stop.facility_id) ?? stop.facility_id;
              const isNext = stop.id === nextStopId;

              return (
                <li
                  key={stop.id}
                  data-testid={`stop-${stop.sequence}`}
                  className={`space-y-3 rounded-xl border p-4 ${isNext ? 'border-sky-500/60' : ''}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-medium">
                      {stop.sequence}. {name}
                    </h2>
                    <span className="text-xs text-current/60">{t(`status.stop.${stop.status}`)}</span>
                  </div>

                  {stop.failure_reason && (
                    <p className="text-sm text-red-600">{t('driver.failedReason')}: {stop.failure_reason}</p>
                  )}

                  {/* The working controls are rendered for the next stop only. A
                      driver with nine stops should not be offered nine signature
                      pads: the one that matters is the one in front of them. */}
                  {isNext && stop.status === 'PENDING' && (
                    <ArriveButton
                      stopId={stop.id}
                      latitude=""
                      longitude=""
                      labels={{ arrive: t('driver.arrive'), queued: t('driver.queued') }}
                      messages={t.raw('messages')}
                    />
                  )}

                  {isNext && stop.status === 'ARRIVED' && (
                    <SignSheet
                      stopId={stop.id}
                      latitude=""
                      longitude=""
                      labels={{
                        recipient: t('driver.recipient'),
                        recipientPlaceholder: t('driver.recipientPlaceholder'),
                        meaning: t('driver.meaning'),
                        sign: t('driver.sign'),
                        queued: t('driver.queued'),
                        clear: t('driver.clear'),
                        signHere: t('driver.signHere'),
                        unsignedInstead: t('driver.unsignedInstead'),
                        unsignedReason: t('driver.unsignedReason'),
                        unsignedReasonPlaceholder: t('driver.unsignedReasonPlaceholder'),
                        signed: t('driver.signed'),
                      }}
                      messages={t.raw('messages')}
                      meanings={t.raw('driver.meanings')}
                    />
                  )}

                  {isNext && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-red-600">{t('driver.cannotDeliver')}</summary>
                      <div className="mt-2">
                        <FailStopForm
                          stopId={stop.id}
                          labels={{
                            fail: t('driver.fail'),
                            reason: t('driver.reason'),
                            reasonPlaceholder: t('driver.reasonPlaceholder'),
                            queued: t('driver.queued'),
                          }}
                          messages={t.raw('messages')}
                          reasons={t.raw('driver.failReasons')}
                        />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>

          {trip.status === 'COMPLETED' && (
            <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              {t('driver.runDone')}
            </p>
          )}

          {openStops.length === 0 && trip.status === 'IN_TRANSIT' && (
            <p className="rounded-lg border p-3 text-sm">{t('driver.allStopsDone')}</p>
          )}
        </>
      )}
    </div>
  );
}