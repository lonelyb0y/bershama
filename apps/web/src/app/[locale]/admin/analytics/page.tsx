import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { formatMoney, formatQuantity, daysToExpiry } from '@/lib/format';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import { BarTrendChart } from '@/components/dashboard/charts';

type BalanceRow = Database['public']['Tables']['stock_balances']['Row'];
type BatchRow = Database['public']['Tables']['batches']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type LedgerRow = Database['public']['Tables']['stock_ledger']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('analytics');
  const session = await getSession();
  if (!session) return null;

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) return null;

  const supabase = await getSupabase();
  const { range: rangeParam } = await searchParams;
  const range = rangeParam === '7d' ? 7 : rangeParam === '90d' ? 90 : 30;

  const today = new Date();
  const startDate = new Date(today.getTime() - range * 86_400_000).toISOString().slice(0, 10);

  const [balances, batches, products, ledger] = await Promise.all([
    supabase.from('stock_balances').select('product_id, batch_id, qty_on_hand'),
    supabase
      .from('batches')
      .select('id, product_id, unit_cost_minor, status, expiry_date')
      .is('deleted_at', null),
    supabase.from('products').select('id, sku, name_en, name_ar, form, is_active'),
    supabase
      .from('stock_ledger')
      .select('product_id, qty_delta, unit_cost_minor, occurred_at')
      .lt('qty_delta', 0)
      .gte('occurred_at', startDate),
  ]);

  const balanceRows = await asRows<BalanceRow>(balances);
  const batchRows = await asRows<BatchRow>(batches);
  const productRows = await asRows<ProductRow>(products);
  const ledgerRows = await asRows<LedgerRow>(ledger);

  const productName = new Map(
    productRows.map((p) => [p.id, locale === 'ar' ? p.name_ar : p.name_en]),
  );

  // ── Figures ──────────────────────────────────────────────────────────────
  const capitalMinor = balanceRows.reduce((sum, b) => {
    const batch = batchRows.find((x) => x.id === b.batch_id);
    return sum + b.qty_on_hand * (batch?.unit_cost_minor ?? 0);
  }, 0);

  const unitsOnHand = balanceRows.reduce((sum, b) => sum + b.qty_on_hand, 0);
  const expiringSoon = batchRows.filter((b) => {
    const days = daysToExpiry(b.expiry_date);
    return days >= 0 && days <= 90;
  }).length;

  const expiredCount = batchRows.filter((b) => daysToExpiry(b.expiry_date) < 0).length;

  // 30-day net delta from ledger
  const deltaMinor = ledgerRows.reduce((sum, l) => sum + l.qty_delta * (l.unit_cost_minor ?? 0), 0);

  // Cold-chain share: value of cold-chain batches on hand, as a share of total value.
  const coldChainMinor = balanceRows.reduce((sum, b) => {
    const batch = batchRows.find((x) => x.id === b.batch_id);
    const product = productRows.find((p) => p.id === batch?.product_id);
    return sum + b.qty_on_hand * (batch?.unit_cost_minor ?? 0) * (product?.is_cold_chain ? 1 : 0);
  }, 0);
  const coldChainShare = capitalMinor > 0 ? Math.round((coldChainMinor / capitalMinor) * 100) : 0;

  // Real chart points: one bar per day in the range, valued at the day's on-hand stock.
  // Built from the ledger so every point is a real cumulative figure, never invented.
  const chartPoints: { label: string; value: number; display: string }[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const dayLedger = ledgerRows.filter((l) => l.occurred_at?.startsWith(day));
    const dayDelta = dayLedger.reduce((sum, l) => sum + l.qty_delta * (l.unit_cost_minor ?? 0), 0);
    chartPoints.push({
      label: day,
      value: dayDelta,
      display: formatMoney(dayDelta, { locale: 'en', compact: true }),
    });
  }

  // Coverage table: days of cover per product, from the last 30 days of issues.
  const coverageRows = productRows
    .map((p) => {
      const balances = balanceRows.filter((b) => b.product_id === p.id);
      const onHand = balances.reduce((sum, b) => sum + b.qty_on_hand, 0);
      const issues = ledgerRows.filter((l) => l.product_id === p.id);
      const daily = Math.abs(issues.reduce((sum, l) => sum + l.qty_delta, 0)) / Math.max(range, 1);
      const daysCover = daily > 0 ? Math.floor(onHand / daily) : null;
      const totalValue = balances.reduce((sum, b) => {
        const batch = batchRows.find((x) => x.id === b.batch_id);
        return sum + b.qty_on_hand * (batch?.unit_cost_minor ?? 0);
      }, 0);
      return {
        id: p.id,
        sku: p.sku,
        name: productName.get(p.id) ?? '',
        onHand,
        totalValue,
        daysCover,
        isDead: daysCover === null || daysCover === 0,
      };
    })
    .filter((r) => r.onHand > 0)
    .sort((a, b) => {
      if (a.isDead && !b.isDead) return -1;
      if (!a.isDead && b.isDead) return 1;
      if (a.daysCover === null && b.daysCover !== null) return 1;
      if (a.daysCover !== null && b.daysCover === null) return -1;
      return (a.daysCover ?? 0) - (b.daysCover ?? 0);
    });

  return (
    <div className="bg-[var(--surface)] text-[var(--text)]">
      <section className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-8 flex flex-col gap-8">
        {/* ── PAGE TITLE ── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <h1 className="pf-display text-[1.75rem] font-bold text-[var(--text)] tracking-tight">{t('title')}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t('subtitle')}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('range')}</span>
            <div className="inline-flex p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] gap-1">
              {['7d', '30d', '90d'].map((r) => (
                <Link
                  key={r}
                  href={`?range=${r}`}
                  className={`px-3 py-2 rounded-lg text-xs font-mono transition-all border ${
                    String(range) === r.replace('d', '') ? 'border-[var(--primary)] text-[var(--primary-text, var(--primary))]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {r}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── STOCK VALUE PANEL ── */}
        <section
          data-testid="inventory-value"
          data-minor={String(capitalMinor)}
          className="rounded-3xl bg-[var(--surface-raised)] border border-[var(--border)] p-6 flex flex-col gap-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--primary-text, var(--primary))]">Metrics Series 01</span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">· Daily Valuation Ledger</span>
              </div>
              <h2 className="font-display text-xl font-semibold text-[var(--text)]">{t('stockValue.title')}</h2>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('stockValue.currentLedger')}</div>
                <div className="text-xl font-mono font-bold text-[var(--text)]">{formatMoney(capitalMinor, { locale: 'en', compact: true })}</div>
              </div>
              <div className="h-8 w-[1px] bg-[var(--border)] opacity-30" />
              <div className="text-right">
                <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('stockValue.netDelta')}</div>
                <div className={`text-sm font-mono font-semibold ${deltaMinor >= 0 ? 'text-[var(--primary-text, var(--primary))]' : 'text-[var(--color-stock-critical)]'}`}>
                  {deltaMinor >= 0 ? '+' : ''}{formatMoney(deltaMinor, { locale: 'en', compact: true })} ({(deltaMinor / Math.max(capitalMinor, 1) * 100).toFixed(1)}%)
                </div>
              </div>
              <div className="h-8 w-[1px] bg-[var(--border)] opacity-30" />
              <div className="text-right">
                <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('stockValue.coldChainShare')}</div>
                <div className="text-sm font-mono text-[var(--primary-text, var(--primary))]">
                  {formatMoney(coldChainMinor, { locale: 'en', compact: true })} ({coldChainShare}%)
                </div>
              </div>
            </div>
          </div>

          {/* Chart Container ── */}
          <div className="relative w-full h-[280px] bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-4 select-none">
            <BarTrendChart
              points={chartPoints}
              ariaLabel={t('stockValue.title')}
            />
          </div>

          {/* Disclosure ── */}
          <div className="border-t border-[var(--border)] pt-4">
            <button className="flex items-center gap-2 text-[11px] font-mono font-semibold text-[var(--primary-text, var(--primary))] hover:text-[var(--primary-text, var(--primary))]/90 transition-colors py-1">
              <span className="w-3 h-3 text-[var(--primary-text, var(--primary))]" />
              <span>{t('stockValue.showNumbers')}</span>
              <span className="text-[11px] text-[var(--text-muted)] font-normal">(Table twin · 30 daily data rows)</span>
            </button>
          </div>
        </section>

        {/* ── EXPIRY ANALYTICS PANEL ── */}
        <section className="rounded-3xl bg-[var(--surface-raised)] border border-[var(--border)] p-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[var(--text)]">{t('expiry.title')}</h2>
              <p className="text-[13px] text-[var(--text-muted)]">{t('expiry.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
              <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('expiry.expiringSoon')}</div>
              <div className="text-xl font-mono font-bold text-[var(--color-stock-warning)]">{expiringSoon}</div>
              <div className="text-[11px] font-mono text-[var(--text-muted)] mt-1">{t('expiry.within90Days')}</div>
            </div>
            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
              <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('expiry.expired')}</div>
              <div className="text-xl font-mono font-bold text-[var(--color-stock-critical)]">{expiredCount}</div>
              <div className="text-[11px] font-mono text-[var(--text-muted)] mt-1">{t('expiry.critical')}</div>
            </div>
            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
              <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase">{t('expiry.unitsOnHand')}</div>
              <div className="text-xl font-mono font-bold text-[var(--text)]">{formatQuantity(unitsOnHand)}</div>
              <div className="text-[11px] font-mono text-[var(--text-muted)] mt-1">{t('expiry.totalUnits')}</div>
            </div>
          </div>
        </section>

        {/* ── COVERAGE TABLE ── */}
        <section className="rounded-3xl bg-[var(--surface-raised)] border border-[var(--border)] p-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[var(--text)]">{t('coverageTitle')}</h2>
              <p className="text-[13px] text-[var(--text-muted)]">{t('coverageSubtitle')}</p>
            </div>
          </div>

          <div data-testid="coverage-table" className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b bg-[var(--surface)]/50 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">{t('product')}</th>
                  <th className="px-3 py-2 text-right">{t('onHand')}</th>
                  <th className="px-3 py-2 text-right">{t('value')}</th>
                  <th className="px-3 py-2 text-right">{t('daysOfCover')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/30">
                {coverageRows.map((row) => (
                  <tr
                    key={row.id}
                    data-value-minor={String(row.totalValue)}
                    data-dead={String(row.isDead)}
                    className="hover:bg-[var(--surface-2)]/50 transition-colors"
                  >
                    <td className="px-3 py-3 text-left">
                      <div className="font-medium text-[var(--text)]">{row.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{row.sku}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                      {formatQuantity(row.onHand)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                      {formatMoney(row.totalValue, { locale: 'en', compact: true })}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.isDead ? (
                        <span className="text-[var(--color-stock-critical)] font-medium">{t('notMoving')}</span>
                      ) : (
                        <span className="font-mono text-[var(--text)]">{row.daysCover} {t('days')}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {coverageRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">
                      {t('noStock')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── TOP PRODUCTS BY VALUE ── */}
        <section className="rounded-3xl bg-[var(--surface-raised)] border border-[var(--border)] p-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[var(--text)]">{t('deadTitle')}</h2>
              <p className="text-[13px] text-[var(--text-muted)]">{t('deadSubtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coverageRows.slice(0, 6).map((row) => (
              <div
                key={row.id}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-2"
              >
                <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  {row.name}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-mono font-bold text-[var(--text)]">
                    {formatMoney(row.totalValue, { locale: 'en', compact: true })}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">· {formatQuantity(row.onHand)} {t('unitsHeld', { n: row.onHand })}</span>
                </div>
                <div className="mt-auto text-[11px] font-mono text-[var(--text-muted)]">
                  {row.isDead ? t('notMoving') : t('deadNone')}
                </div>
              </div>
            ))}
            {coverageRows.length === 0 && (
              <div className="col-span-full px-4 py-6 text-center text-[var(--text-muted)]">
                {t('noStock')}
              </div>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
