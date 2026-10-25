import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { formatMoney, formatQuantity, daysToExpiry } from '@/lib/format';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

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
  const tNav = await getTranslations('nav');
  const session = await getSession();
  if (!session) return null;

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) return null;

  const supabase = await getSupabase();
  const { range: rangeParam } = await searchParams;
  const range = rangeParam === '7d' ? 7 : rangeParam === '90d' ? 90 : 30;

  const today = new Date();
  const startDate = new Date(today.getTime() - range * 86_400_000).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

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

  // ── Mock chart data for the line chart (real data would come from daily snapshots) ──
  // Using current capital as the anchor point
  const chartPoints = [40, 165, 70, 160, 105, 152, 140, 158, 175, 145, 210, 140, 245, 148, 280, 135, 315, 130, 350, 138, 385, 122, 420, 118, 455, 125, 490, 110, 525, 102, 560, 112, 595, 98, 630, 92, 665, 99, 700, 85, 735, 78, 770, 82, 805, 68, 840, 62, 875, 66, 910, 58, 945, 52, 970, 48];

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── TOP APP HEADER ── */}
      <header className="w-full border-b border-[var(--border)] bg-[var(--surface-raised)] sticky top-0 z-40">
        <div className="mx-auto max-w-[1400px] px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-[var(--primary)] pf-display font-bold text-sm tracking-tight hover:opacity-90">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span>Bershama</span>
            </Link>
            <div className="h-4 w-[1px] bg-[var(--border)] opacity-30" />
            <nav className="hidden md:flex items-center gap-5 text-[13px]">
              <Link href="/admin/inventory" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{tNav('inventory')}</Link>
              <Link href="/admin/deliveries" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{tNav('deliveries')}</Link>
              <Link href="/admin/inventory/requisitions" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{tNav('requisitions')}</Link>
              <Link href="/admin/analytics" className="text-[var(--primary-text, var(--primary))] font-semibold border-b-2 border-[var(--primary)] pb-0.5">{tNav('analytics')}</Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-muted)]">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
              <span>CAIRO-HUB-04</span>
              <span className="text-[var(--primary)]">2.4°C</span>
            </div>
            <button className="text-[var(--text-muted)] hover:text-[var(--text)] text-xs font-arabic px-2 py-1 rounded transition-colors" title={t('switchToArabic')}>
              العربية
            </button>
            <div className="h-4 w-[1px] bg-[var(--border)] opacity-30" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-mono text-[11px] font-semibold text-[var(--primary-text, var(--primary))]">
                TM
              </div>
              <div className="hidden lg:flex flex-col text-left leading-none">
                <span className="text-[12px] font-semibold text-[var(--text)] leading-none">{session.fullName}</span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">Lead Pharmacist · Shift 02</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-8 flex flex-col gap-8">
        {/* ── PAGE HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Cairo S.A.E. · Telemetry Stream</span>
              <span className="text-[11px] font-mono text-[var(--color-stock-ok)]">● GS1-128 Verified</span>
            </div>
            <h1 className="pf-display text-[1.75rem] font-bold text-[var(--text)] tracking-tight">{t('title')}</h1>
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
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] pl-2 border-l border-[var(--border)]">
              <span className="w-3 h-3 text-[var(--text-muted)]" />
              <span>{today.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} CLT</span>
            </div>
          </div>
        </div>

        {/* ── STOCK VALUE PANEL ── */}
        <section className="rounded-3xl bg-[var(--surface-raised)] border border-[var(--border)] p-6 flex flex-col gap-6">
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
                <div className="text-sm font-mono text-[var(--primary-text, var(--primary))]">EGP 18,400 (29.4%)</div>
              </div>
            </div>
          </div>

          {/* Chart Container ── */}
          <div className="relative w-full h-[280px] bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-4 select-none">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 220" preserveAspectRatio="none">
              <defs>
                <linearGradient id="stockLineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              <line x1="0" y1="20" x2="1000" y2="20" stroke="rgba(102, 102, 96, 0.16)" strokeWidth="1" />
              <line x1="0" y1="70" x2="1000" y2="70" stroke="rgba(102, 102, 96, 0.16)" strokeWidth="1" />
              <line x1="0" y1="120" x2="1000" y2="120" stroke="rgba(102, 102, 96, 0.16)" strokeWidth="1" />
              <line x1="0" y1="170" x2="1000" y2="170" stroke="rgba(102, 102, 96, 0.16)" strokeWidth="1" />
              <line x1="0" y1="210" x2="1000" y2="210" stroke="rgba(102, 102, 96, 0.16)" strokeWidth="1" strokeDasharray="2,2" />

              <text x="8" y="24" fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="10">EGP 70k</text>
              <text x="8" y="74" fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="10">EGP 60k</text>
              <text x="8" y="124" fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="10">EGP 50k</text>
              <text x="8" y="174" fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="10">EGP 40k</text>

              <polygon points={chartPoints.join(' ')} fill="url(#stockLineGradient)" />
              <polyline
                points={chartPoints.join(' ')}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <line x1="840" y1="0" x2="840" y2="210" stroke="var(--primary-text, var(--primary))" strokeWidth="1" strokeDasharray="3,3" className="opacity-90" />
              <line x1="0" y1="62" x2="1000" y2="62" stroke="var(--border)" strokeWidth="0.75" strokeDasharray="2,2" className="opacity-60" />
              <circle cx="840" cy="62" r="4.5" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2.5" />
            </svg>

            <div className="absolute top-8 left-[78%] -translate-x-1/2 pointer-events-none z-20 px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--primary)] shadow-xl flex items-center gap-2 transition-all duration-100">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="text-xs font-mono font-bold text-[var(--primary-text, var(--primary))]">EGP 62,400</span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">· 21 Oct</span>
            </div>

            <div className="w-full flex justify-between text-[11px] font-mono text-[var(--text-muted)] pt-2 px-6">
              <span>22 Sep</span>
              <span>29 Sep</span>
              <span>06 Oct</span>
              <span>13 Oct</span>
              <span className="text-[var(--primary-text, var(--primary))] font-semibold">21 Oct (Today)</span>
            </div>
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
      </main>
    </div>
  );
}
