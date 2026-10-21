import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { SimpleTable, Td } from '@/components/ui/simple-table';
import { Badge } from '@/components/ui/badge';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import {
  AddStopForm,
  DispatchForm,
  NewRunForm,
  NewVehicleForm,
} from '@/components/delivery/dispatcher-forms';
import { cache } from 'react';

import { DeliveryMap } from '@/components/delivery/delivery-map';
import type { MapStop } from '@/components/delivery/stop-map';

/** One clock reading per request. See the note at its use below. */
const getRequestNow = cache(() => Date.now());
import type { Locale } from '@/i18n/routing';

/**
 * Dispatch: plan the day's runs, load them, send them out.
 *
 * ── one screen, list beside detail ──────────────────────────────────────────
 *
 * A dispatcher is answering one question -- what is going out today, and is it
 * ready -- and switching between a list route and a detail route makes them answer
 * it in two places. So the list is on the left and the selected run in detail on
 * the right, which is also what makes "compare this run with that one" a glance
 * rather than a navigation.
 *
 * The detail panel is empty until a run is selected, and says so. A blank panel is
 * indistinguishable from a broken one.
 *
 * ── who may be here ─────────────────────────────────────────────────────────
 *
 * Planning and dispatching are warehouse-side jobs. The surface check is the
 * server's, not the navigation's: hiding a link is a courtesy, and the guard is the
 * control.
 */
export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('deliveries');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();
  const { run: selectedRun } = await searchParams;

  const { data: tripData } = await supabase
    .from('trips')
    .select('id, run_date, status, vehicle_id, driver_id, notes, started_at, ended_at')
    .order('run_date', { ascending: false })
    .limit(30);

  // The whole reason this screen exists. Without it a dispatcher has a list of stops and
  // no way to answer "is it stuck or nearly there", because a stop's coordinates are only
  // written once the van has already reached it.
  const { data: positionData } = await supabase
    .from('live_positions')
    .select('trip_id, latitude, longitude, recorded_at');

  const trips = (tripData ?? []) as Array<{
    id: string;
    run_date: string;
    status: string;
    vehicle_id: string | null;
    driver_id: string | null;
    notes: string | null;
    started_at: string | null;
    ended_at: string | null;
  }>;

  const [{ data: vehicleData }, { data: facilityData }, { data: driverData }, { data: reqData }] =
    await Promise.all([
      supabase.from('vehicles').select('id, code, plate_number, is_active').eq('is_active', true),
      supabase.from('facilities').select('id, name_en, name_ar, code, kind').eq('is_active', true),
      // Only DRIVER and DISPATCHER can be sent out: a warehouse manager on a run is
      // not a driver, and 0036 refuses the dispatch. Sending only the roles the
      // database accepts means the picker cannot offer a choice that fails.
      supabase.from('profiles').select('id, full_name, full_name_ar, role').in('role', ['DRIVER', 'DISPATCHER']),
      // Allocated demand is what a stop is for, so the requisition picker lists
      // exactly the requests waiting to be delivered, labelled with their facility.
      supabase
        .from('requisitions')
        .select('id, code, facility_id')
        .eq('status', 'ALLOCATED')
        .order('requested_at', { ascending: true })
        .limit(50),
    ]);

  const vehicles = ((vehicleData ?? []) as Array<{ id: string; code: string; plate_number: string | null }>).map(
    (v) => ({ id: v.id, code: v.code, label: v.plate_number ? `${v.code} · ${v.plate_number}` : v.code }),
  );

  const facilities = ((facilityData ?? []) as Array<{ id: string; name_en: string; name_ar: string | null; kind: string }>)
    .filter((f) => f.kind !== 'WAREHOUSE')
    .map((f) => ({ id: f.id, label: locale === 'ar' ? (f.name_ar ?? f.name_en) : f.name_en }));

  const drivers = ((driverData ?? []) as Array<{ id: string; full_name: string; full_name_ar: string | null }>).map(
    (d) => ({ id: d.id, label: locale === 'ar' ? (d.full_name_ar ?? d.full_name) : d.full_name }),
  );

  // The van and the driver, by id. The list needs them: a dispatcher comparing runs
  // is comparing which van and who is driving it, and neither was on the screen.
  const vehicleLabel = new Map(vehicles.map((v) => [v.id, v.label]));
  const driverLabel = new Map(drivers.map((d) => [d.id, d.label]));

  const facilityLabel = new Map(
    ((facilityData ?? []) as Array<{ id: string; name_en: string; name_ar: string | null }>).map((f) => [
      f.id,
      locale === 'ar' ? (f.name_ar ?? f.name_en) : f.name_en,
    ]),
  );

  const requisitions = ((reqData ?? []) as Array<{ id: string; code: string; facility_id: string }>).map((r) => ({
    id: r.id,
    facilityId: r.facility_id,
    label: `${r.code} · ${facilityLabel.get(r.facility_id) ?? ''}`,
  }));

  const selected = trips.find((trip) => trip.id === selectedRun) ?? null;

  const stops = selected
    ? ((
        await supabase
          .from('delivery_stops')
          .select('id, sequence, status, facility_id, latitude, longitude, failure_reason')
          .eq('trip_id', selected.id)
          .order('sequence', { ascending: true })
      ).data ?? []) as Array<{
        id: string;
        sequence: number;
        status: string;
        facility_id: string;
        latitude: number | null;
        longitude: number | null;
        failure_reason: string | null;
      }>
    : [];

  const proofs = selected
    ? ((
        await supabase
          .from('proofs_of_delivery')
          .select('stop_id, recipient_name, meaning, signed_at, unsigned_reason')
          .in(
            'stop_id',
            stops.length > 0 ? stops.map((s) => s.id) : ['00000000-0000-0000-0000-000000000000'],
          )
      ).data ?? [])
    : [];

  const proofByStop = new Map(
    (proofs as Array<{ stop_id: string; recipient_name: string; meaning: string; signed_at: string; unsigned_reason: string | null }>).map(
      (p) => [p.stop_id, p],
    ),
  );

  // Only a run actually in transit gets a live marker. A position left over from a run that
  // closed an hour ago would sit on the map looking current, which is precisely the lie the
  // age-faded marker exists to avoid.
  const liveRow = (positionData ?? []).find((row) => row.trip_id === selected?.id);
  const live =
    liveRow && selected?.status === 'IN_TRANSIT'
      ? {
          latitude: Number(liveRow.latitude),
          longitude: Number(liveRow.longitude),
          // `cache` rather than a bare Date.now(): the linter is right that this is impure
          // in render, and it is also right that it would be evaluated again on every
          // render pass. Once per request is both correct and what a poller would want.
          ageSeconds: Math.max(
            0,
            (getRequestNow() - new Date(liveRow.recorded_at).getTime()) / 1000,
          ),
        }
      : null;

  const mapStops: MapStop[] = stops.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    label: facilityLabel.get(s.facility_id) ?? s.facility_id,
    latitude: s.latitude,
    longitude: s.longitude,
    status: s.status as MapStop['status'],
    isNext: s.status === 'PENDING',
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('dispatcher.title')}</h1>
        <p className="text-sm text-current/60">{t('dispatcher.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="space-y-3" aria-label={t('dispatcher.runs')}>
          {/*
            A table, and three columns it did not have.

            The list showed a date, a status and a note. A dispatcher comparing runs is
            comparing *which van*, *which driver* and *how far it has got* -- and none
            of those were on the screen. So a person who wanted to know whether VAN-1
            was out and who was driving it had to open each run in turn.

            The run date is still the thing that is written on the paperwork, so it
            stays first, and the note stays because it is what the dispatcher typed.
          */}
          {trips.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm">
              {t('dispatcher.noRuns')}
            </p>
          ) : (
            <SimpleTable
              caption={t('dispatcher.runs')}
              headers={[
                { label: t('dispatcher.runDate') },
                { label: t('dispatcher.vehicle') },
                { label: t('dispatcher.driver') },
                { label: t('dispatcher.status') },
              ]}
            >
              {trips.map((trip) => (
                <tr
                  key={trip.id}
                  className={`border-b last:border-0 ${
                    selected?.id === trip.id ? 'bg-[var(--color-brand-600)]/5' : ''
                  }`}
                >
                  <Td>
                    <a
                      href={`/${locale}/admin/deliveries?run=${trip.id}`}
                      data-testid={`run-${trip.run_date}`}
                      aria-current={selected?.id === trip.id ? 'true' : undefined}
                      className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {trip.run_date}
                    </a>
                    {trip.notes ? (
                      <span className="block text-xs text-[color:var(--text-muted)]">
                        {trip.notes}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{vehicleLabel.get(trip.vehicle_id ?? '') ?? '—'}</Td>
                  <Td>{driverLabel.get(trip.driver_id ?? '') ?? '—'}</Td>
                  <Td>
                    <Badge
                      tone={
                        trip.status === 'COMPLETED'
                          ? 'good'
                          : trip.status === 'IN_TRANSIT'
                            ? 'warn'
                            : trip.status === 'CANCELLED'
                              ? 'bad'
                              : 'neutral'
                      }
                      shape={
                        trip.status === 'COMPLETED'
                          ? 'diamond'
                          : trip.status === 'IN_TRANSIT'
                            ? 'circle'
                            : trip.status === 'CANCELLED'
                              ? 'triangle'
                              : 'square'
                      }
                    >
                      {t(`status.trip.${trip.status}`)}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </SimpleTable>
          )}

          <NewRunForm
            vehicles={vehicles}
            messages={t.raw('messages')}
            labels={{
              title: t('dispatcher.newRun'),
              date: t('dispatcher.runDate'),
              vehicle: t('dispatcher.vehicle'),
              anyVehicle: t('dispatcher.anyVehicle'),
              notes: t('dispatcher.notes'),
              submit: t('dispatcher.createRun'),
              created: t('dispatcher.runCreated'),
            }}
          />

          <NewVehicleForm
            vehicles={vehicles}
            messages={t.raw('messages')}
            labels={{
              title: t('dispatcher.newVehicle'),
              code: t('dispatcher.vehicleCode'),
              description: t('dispatcher.vehicleDescription'),
              plate: t('dispatcher.plate'),
              submit: t('dispatcher.addVehicle'),
              added: t('dispatcher.vehicleAdded'),
            }}
          />
        </section>

        <section className="space-y-4" aria-label={t('dispatcher.detail')}>
          {!selected && <p className="rounded-lg border border-dashed p-4 text-sm">{t('dispatcher.selectRun')}</p>}

          {selected && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  {selected.run_date} · {t(`status.trip.${selected.status}`)}
                </h2>
                <span className="text-xs text-current/60">
                  {vehicles.find((v) => v.id === selected.vehicle_id)?.label ?? t('dispatcher.noVehicleYet')}
                </span>
              </div>

              <ol className="space-y-2" data-testid="stop-list">
                {stops.length === 0 && <li className="rounded-lg border border-dashed p-3 text-sm">{t('dispatcher.noStops')}</li>}
                {stops.map((stop) => {
                  const proof = proofByStop.get(stop.id);
                  return (
                    <li key={stop.id} className="rounded-lg border p-3 text-sm">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {stop.sequence}. {facilityLabel.get(stop.facility_id) ?? stop.facility_id}
                        </span>
                        <span className="text-xs text-current/60">{t(`status.stop.${stop.status}`)}</span>
                      </span>
                      {stop.failure_reason && (
                        <span className="block text-xs text-red-600">{stop.failure_reason}</span>
                      )}
                      {proof && (
                        <span className="block text-xs text-current/60">
                          {t('dispatcher.proof')}: {proof.recipient_name} — {proof.meaning}
                          {proof.unsigned_reason ? ` (${t('dispatcher.unsigned')})` : ''}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>

              <DeliveryMap stops={mapStops} live={live} caption={t('dispatcher.mapCaption')} emptyLabel={t('dispatcher.mapEmpty')} />

              {selected.status === 'PLANNED' ? (
                <AddStopForm
                  tripId={selected.id}
                  canPlan
                  facilities={facilities}
                  requisitions={requisitions}
                  messages={t.raw('messages')}
                  labels={{
                    title: t('dispatcher.addStop'),
                    facility: t('dispatcher.facility'),
                    requisition: t('dispatcher.requisition'),
                    noRequisition: t('dispatcher.noRequisition'),
                    submit: t('dispatcher.addStopSubmit'),
                    added: t('dispatcher.stopAdded'),
                    notPlanned: t('dispatcher.notPlanned'),
                  }}
                />
              ) : (
                <p className="text-xs text-current/60">{t('dispatcher.stopsLocked')}</p>
              )}

              <DispatchForm
                tripId={selected.id}
                canDispatch={selected.status === 'PLANNED' && stops.length > 0 && selected.vehicle_id !== null}
                vehicles={vehicles}
                drivers={drivers}
                messages={t.raw('messages')}
                labels={{
                  driver: t('dispatcher.driver'),
                  submit: t('dispatcher.dispatch'),
                  dispatched: t('dispatcher.dispatched'),
                  needsStops: t('dispatcher.needsStops'),
                  noVehicle: t('dispatcher.needsVehicle'),
                }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}