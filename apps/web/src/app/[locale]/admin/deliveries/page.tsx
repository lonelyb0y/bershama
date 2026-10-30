import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import {
  AddStopForm,
  DispatchForm,
  NewRunForm,
  NewVehicleForm,
} from '@/components/delivery/dispatcher-forms';
import { DeliveryMap } from '@/components/delivery/delivery-map';

type TripRow = Database['public']['Tables']['trips']['Row'];
type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
type FacilityRow = Database['public']['Tables']['facilities']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type StopRow = Database['public']['Tables']['delivery_stops']['Row'];
type ProofRow = Database['public']['Tables']['proofs_of_delivery']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { run: runParam } = await searchParams;

  const t = await getTranslations('deliveries');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const [trips, vehicles, facilities, drivers, stops, proofs] =
    await Promise.all([
      supabase
        .from('trips')
        .select('id, run_date, status, vehicle_id, driver_id, notes')
        .order('run_date', { ascending: false })
        .limit(30),
      supabase.from('vehicles').select('id, code, plate_number').eq('is_active', true),
      supabase.from('facilities').select('id, name_en, name_ar').eq('is_active', true),
      supabase.from('profiles').select('id, full_name').eq('role', 'DRIVER'),
      supabase
        .from('delivery_stops')
        .select('id, trip_id, sequence, status, facility_id, arrived_at, delivered_at, latitude, longitude'),
      supabase.from('proofs_of_delivery').select('id, stop_id, recipient_name, meaning, signed_at'),
    ]);

  const tripList = await asRows<TripRow>(trips);
  const vehicleList = await asRows<VehicleRow>(vehicles);
  const facilityList = await asRows<FacilityRow>(facilities);
  const driverList = await asRows<ProfileRow>(drivers);
  const stopList = await asRows<StopRow>(stops);
  const proofList = await asRows<ProofRow>(proofs);

  const dispatched = tripList.filter((t) => t.status === 'DISPATCHED').length;
  const active = tripList.filter((t) => t.status === 'IN_TRANSIT').length;

  const selectedRun = runParam ? tripList.find((t) => t.id === runParam) : null;
  const runStops = selectedRun
    ? stopList.filter((s) => s.trip_id === selectedRun.id).sort((a, b) => a.sequence - b.sequence)
    : [];

  const facilityName = new Map(
    facilityList.map((f) => [f.id, locale === 'ar' ? f.name_ar : f.name_en]),
  );
  const vehicleName = new Map(vehicleList.map((v) => [v.id, v.code]));
  const proofByStop = new Map(proofList.map((p) => [p.stop_id, p]));

  const canPlan = selectedRun ? selectedRun.status === 'PLANNED' : false;
  const canDispatch = canPlan && selectedRun
    ? selectedRun.vehicle_id !== null && runStops.length > 0
    : false;

  const mapStops = runStops.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    label: facilityName.get(s.facility_id) ?? s.facility_id.slice(0, 8),
    latitude: s.latitude,
    longitude: s.longitude,
    status: s.status,
    isNext: s.status === 'PENDING' && runStops[0]?.id === s.id,
    isApproximate: s.latitude === null || s.longitude === null,
  }));

  return (
    <div className="bg-[var(--surface)] text-[var(--text)]">
      <section className="flex-1 px-4 py-4 flex flex-col gap-4 max-w-[1720px] mx-auto w-full">
        {/* ── HEADLINE & ACTIONS BAR ── */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)]/20 pb-3">
          <div>
            <h1 className="pf-display text-[1.5rem] font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-[13px] text-sm text-[var(--text-muted)]">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <details className="rounded-xl border group" open={selectedRun === null}>
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold hover:bg-[var(--surface-2)]">
                {t('dispatcher.selectRun')}
              </summary>
              <div className="p-4 space-y-2 border-t bg-[var(--surface-2)]">
                {tripList.map((trip) => (
                  <Link
                    key={trip.id}
                    href={`/admin/deliveries?run=${trip.id}`}
                    className="block px-2 py-1 rounded hover:bg-[var(--surface-muted)] text-sm font-mono text-[var(--text)]"
                  >
                    {trip.run_date}
                  </Link>
                ))}
              </div>
            </details>
            <details className="rounded-xl border" open={selectedRun === null}>
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold hover:bg-[var(--surface-2)]">
                {t('dispatcher.newRun')}
              </summary>
              <div className="p-4 space-y-2 border-t bg-[var(--surface-2)]">
                <NewRunForm
                  vehicles={vehicleList.map((v) => ({ id: v.id, code: v.code }))}
                  messages={{ vehicle_code_required: t('messages.vehicle_code_required') }}
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
              </div>
            </details>
            {selectedRun && (
              <details className="rounded-xl border">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold hover:bg-[var(--surface-2)]">
                  {t('dispatcher.newVehicle')}
                </summary>
                <div className="p-4 space-y-2 border-t bg-[var(--surface-2)]">
                  <NewVehicleForm
                    vehicles={vehicleList.map((v) => ({ id: v.id, code: v.code }))}
                    messages={{ vehicle_code_required: t('messages.vehicle_code_required') }}
                    labels={{
                      title: t('dispatcher.newVehicle'),
                      code: t('dispatcher.vehicleCode'),
                      description: t('dispatcher.vehicleDescription'),
                      plate: t('dispatcher.plate'),
                      submit: t('dispatcher.addVehicle'),
                      added: t('dispatcher.vehicleAdded'),
                    }}
                  />
                </div>
              </details>
            )}
          </div>
        </section>

        {/* ── MAIN TWO-COLUMN DISPATCH GRID ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT PANEL: TODAY'S RUNS ── */}
          <section className="lg:col-span-7 bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl flex flex-col justify-between overflow-hidden">
            <div>
              <div className="px-4 py-3 border-b border-[var(--border)]/30 flex items-center justify-between bg-[var(--surface-2)]">
                <div className="flex items-center gap-2">
                  <span className="pf-display text-sm font-semibold tracking-tight">{t('panel.todaysRuns')}</span>
                  <span className="font-mono text-[10px] uppercase text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-full border border-[var(--primary)]/30">
                    {dispatched} {t('panel.dispatched')} / {active} {t('panel.active')}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  {selectedRun ? selectedRun.run_date : t('dispatcher.selectRun')}
                </span>
              </div>

              {/* Dense Runs Table ── */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="h-8 border-b border-[var(--border)]/30 bg-[var(--surface)]/50 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                      <th className="px-3 py-1">{t('col.run')}</th>
                      <th className="px-3 py-1">{t('col.vehicle')}</th>
                      <th className="px-3 py-1">{t('col.driver')}</th>
                      <th className="px-3 py-1 text-right">{t('col.stops')}</th>
                      <th className="px-3 py-1">{t('col.state')}</th>
                      <th className="px-3 py-1 text-right">{t('col.telemetry')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]/30 text-sm text-[13px]">
                    {tripList.slice(0, 3).map((trip) => {
                      const isActive = trip.status === 'IN_TRANSIT';
                      const isPlanned = trip.status === 'PLANNED';
                      const stateTone = isActive ? 'primary' : isPlanned ? 'warning' : 'neutral';
                      const stopCount = stopList.filter((s) => s.trip_id === trip.id).length;
                      const driverName = driverList.find((d) => d.id === trip.driver_id)?.full_name ?? '—';
                      return (
                        <tr
                          key={trip.id}
                          className={`h-9 hover:bg-[var(--surface-2)] transition-colors duration-100 group ${trip.id === selectedRun?.id ? 'bg-[var(--surface-2)]/30' : ''}`}
                        >
                          <td className="px-3 py-1 font-mono text-[11px] {trip.status === 'COMPLETED' ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            {trip.run_date}
                          </td>
                          <td className="px-3 py-1 font-mono text-[11px] {isActive ? 'text-[var(--primary)] font-medium' : 'text-[var(--text-muted)]'}">
                            {vehicleName.get(trip.vehicle_id ?? '') ?? '—'}
                          </td>
                          <td className="px-3 py-1 {trip.status === 'COMPLETED' ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            {driverName}
                          </td>
                          <td className="px-3 py-1 font-mono text-[11px] text-right {trip.status === 'COMPLETED' ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            {stopCount}
                          </td>
                          <td className="px-3 py-1">
                            <span
                              className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-mono ${
                                stateTone === 'primary'
                                  ? 'bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/40'
                                  : stateTone === 'warning'
                                  ? 'bg-[var(--color-stock-warning)]/10 text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30'
                                  : 'bg-[var(--color-stock-ok)]/10 text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30'
                              }`}
                            >
                              <span className="text-[9px]">{isActive ? '■' : isPlanned ? '●' : '◆'}</span>
                              {isActive ? t('state.inTransit') : isPlanned ? t('state.scheduled') : t('state.delivered')}
                            </span>
                          </td>
                          <td className="px-3 py-1 font-mono text-[11px] text-right {isActive ? 'text-[var(--primary)]' : isPlanned ? 'text-[var(--color-stock-warning)]' : 'text-[var(--text-muted)]'}">
                            {isActive ? t('telemetry.status.ok') : isPlanned ? t('telemetry.packing') : t('telemetry.archived')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectedRun && (
                <div className="px-4 py-2 border-t border-[var(--border)]/30 bg-[var(--surface)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                  <span>{runStops.length} stops</span>
                  <span className="text-[var(--text)]">{t('dispatcher.dispatch')} →</span>
                </div>
              )}
            </div>
          </section>

          {/* RIGHT PANEL: RUN DETAIL ── */}
          <section className="lg:col-span-5 bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl flex flex-col gap-4 overflow-hidden">
            {!selectedRun ? (
              <div className="flex-1 flex items-center justify-center px-8 text-[var(--text-muted)]">
                <p>{t('dispatcher.selectRun')}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="pf-display text-sm font-semibold tracking-tight">{t('dispatcher.detail')}</h2>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">{selectedRun.run_date}</span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]/30">
                    <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('runs')}</div>
                    <div className="font-mono text-sm">{selectedRun.run_date}</div>
                  </div>
                  <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]/30">
                    <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('dispatcher.vehicle')}</div>
                    <div className="font-mono text-sm">{vehicleName.get(selectedRun.vehicle_id ?? '') ?? '—'}</div>
                  </div>
                  <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]/30">
                    <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('dispatcher.driver')}</div>
                    <div className="font-mono text-sm">{selectedRun.driver_id ? driverList.find((d) => d.id === selectedRun.driver_id)?.full_name ?? '—' : '—'}</div>
                  </div>
                  <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]/30">
                    <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('status.stop.PENDING')}</div>
                    <div className={`font-mono text-sm ${selectedRun.status === 'IN_TRANSIT' ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`}>
                      {selectedRun.status}
                    </div>
                  </div>
                </div>

                {/* Stop list ── */}
                <div className="mb-6">
                  <h3 className="pf-display text-xs font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-3">
                    Stops
                  </h3>
                  {runStops.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">{t('dispatcher.noStops')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {runStops.map((stop) => {
                        const proof = proofByStop.get(stop.id);
                        return (
                          <li
                            key={stop.id}
                            className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]/30 flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-5 h-5 rounded-full bg-[var(--surface)] flex items-center justify-center text-[10px] font-mono font-bold text-[var(--primary)]">
                                {stop.sequence}
                              </span>
                              <div>
                                <div className="font-mono text-sm font-medium text-[var(--text)]">
                                  {facilityName.get(stop.facility_id) ?? stop.facility_id.slice(0, 8)}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">
                                  {stop.status === 'DELIVERED' ? t('status.stop.DELIVERED') : stop.status === 'ARRIVED' ? t('status.stop.ARRIVED') : t('status.stop.PENDING')}
                                </div>
                              </div>
                            </div>
                            {proof ? (
                              <span className="text-xs text-[var(--color-stock-ok)] font-medium">{t('dispatcher.proof')}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {canPlan && (
                  <div className="mb-6">
                    <h3 className="pf-display text-xs font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-3">
                      {t('dispatcher.addStop')}
                    </h3>
                    <AddStopForm
                      tripId={selectedRun.id}
                      canPlan={canPlan}
                      facilities={facilityList.map((f) => ({ id: f.id, label: facilityName.get(f.id) ?? f.name_en }))}
                      requisitions={[]}
                      messages={{ facility_unknown: t('messages.facility_unknown') }}
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
                  </div>
                )}

                {canDispatch && (
                  <div className="mb-6">
                    <h3 className="pf-display text-xs font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-3">
                      {t('dispatcher.dispatch')}
                    </h3>
                    <DispatchForm
                      tripId={selectedRun.id}
                      canDispatch={canDispatch}
                      vehicles={vehicleList.map((v) => ({ id: v.id, label: v.code }))}
                      drivers={driverList.map((d) => ({ id: d.id, label: d.full_name }))}
                      messages={{ role_cannot: t('messages.role_cannot') }}
                      labels={{
                        driver: t('dispatcher.driver'),
                        submit: t('dispatcher.dispatch'),
                        dispatched: t('dispatcher.dispatched'),
                        needsStops: t('dispatcher.needsStops'),
                        noVehicle: t('dispatcher.needsVehicle'),
                      }}
                    />
                  </div>
                )}

                {/* Map ── */}
                <div className="bg-[var(--surface-raised)] rounded-xl border border-[var(--border)] overflow-hidden">
                  <DeliveryMap
                    stops={mapStops}
                    caption={t('dispatcher.mapCaption')}
                    emptyLabel={t('dispatcher.mapEmpty')}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ── BELOW PANEL: PROOFS OF DELIVERY ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[var(--surface-2)]">
            <div>
              <h2 className="pf-display text-sm font-semibold tracking-tight">{t('panel.proofsTitle')}</h2>
              <p className="text-[13px] text-sm text-[var(--text-muted)]">{t('panel.proofsSubtitle')}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-8 border-b border-[var(--border)]/30 bg-[var(--surface)]/50 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="px-4 py-1 w-20">{t('col.stop')}</th>
                  <th className="px-4 py-1">{t('col.facility')}</th>
                  <th className="px-4 py-1">{t('col.delivered')}</th>
                  <th className="px-4 py-1 text-right">{t('col.proof')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/30 text-sm text-[13px]">
                {runStops.map((stop) => {
                  const proof = proofByStop.get(stop.id);
                  return (
                    <tr key={stop.id} className="h-9 hover:bg-[var(--surface-2)] transition-colors duration-100">
                      <td className="px-4 py-1 font-mono text-[11px] text-[var(--text)]">{stop.sequence}</td>
                      <td className="px-4 py-1 text-[var(--text)]">
                        {facilityName.get(stop.facility_id) ?? stop.facility_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-1 font-mono text-[11px] text-[var(--text-muted)]">
                        {stop.delivered_at ? new Date(stop.delivered_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-1 text-right">
                        {proof ? (
                          <span className="text-[var(--color-stock-ok)] font-medium">{t('dispatcher.proof')}</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">{t('dispatcher.unsigned')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {runStops.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      {t('dispatcher.noStops')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}
