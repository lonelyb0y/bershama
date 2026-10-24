import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { formatMoney, formatQuantity, daysToExpiry } from '@/lib/format';
import { asRows } from '@/lib/mappers';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type BalanceRow = Database['public']['Tables']['stock_balances']['Row'];
type BatchRow = Database['public']['Tables']['batches']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type LocationRow = Database['public']['Tables']['storage_locations']['Row'];
type RequisitionRow = Database['public']['Tables']['requisitions']['Row'];

async function asRowsSafe<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

  // Six reads, in parallel.
  const [products, batches, balances, expiringBatches, requisitions, auditLog] =
    await Promise.all([
      supabase.from('products').select('id, name_en, name_ar, is_active').eq('is_active', true),
      supabase
        .from('batches')
        .select('id, lot_number, expiry_date, status, product_id, unit_cost_minor')
        .is('deleted_at', null),
      supabase.from('stock_balances').select('location_id, batch_id, qty_on_hand').gt('qty_on_hand', 0),
      supabase
        .from('batches')
        .select('id, lot_number, expiry_date, status, product_id')
        .is('deleted_at', null)
        .in('status', ['RELEASED', 'QUARANTINED'])
        .gte('expiry_date', todayIso)
        .lte('expiry_date', horizonIso),
      supabase.from('requisitions').select('id, requisition_number, status, created_at, facility_id').order('created_at', { ascending: false }).limit(10),
      supabase.from('audit_logs').select('action, entity_type, entity_id, created_at, user_id').order('created_at', { ascending: false }).limit(8),
    ]);

  const productList = await asRowsSafe<ProductRow>(products);
  const batchList = await asRowsSafe<BatchRow>(batches);
  const balanceList = await asRowsSafe<BalanceRow>(balances);
  const expiringList = await asRowsSafe<BatchRow>(expiringBatches);
  const requisitionList = await asRowsSafe<RequisitionRow>(requisitions);
  const auditList = await asRowsSafe<{ action: string; entity_type: string; entity_id: string; created_at: string; user_id: string }>(auditLog);

  const productName = new Map(
    productList.map((p) => [p.id, locale === 'ar' ? p.name_ar : p.name_en]),
  );

  // ── figures ──────────────────────────────────────────────────────────────
  const capitalMinor = balanceList.reduce((sum, b) => {
    const batch = batchList.find((x) => x.id === b.batch_id);
    return sum + b.qty_on_hand * (batch?.unit_cost_minor ?? 0);
  }, 0);

  const unitsOnHand = balanceList.reduce((sum, b) => sum + b.qty_on_hand, 0);
  const expiringCount = expiringList.length;
  const quarantinedCount = batchList.filter((b) => b.status === 'QUARANTINED').length;

  // ── expiry table: batches needing attention ──────────────────────────────
  const expiryTable = expiringList
    .map((batch) => {
      const product = productName.get(batch.product_id) ?? '—';
      const days = daysToExpiry(batch.expiry_date);
      const balance = balanceList.find((b) => b.batch_id === batch.id);
      const qty = balance?.qty_on_hand ?? 0;
      return {
        lot: batch.lot_number,
        product,
        genericName: '', // not available from batch read alone
        location: 'Ambient Aisle 1',
        qty,
        expiry: batch.expiry_date,
        days,
        status: batch.status,
      };
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  // ── waiting on you: pending requisitions ─────────────────────────────────
  const pendingReqs = requisitionList.filter((r) => r.status === 'PENDING' || r.status === 'DRAFT').slice(0, 3);

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── HEADER AREA ── */}
      <section className="mx-auto max-w-[1400px] px-6 py-8 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)]/20 pb-4">
          <div className="flex flex-col">
            <h1 className="pf-display text-[1.5rem] font-semibold tracking-tight">
              {t('goodEvening')}
            </h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-1 flex items-center gap-2 font-mono">
              {t('shiftInfo', { time: today.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })} · Node 04 Central Hub
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-[var(--border)]/40 bg-[var(--surface-2)] text-[var(--text-muted)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-muted)] animate-pulse" />
                {t('activeTelemetry')}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-9 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-[13px] font-medium hover:bg-[color:var(--primary)]/90 active:translate-y-[1px] transition-all flex items-center gap-2">
              <span className="w-4 h-4" /> {t('runExpiryScan')}
            </button>
          </div>
        </div>

        {/* ── ROW OF FOUR FIGURE PANELS ── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('panel.capital')}</span>
              <span className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <div className="my-2">
              <span className="font-mono text-[1.75rem] font-bold tracking-tight text-[var(--text)] block leading-none">{formatMoney(capitalMinor, { locale: 'en', compact: true })}</span>
            </div>
            <span className="text-[13px] font-body-md text-[var(--text-muted)]">{t('panel.capitalHint')}</span>
          </div>
          <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('panel.margin')}</span>
              <span className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <div className="my-2">
              <span className="font-mono text-[1.75rem] font-bold tracking-tight text-[var(--text-muted)] block leading-none">—</span>
            </div>
            <span className="text-[13px] font-body-md text-[var(--text-muted)]">{t('panel.marginHint')}</span>
          </div>
          <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('panel.expiring')}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30 bg-[var(--color-stock-warning)]/10">
                {t('panel.priority')}
              </span>
            </div>
            <div className="my-2">
              <span className={`font-mono text-[1.75rem] font-bold tracking-tight block leading-none ${expiringCount > 0 ? 'text-[var(--color-stock-warning)]' : 'text-[var(--text)]'}`}>
                {expiringCount}
              </span>
            </div>
            <span className="text-[13px] font-body-md text-[var(--text-muted)]">{t('panel.expiringHint')}</span>
          </div>
          <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('panel.units')}</span>
              <span className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <div className="my-2">
              <span className="font-mono text-[1.75rem] font-bold tracking-tight text-[var(--text)] block leading-none">{formatQuantity(unitsOnHand)}</span>
            </div>
            <span className="text-[13px] font-body-md text-[var(--text-muted)]">{t('panel.unitsHint', { quarantined: quarantinedCount })}</span>
          </div>
        </section>

        {/* ── MIDDLE SPLIT ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* WIDE EXPIRY PANEL ── */}
          <div className="lg:col-span-2 bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-6 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]/20">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
                <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('expiry.title')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-[var(--surface-2)] p-0.5 rounded-lg border border-[var(--border)]/30">
                  <button className="px-3 py-1 rounded-md bg-[var(--surface)] text-[var(--text)] text-[13px] font-mono font-medium">{t('window90')}</button>
                  <button className="px-3 py-1 text-[var(--text-muted)] hover:text-[var(--text)] text-[13px] font-mono transition-colors">{t('window180')}</button>
                </div>
                <button className="px-3 py-1 rounded-xl text-[13px] font-mono border border-[var(--border)]/40 text-[var(--text)] hover:bg-[var(--surface-2)] active:translate-y-[1px] transition-colors">
                  {t('runScan')}
                </button>
              </div>
            </div>

            {/* Table ── */}
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[620px]">
                <div className="bg-[var(--surface-2)] rounded-lg px-3 py-2 grid grid-cols-12 text-[11px] font-mono text-[var(--text-muted)] uppercase items-center">
                  <div className="col-span-3">{t('col.batch')}</div>
                  <div className="col-span-4">{t('col.product')}</div>
                  <div className="col-span-2">{t('col.location')}</div>
                  <div className="col-span-1 text-right">{t('col.qty')}</div>
                  <div className="col-span-1 text-right">{t('col.expiry')}</div>
                  <div className="col-span-1 text-right">{t('col.days')}</div>
                </div>
                <div className="divide-y divide-[var(--border)]/30 mt-1">
                  {expiryTable.map((row) => {
                    const isExpired = row.days < 0;
                    const isSoon = row.days >= 0 && row.days <= 30;
                    const tone = isExpired ? 'critical' : isSoon ? 'warning' : 'ok';
                    return (
                      <div
                        key={row.lot}
                        className="px-3 py-2 grid grid-cols-12 items-center hover:bg-[var(--surface-2)]/50 transition-colors text-[13px] font-body-sm"
                      >
                        <div className="col-span-3 font-mono text-[var(--primary)]">{row.lot}</div>
                        <div className="col-span-4 pr-2">
                          <p className="font-medium text-[var(--text)] leading-snug truncate">{row.product}</p>
                          <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-none">{row.genericName ?? ''}</p>
                        </div>
                        <div className="col-span-2 text-[var(--text-muted)] font-mono text-[12px]">{row.location}</div>
                        <div className="col-span-1 text-right tabular-nums text-[var(--text-muted)]">{row.qty}</div>
                        <div className="col-span-1 text-right tabular-nums text-[var(--text-muted)]">{row.expiry}</div>
                        <div className="col-span-1 flex justify-end">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono ${
                              tone === 'critical'
                                ? 'text-[var(--color-stock-critical)] border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/10'
                                : tone === 'warning'
                                ? 'text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/40 bg-[var(--color-stock-warning)]/10'
                                : 'text-[var(--text-muted)] border border-[var(--border)]/40 bg-[var(--surface-2)]'
                            }`}
                          >
                            <span
                              className="w-1 h-1 rounded-full"
                              style={{ backgroundColor: tone === 'critical' ? 'var(--color-stock-critical)' : tone === 'warning' ? 'var(--color-stock-warning)' : 'var(--text-muted)' }}
                            />
                            {tone === 'critical' ? t('status.expired') : tone === 'warning' ? `${row.days} ${t('days')}` : `${row.days} ${t('days')}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {expiryTable.length === 0 && (
                    <div className="px-3 py-6 text-center text-[var(--text-muted)]">
                      {t('expiry.empty')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Expiry Footer ── */}
            <div className="pt-4 mt-4 border-t border-[var(--border)]/20 flex items-center justify-between">
              <p className="text-[13px] font-mono text-[var(--text-muted)]">
                {t('expiry.footer', { count: expiryTable.length })}
              </p>
              <span className="text-[13px] font-mono text-[var(--text-muted)] flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                {t('expiry.liveSync')}
              </span>
            </div>
          </div>

          {/* NARROW RIGHT-HAND COLUMN ── */}
          <div className="flex flex-col gap-4">
            {/* Waiting on You ── */}
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]/20">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-ping" />
                    <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('waiting.title')}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--primary)] border border-[var(--primary)]/30 bg-[var(--primary)]/10">
                    {pendingReqs.length} {t('waiting.pending')}
                  </span>
                </div>
                <div className="mt-4 flex items-start justify-between">
                  <div>
                    {pendingReqs.length > 0 ? (
                      <>
                        <span className="font-mono text-[1rem] font-bold text-[var(--text)] block leading-tight">{pendingReqs[0].code ?? '—'}</span>
                        <span className="text-[13px] text-[var(--text-muted)] block mt-0.5">{t('waiting.facility', { name: 'CI Warehouse' })}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[1rem] font-bold text-[var(--text-muted)] block leading-tight">—</span>
                        <span className="text-[13px] text-[var(--text-muted)] block mt-0.5">{t('waiting.none')}</span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[13px] text-[var(--text-muted)]">{t('waiting.justNow')}</span>
                </div>
                <div className="mt-3 inline-flex items-center gap-2 px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)]/40 text-[13px] font-mono text-[var(--text-muted)]">
                  <span className="w-3 h-3 text-[var(--text-muted)]" />
                  {t('waiting.dispatchClearance')}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border)]/20">
                <Link
                  href="/admin/inventory/requisitions"
                  className="text-[var(--primary)] font-mono text-[13px] hover:underline inline-flex items-center gap-1"
                >
                  {t('waiting.openRequisitions')} <span>→</span>
                </Link>
              </div>
            </div>

            {/* Audit Log ── */}
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-6 flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]/20">
                <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('audit.title')}</span>
                <span className="text-[13px] font-mono text-[var(--text-muted)] flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                  {t('audit.live')}
                </span>
              </div>
              <div className="divide-y divide-[var(--border)]/30 mt-1">
                {auditList.map((entry) => (
                  <div key={entry.entity_id} className="py-2">
                    <p className="text-[13px] font-body-md text-[var(--text)] leading-tight">
                      {entry.action} · <span className="font-medium text-[var(--text-muted)]">{entry.entity_type}</span>
                    </p>
                    <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">{t('audit.by', { who: entry.user_id.slice(0, 8), when: new Date(entry.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</p>
                  </div>
                ))}
                {auditList.length === 0 && (
                  <div className="px-3 py-4 text-center text-[var(--text-muted)]">
                    {t('audit.empty')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── ACTIVE LOT REPOSITORY ── */}
        <section className="mt-6 flex flex-col">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              {t('lots.title')}
            </span>
            <span className="text-[13px] font-mono text-[var(--text-muted)] flex items-center gap-1 text-[11px]">
              {t('lots.horizontalDrag')} <span className="w-3 h-3 text-[var(--text-muted)]" />
            </span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-4 w-max">
              {batchList.slice(0, 6).map((batch) => {
                const product = productName.get(batch.product_id) ?? '—';
                const days = daysToExpiry(batch.expiry_date);
                const balance = balanceList.find((b) => b.batch_id === batch.id);
                const qty = balance?.qty_on_hand ?? 0;
                const isExpired = days < 0;
                const isSoon = days >= 0 && days <= 30;
                return (
                  <div
                    key={batch.id}
                    className="w-[280px] shrink-0 bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-4 flex flex-col justify-between hover:border-[var(--border)] transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-[var(--text-muted)]">SKU-{batch.lot_number.slice(-4)}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono ${
                            isExpired
                              ? 'text-[var(--color-stock-critical)] border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/10'
                              : isSoon
                              ? 'text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/40 bg-[var(--color-stock-warning)]/10'
                              : 'text-[var(--text-muted)] border border-[var(--border)]/40 bg-[var(--surface-2)]'
                          }`}
                        >
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: isExpired ? 'var(--color-stock-critical)' : isSoon ? 'var(--color-stock-warning)' : 'var(--text-muted)' }}
                          />
                          {isExpired ? t('lot.expired') : isSoon ? `${days} ${t('lot.days')}` : t('lot.inDate')}
                        </span>
                      </div>
                      <h3 className="font-medium text-[var(--text)] text-[14px] mt-2 leading-snug line-clamp-2">{product}</h3>
                      <p className="font-mono text-[11px] text-[var(--text-muted)] mt-1">{batch.lot_number}</p>
                    </div>
                    <div className="mt-4 pt-2 border-t border-[var(--border)]/20 flex items-center justify-between font-mono text-[13px]">
                      <span className="text-[var(--text-muted)]">{t('lot.stock')}</span>
                      <span className="text-[var(--text)] font-medium">{t('lot.available', { qty })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="mt-auto border-t border-[var(--border)]/30">
          <div className="mx-auto max-w-[1400px] px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {t('footer.license')}
              </span>
            </div>
            <nav className="flex flex-wrap items-center gap-4">
              <Link href="/admin/deliveries" className="text-[var(--primary)] font-mono text-[13px] hover:text-[var(--text)] transition-colors">
                {t('footer.coldChainTelemetry')}
              </Link>
              <Link href="/admin/alerts" className="text-[var(--text-muted)] font-mono text-[13px] hover:text-[var(--text)] transition-colors">
                {t('footer.nodeStatus')}
              </Link>
              <Link href="/admin/audit" className="text-[var(--text-muted)] font-mono text-[13px] hover:text-[var(--text)] transition-colors">
                {t('footer.auditLog')}
              </Link>
              <a href="#" className="text-[var(--text-muted)] font-mono text-[13px] hover:text-[var(--text)] transition-colors">
                {t('footer.systemDiagnostics')}
              </a>
              <a href="#" className="text-[var(--text-muted)] font-mono text-[13px] hover:text-[var(--text)] transition-colors">
                {t('footer.supportDispatch')}
              </a>
            </nav>
          </div>
        </footer>
      </section>
    </div>
  );
}
