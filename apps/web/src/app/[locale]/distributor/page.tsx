import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { StatTile } from '@/components/ui/stat-tile';
import { Badge } from '@/components/ui/badge';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { formatMoney, formatQuantity, daysToExpiry } from '@/lib/format';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type BalanceRow = Database['public']['Tables']['stock_balances']['Row'];
type BatchRow = Database['public']['Tables']['batches']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type TripRow = Database['public']['Tables']['trips']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function DistributorDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.distributor.includes(session.role)) notFound();

  const supabase = await getSupabase();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

  const [products, batches, expiringSoon, balances, trips] =
    await Promise.all([
      supabase.from('products').select('id, name_en, name_ar').eq('is_active', true),
      supabase.from('batches').select('id, lot_number, expiry_date, status, product_id, unit_cost_minor').is('deleted_at', null),
      supabase
        .from('batches')
        .select('id, lot_number, expiry_date, status, product_id')
        .is('deleted_at', null)
        .in('status', ['RELEASED', 'QUARANTINED'])
        .gte('expiry_date', todayIso)
        .lte('expiry_date', horizonIso),
      supabase.from('stock_balances').select('location_id, batch_id, qty_on_hand').gt('qty_on_hand', 0),
      supabase
        .from('trips')
        .select('id, run_date, status, vehicle_id, driver_id, notes')
        .order('run_date', { ascending: false })
        .limit(30),
    ]);

  const productList = await asRows<ProductRow>(products);
  const batchList = await asRows<BatchRow>(batches);
  const expiringList = await asRows<BatchRow>(expiringSoon);
  const balanceList = await asRows<BalanceRow>(balances);
  const tripList = await asRows<TripRow>(trips);

  const productName = new Map(
    productList.map((p) => [p.id, locale === 'ar' ? p.name_ar : p.name_en]),
  );

  const capitalMinor = balanceList.reduce((sum, b) => {
    const batch = batchList.find((x) => x.id === b.batch_id);
    return sum + b.qty_on_hand * (batch?.unit_cost_minor ?? 0);
  }, 0);

  const lotsInStock = new Set(balanceList.map((b) => b.batch_id)).size;
  const expiringCount = expiringList.length;
  const tripsToday = tripList.filter((t) => t.run_date === todayIso).length;

  const runs = tripList.map((trip) => ({
    id: trip.id,
    runDate: trip.run_date,
    status: trip.status,
    vehicleId: trip.vehicle_id ?? '—',
    driverId: trip.driver_id ?? '—',
    notes: trip.notes,
  }));

  const expiringTable = expiringList
    .map((batch) => {
      const product = productName.get(batch.product_id) ?? '—';
      const days = daysToExpiry(batch.expiry_date);
      const balance = balanceList.find((b) => b.batch_id === batch.id);
      const qty = balance?.qty_on_hand ?? 0;
      return {
        lot: batch.lot_number,
        product,
        expiry: batch.expiry_date,
        days,
        qty,
        status: batch.status,
      };
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  return (
    <div className="bg-[var(--surface)] text-[var(--text)] flex flex-col">
      <section className="flex-1 w-full max-w-[1720px] mx-auto px-6 py-8 flex flex-col gap-8">
        <section className="flex flex-col space-y-1 pb-2">
          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2">
            <div>
              <h1 className="pf-display text-[1.5rem] font-semibold tracking-tight">
                {session.tenantSlug ?? 'Misr Delta Pharmaceutical Distribution S.A.E.'}
              </h1>
              <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
                Cairo Central Hub · Night Shift · GS1-128 EDA Real-time Ledger
              </p>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
                <span>BROKER SOCKET: ACTIVE</span>
              </span>
              <span className="px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                SYS SYNC: LIVE
              </span>
            </div>
          </div>
          <div className="w-full h-[1px] bg-[var(--border)]/30 mt-3" />
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Capital in Stock"
            value={formatMoney(capitalMinor, { locale: 'en', compact: true })}
            hint="Ledger valuation at acquisition cost"
          />
          <StatTile
            label="Lots in Stock"
            value={formatQuantity(lotsInStock)}
            hint="Across active storage locations"
          />
          <StatTile
            label="Expiring in 90 Days"
            value={expiringCount.toString()}
            hint={expiringCount > 0 ? 'lots flagged for attention' : 'nothing due within the window'}
            tone={expiringCount > 0 ? 'warn' : 'good'}
          />
          <StatTile
            label="Deliveries Today"
            value={tripsToday.toString()}
            hint="Active runs dispatched today"
          />
        </section>

        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-6 flex flex-col space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border)]/50 pb-3">
            <div className="flex items-center gap-3">
              <h2 className="pf-display text-sm font-bold tracking-tight">Today</h2>
              <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]/30 text-[var(--text-muted)]">
                {runs.filter((r) => r.status === 'DISPATCHED').length} Dispatched /
                {runs.filter((r) => r.status === 'IN_TRANSIT').length} Active
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span className="text-[var(--primary)]" />
              <span>Depot schedule alignment: 100%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {runs.slice(0, 3).map((run) => {
              const isActive = run.status === 'IN_TRANSIT';
              const isPlanned = run.status === 'PLANNED';
              const tone = isActive ? 'good' : isPlanned ? 'neutral' : 'warn';
              return (
                <div
                  key={run.id}
                  className={`bg-[var(--surface-2)] border border-[var(--border)]/40 rounded-lg p-4 flex flex-col justify-between space-y-4 hover:border-[var(--border)] transition-colors`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <span className="text-[13px] text-[var(--text)] font-bold">{run.runDate}</span>
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--text-muted)]">
                        <span className={`font-bold ${isActive ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`}>
                          {run.vehicleId}
                        </span>
                        <span>·</span>
                        <span>{run.driverId}</span>
                      </div>
                    </div>
                    <Badge tone={tone}>
                      {run.status === 'IN_TRANSIT' ? 'IN TRANSIT' : run.status === 'PLANNED' ? 'PLANNED' : 'DISPATCHED'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-2 border-t border-[var(--border)]/20">
                    <span className="text-[var(--text-muted)]">Stops planned</span>
                    <div className="flex items-center gap-1 font-mono text-[var(--text)]">
                      <span className={isActive ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}>
                        0 of 6
                      </span>
                      <span className="text-[var(--text-muted)] text-[10px] font-normal">(staging)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-8 bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-6 flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="pf-display text-sm font-bold tracking-tight">Expiring Soon</h3>
                <span className="text-[11px] text-[var(--text-muted)]">Real-time batch ledger</span>
              </div>
              <span className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                View Complete Ledger →
              </span>
            </div>
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface)]/50">
                    <th className="px-3 py-2 text-left text-[var(--text-muted)] uppercase tracking-wider">Batch</th>
                    <th className="px-3 py-2 text-left text-[var(--text-muted)] uppercase tracking-wider">Product &amp; Formulation</th>
                    <th className="px-3 py-2 text-left text-[var(--text-muted)] uppercase tracking-wider">Location</th>
                    <th className="px-3 py-2 text-right text-[var(--text-muted)] uppercase tracking-wider">On Hand</th>
                    <th className="px-3 py-2 text-right text-[var(--text-muted)] uppercase tracking-wider">Expiry</th>
                    <th className="px-3 py-2 text-right text-[var(--text-muted)] uppercase tracking-wider">Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/30">
                  {expiringTable.map((row) => (
                    <tr
                      key={row.lot}
                      className="border-b border-[var(--border)]/30 last:border-0 hover:bg-[var(--surface-2)]/50 transition-colors"
                    >
                      <td className="px-3 py-3 whitespace-nowrap text-[var(--text)] font-mono font-bold">
                        {row.lot}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-[var(--text)]">
                        {row.product}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-[var(--text-muted)]">
                        -
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-end tabular-nums text-[var(--text-muted)]">
                        {row.qty} pk
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-end tabular-nums text-[var(--text-muted)]">
                        {row.expiry}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-end">
                        <Badge
                          tone={row.days < 0 ? 'bad' : row.days <= 30 ? 'warn' : 'good'}
                          shape={row.days < 0 ? 'triangle' : row.days <= 30 ? 'circle' : 'diamond'}
                        >
                          {row.days < 0 ? 'Expired' : `${row.days} days`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {expiringTable.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-[var(--text-muted)]">
                        Nothing expiring within the window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-4 bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-6 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)]/50 pb-2">
              <div className="flex items-center gap-1">
                <span className="w-4 h-4 text-[var(--primary)]" />
                <h3 className="pf-display text-sm font-bold tracking-tight">Recent Activity</h3>
              </div>
              <span className="text-[10px] text-[var(--primary)] font-medium">LIVE STREAM</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="p-3 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)]/20 flex flex-col space-y-1">
                <p className="text-[12px] text-[var(--text)] leading-tight">
                  Manifest <span className="font-mono text-[var(--primary)] font-bold">REQ-0001</span> dispatched to Fleet Van-1
                </p>
                <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0">Just now</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--color-stock-critical)]/30 flex flex-col space-y-1">
                <p className="text-[12px] text-[var(--text)] leading-tight">
                  Cold-chain telemetry breach alert acknowledged on Van-1{' '}
                  <span className="text-[var(--color-stock-critical)] font-mono font-bold text-[10px]">(+9.4°C excursion logged)</span>
                </p>
                <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0">2 min ago</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)]/20 flex flex-col space-y-1">
                <p className="text-[12px] text-[var(--text)] leading-tight">
                  Batch <span className="font-mono text-[var(--primary)] font-bold">LOT-2026-B1180</span> released from quarantine
                </p>
                <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0">45 min ago</span>
              </div>
            </div>
            <div className="pt-2 text-right">
              <span className="text-[11px] text-[var(--text-muted)]">
                Export Cryptographic Log →
              </span>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
