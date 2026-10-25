import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type TripRow = Database['public']['Tables']['trips']['Row'];
type VehicleRow = Database['public']['Tables']['vehicles']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function DeliveriesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('deliveries');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const [trips, vehicles] = await Promise.all([
    supabase
      .from('trips')
      .select('id, run_date, status, vehicle_id, driver_id, notes')
      .order('run_date', { ascending: false })
      .limit(30),
    supabase.from('vehicles').select('id, code, plate_number').eq('is_active', true),
  ]);

  const tripList = await asRows<TripRow>(trips);
  const vehicleList = await asRows<VehicleRow>(vehicles);

  const dispatched = tripList.filter((t) => t.status === 'DISPATCHED').length;
  const active = tripList.filter((t) => t.status === 'IN_TRANSIT').length;

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── TOP NAVIGATION BAR ── */}
      <header className="bg-[var(--surface-raised)] border-b border-[var(--border)]/30 flex items-center justify-between px-4 py-2 w-full sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
            <span className="pf-display text-sm font-semibold text-[var(--primary)] tracking-tight">
              Bershama Pharma Logistics
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-4 text-[13px] font-body-md">
            <Link
              href="/admin/deliveries"
              className="text-[var(--primary)] border-b-2 border-[var(--primary)] pb-1 font-semibold flex items-center gap-2"
            >
              {t('nav.runsFleet')}
            </Link>
            <Link
              href="/admin/inventory/requisitions"
              className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] px-2 py-0.5 rounded transition-colors duration-150"
            >
              {t('nav.requisitions')}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden lg:flex items-center">
            <span
              aria-hidden="true"
              className="absolute left-3 text-[var(--text-muted)]"
            >
              <span className="w-4 h-4" />
            </span>
            <input
              type="search"
              placeholder={t('searchOrders')}
              className="h-8 pl-8 pr-10 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)]/50 rounded-lg text-[13px] focus:border-[var(--primary)] focus:ring-0 focus:outline-none w-52 placeholder-[var(--text-muted)]/60"
            />
            <kbd className="absolute right-2 font-mono text-[9px] bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text-muted)] border border-[var(--border)]/30 rounded">
              ⌘K
            </kbd>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]/30 text-[11px] font-mono text-[var(--text-muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
            <span className="text-[var(--text)]">Node 04 Cairo Central</span>
          </div>
          <button className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]/30 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text)] active:scale-[0.98]">
            العربية
          </button>
          <div className="flex items-center gap-1 text-[var(--text-muted)]">
            <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]" title={t('coldChain')}>
              <span className="w-4 h-4" />
            </button>
            <button className="relative w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]" title={t('notifications')}>
              <span className="w-4 h-4" />
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
            </button>
            <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]" title={t('help')}>
              <span className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-[var(--border)]/30">
            <div className="w-7 h-7 rounded-full bg-[var(--surface-2)] border border-[var(--border)]/50 flex items-center justify-center font-mono text-[11px] text-[var(--primary)] font-semibold overflow-hidden">
              AH
            </div>
            <div className="hidden xl:flex flex-col text-left">
              <span className="text-[13px] font-semibold text-[var(--text)] leading-tight">{session.fullName}</span>
              <span className="text-[11px] font-mono text-[var(--text-muted)] leading-none">Lead Dispatcher</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 flex flex-col gap-4 max-w-[1720px] mx-auto w-full">
        {/* ── HEADLINE & ACTIONS BAR ── */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)]/20 pb-3">
          <div>
            <h1 className="pf-display text-[1.5rem] font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-[13px] font-body-md text-[var(--text-muted)]">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link
              href="/admin/inventory/requisitions"
              className="h-9 px-3 bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)]/50 rounded-[10px] text-[13px] font-semibold hover:bg-[var(--surface-muted)] hover:border-[var(--border)] active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <span className="w-3 h-3" /> {t('action.newRequisition')}
            </Link>
            <Link
              href="/admin/deliveries?new=true"
              className="h-9 px-4 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-[10px] text-[13px] font-semibold hover:bg-[color:var(--primary)]/90 active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <span className="w-4 h-4" /> {t('action.newRun')}
            </Link>
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
                <span className="font-mono text-[11px] text-[var(--text-muted)]">OCT 21, 2026</span>
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
                  <tbody className="divide-y divide-[var(--border)]/30 font-body-md text-[13px]">
                    {tripList.slice(0, 3).map((trip) => {
                      const isActive = trip.status === 'IN_TRANSIT';
                      const isPlanned = trip.status === 'PLANNED';
                      const isCompleted = trip.status === 'COMPLETED';
                      const stateTone = isActive ? 'primary' : isPlanned ? 'warning' : 'neutral';
                      return (
                        <tr
                          key={trip.id}
                          className="h-9 hover:bg-[var(--surface-2)] transition-colors duration-100 group"
                        >
                          <td className="px-3 py-1 font-mono text-[11px] {isCompleted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            {trip.run_date}
                          </td>
                          <td className="px-3 py-1 font-mono text-[11px] {isActive ? 'text-[var(--primary)] font-medium' : 'text-[var(--text-muted)]'}">
                            {trip.vehicle_id ?? '—'}
                          </td>
                          <td className="px-3 py-1 {isCompleted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            {trip.driver_id ?? '—'}
                          </td>
                          <td className="px-3 py-1 font-mono text-[11px] text-right {isCompleted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}">
                            6
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
                            {isActive ? t('telemetry.temp', { temp: 2.8 }) : isPlanned ? t('telemetry.packing') : t('telemetry.archived')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom Telemetry Sub-bar ── */}
              <div className="px-4 py-2 border-t border-[var(--border)]/30 bg-[var(--surface)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-ping" />
                  <span className="text-[var(--text)] font-medium">VAN-1 GPS:</span>
                  <span>Ring Road Sector 4 • <span className="text-[var(--text)]">48 km/h</span> • EDA Protocol #8491</span>
                </div>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">LOC: 30.0444°N, 31.2357°E</span>
              </div>
            </div>
          </section>

          {/* RIGHT PANEL: ORDERS IN FLIGHT ── */}
          <section className="lg:col-span-5 bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl flex flex-col justify-between overflow-hidden">
            <div>
              <div className="px-4 py-3 border-b border-[var(--border)]/30 flex items-center justify-between bg-[var(--surface-2)]">
                <div className="flex items-center gap-2">
                  <span className="pf-display text-sm font-semibold tracking-tight">{t('panel.ordersInFlight')}</span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full border border-[var(--border)]/30">
                    2 active
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">{t('panel.dispatchQueue')}</span>
              </div>

              <div className="p-4 flex flex-col gap-3">
                {tripList.slice(0, 3).map((trip) => {
                  const isPending = trip.status === 'DISPATCHED';
                  const isAllocated = trip.status === 'PLANNED';
                  const isStaged = trip.status === 'COMPLETED';
                  const tone = isPending ? 'warning' : isAllocated ? 'neutral' : 'secondary';
                  return (
                    <div
                      key={trip.id}
                      className="p-3 bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-xl hover:border-[var(--border)] transition-colors flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-mono text-[13px] font-semibold text-[var(--text)]">{trip.id.slice(0, 8)}</div>
                          <div className="text-[13px] text-[var(--text-muted)]">{trip.driver_id ?? 'CI Warehouse'}</div>
                        </div>
                        <span className="font-mono text-[11px] text-[var(--text-muted)]">41 seconds ago</span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]/20">
                        <span
                          className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-mono ${
                            tone === 'warning'
                              ? 'bg-[var(--color-stock-warning)]/10 text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30'
                              : tone === 'neutral'
                              ? 'bg-[var(--color-stock-ok)]/10 text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30'
                              : 'bg-[var(--color-stock-warning)]/10 text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30'
                          }`}
                        >
                          <span className="text-[9px]">{isPending ? '●' : isAllocated ? '◆' : '■'}</span>
                          {isPending ? t('status.waiting') : isAllocated ? t('status.allocated') : t('status.staged')}
                        </span>
                        <Link
                          href={`#req-${trip.id}`}
                          className="text-[var(--primary)] font-mono text-[11px] hover:underline flex items-center gap-0.5"
                        >
                          {t('action.inspect')} <span className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-4 py-2 border-t border-[var(--border)]/30 bg-[var(--surface)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
              <span>{t('footer.priorityMatrix')}</span>
              <span className="text-[var(--text)]">{t('footer.zone')}</span>
            </div>
          </section>
        </div>

        {/* ── BELOW PANEL: PROOFS OF DELIVERY ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[var(--surface-2)]">
            <div>
              <h2 className="pf-display text-sm font-semibold tracking-tight">{t('panel.proofsTitle')}</h2>
              <p className="text-[13px] font-body-md text-[var(--text-muted)]">{t('panel.proofsSubtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="font-mono text-[11px] text-[var(--primary)] uppercase tracking-wider">{t('footer.auditSync')}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-8 border-b border-[var(--border)]/30 bg-[var(--surface)]/50 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="px-4 py-1 w-20">{t('col.stop')}</th>
                  <th className="px-4 py-1">{t('col.facility')}</th>
                  <th className="px-4 py-1">{t('col.delivered')}</th>
                  <th className="px-4 py-1 text-right">{t('col.lines')}</th>
                  <th className="px-4 py-1 text-right">{t('col.proof')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/30 font-body-md text-[13px]">
                <tr className="h-9 hover:bg-[var(--surface-2)] transition-colors duration-100">
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text)]">4</td>
                  <td className="px-4 py-1 text-[var(--text)]">Orchard Branch Pharmacy</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text-muted)]">11:42</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-right text-[var(--text)]">6</td>
                  <td className="px-4 py-1 text-right">
                    <Link href="#proof-stop-4" className="text-[var(--primary)] font-mono text-[11px] hover:underline">
                      {t('action.signature')}
                    </Link>
                  </td>
                </tr>
                <tr className="h-9 hover:bg-[var(--surface-2)] transition-colors duration-100">
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text)]">3</td>
                  <td className="px-4 py-1 text-[var(--text)]">Al-Amal Clinical Center, Dokki</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text-muted)]">10:18</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-right text-[var(--text)]">14</td>
                  <td className="px-4 py-1 text-right">
                    <Link href="#proof-stop-3" className="text-[var(--primary)] font-mono text-[11px] hover:underline">
                      {t('action.signature')}
                    </Link>
                  </td>
                </tr>
                <tr className="h-9 hover:bg-[var(--surface-2)] transition-colors duration-100">
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text)]">2</td>
                  <td className="px-4 py-1 text-[var(--text)]">Misr Central Pharmacy, Zamalek</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-[var(--text-muted)]">09:35</td>
                  <td className="px-4 py-1 font-mono text-[11px] text-right text-[var(--text)]">8</td>
                  <td className="px-4 py-1 text-right">
                    <Link href="#proof-stop-2" className="text-[var(--primary)] font-mono text-[11px] hover:underline">
                      {t('action.signature')}
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 border-t border-[var(--border)]/30 bg-[var(--surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] font-mono text-[var(--text-muted)]">
            <span>{t('footer.signedFor')}</span>
            <span className="font-mono text-[var(--text-muted)] tracking-wider">{t('footer.edaHash')}:</span>
            <span className="text-[var(--text)]">7e2f-90a1-c884</span>
          </div>
        </section>

        {/* ── AT THE FOOT: TELEMETRY STRIP ── */}
        <section className="w-full bg-[var(--surface-raised)] border border-[var(--border)]/30 rounded-2xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--border)]/30 overflow-hidden">
          <div className="p-4 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">VAN-1</span>
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-mono bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                <span className="text-[9px]">■</span>
                <span>{t('telemetry.status.ok')}</span>
              </span>
            </div>
            <div className="my-1">
              <div className="font-mono text-[1.5rem] font-semibold text-[var(--primary)] tracking-tight">2.8 °C</div>
              <div className="text-[13px] text-[var(--text-muted)]">cabinet temperature</div>
            </div>
            <div className="font-mono text-[10px] text-[var(--text-muted)]">Target spec: +2.0 °C to +8.0 °C</div>
          </div>
          <div className="p-4 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">LAST READING</span>
              <span className="font-mono text-[11px] text-[var(--color-stock-warning)]">GATEWAY L4</span>
            </div>
            <div className="my-1">
              <div className="font-mono text-[1.5rem] font-semibold text-[var(--text)] tracking-tight">11:42</div>
              <div className="text-[13px] text-[var(--text-muted)]">from the van gateway</div>
            </div>
            <div className="font-mono text-[10px] text-[var(--text-muted)]">Sync latency: 43ms • Sensor #T-99</div>
          </div>
          <div className="p-4 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">ROUTE</span>
              <span className="font-mono text-[10px] text-[var(--text-muted)] uppercase tracking-wider">CAIRO WEST ZONE</span>
            </div>
            <div className="my-1">
              <div className="font-mono text-[1.5rem] font-semibold text-[var(--text)] tracking-tight">Ring Road</div>
              <div className="text-[13px] text-[var(--text-muted)]">Sector 4 → Giza Depot</div>
            </div>
            <div className="font-mono text-[10px] text-[var(--text-muted)]">ETA: 14:20 • 12 km remaining</div>
          </div>
        </section>
      </main>
    </div>
  );
}
