import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type BalanceRow = Database['public']['Tables']['stock_balances']['Row'];
type BatchRow = Database['public']['Tables']['batches']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type LocationRow = Database['public']['Tables']['storage_locations']['Row'];

export default async function StocktakePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('stocktake');
  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const supabase = await getSupabase();
  const { location: locationId } = await searchParams;

  const { data: locations } = await supabase
    .from('storage_locations')
    .select('id, code, name_en, name_ar, kind')
    .eq('is_active', true)
    .neq('kind', 'IN_TRANSIT')
    .order('code');

  const locationRows: LocationRow[] = (locations ?? []) as LocationRow[];

  if (locationRows.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">{t('noLocations.title')}</h1>
          <p className="text-[var(--text-muted)] mt-2">{t('noLocations.body')}</p>
        </div>
      </div>
    );
  }

  const selectedLocationId = locationId || locationRows[0].id;
  const selectedLocation = locationRows.find((l) => l.id === selectedLocationId) ?? locationRows[0];

  const { data: balances } = await supabase
    .from('stock_balances')
    .select('batch_id, qty_on_hand')
    .eq('location_id', selectedLocationId)
    .gt('qty_on_hand', 0);

  const balanceRows: BalanceRow[] = (balances ?? []) as BalanceRow[];

  const { data: batches } = await supabase
    .from('batches')
    .select('id, lot_number, expiry_date, status, product_id')
    .is('deleted_at', null)
    .in(
      'id',
      balanceRows.map((b) => b.batch_id),
    );

  const batchRows: BatchRow[] = (batches ?? []) as BatchRow[];

  const { data: products } = await supabase
    .from('products')
    .select('id, name_en, name_ar, generic_name_en, generic_name_ar')
    .in('id', batchRows.map((b) => b.product_id));

  const productRows: ProductRow[] = (products ?? []) as ProductRow[];

  const productName = new Map(
    productRows.map((p) => [p.id, locale === 'ar' ? p.name_ar : p.name_en]),
  );
  const productGeneric = new Map(
    productRows.map((p) => [p.id, p.generic_name_en ?? p.generic_name_ar ?? '']),
  );

  const countedQty = new Map<string, number>();
  const diffQty = new Map<string, number>();

  const lines = balanceRows.map((balance) => {
    const batch = batchRows.find((b) => b.id === balance.batch_id);
    const product = productName.get(batch?.product_id ?? '') ?? '—';
    const generic = productGeneric.get(batch?.product_id ?? '') ?? '';
    const expected = balance.qty_on_hand;
    const counted = countedQty.get(batch?.id ?? '') ?? 0;
    const diff = counted - expected;

    return {
      id: batch?.id ?? balance.batch_id,
      product,
      generic,
      sku: batch?.lot_number ?? '—',
      expected,
      counted,
      diff,
      status: batch?.status ?? 'RELEASED',
    };
  });

  const totalLines = lines.length;
  const countedLines = lines.filter((l) => l.counted > 0).length;
  const pct = totalLines > 0 ? Math.round((countedLines / totalLines) * 100) : 0;

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)] flex flex-col overflow-x-hidden select-none">
      {/* ── TOP APP BAR ── */}
      <header className="fixed top-0 left-0 w-full z-40 flex items-center justify-between px-4 min-h-[48px] bg-[var(--surface-raised)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 text-[var(--primary)]" />
          <div className="flex items-baseline gap-2">
            <h1 className="pf-display text-sm font-semibold tracking-tight">{t('title')}</h1>
            <span className="text-[11px] font-mono text-[var(--text-muted)] border border-[var(--border)] px-2 py-0.5 rounded bg-[var(--surface-2)]">
              Bershama pharma
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-2 rounded-lg active:scale-95 transition-transform min-h-[36px]">
            {t('finish')}
            <span className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 pt-[56px] pb-[160px] px-4 space-y-4 max-w-lg mx-auto w-full">
        {/* ── LOCATION HERO ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-[16px] text-[var(--text)] font-semibold tracking-wide">
                  {selectedLocation.name_en ?? selectedLocation.code}
                </h1>
                <span className="bg-[var(--surface-2)] text-[var(--primary)] font-mono text-[11px] px-2 py-1 rounded border border-[var(--border)] font-medium">
                  {selectedLocation.code}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[13px] font-body-md text-[var(--text-muted)]">
                  {t('location.aria', { name: selectedLocation.name_en ?? selectedLocation.code, shelf: selectedLocation.code })}
                </p>
                <span className="text-[var(--text-muted)]">•</span>
                <span className="text-[var(--text-muted)] font-mono text-[11px] flex items-center gap-1">
                  <span className="w-3 h-3 text-[var(--primary)]" />
                  {t('edaAudited')}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[13px] text-[var(--text)] font-bold">{countedLines} <span className="text-[var(--text-muted)] font-normal">/ {totalLines}</span></div>
              <span className="text-[11px] font-mono text-[var(--primary)]">{pct}%</span>
            </div>
          </div>

          <div className="w-full bg-[var(--surface)] h-2 rounded-full overflow-hidden p-0.5 border border-[var(--border)]">
            <div className="bg-[var(--primary)] h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>

          <div className="grid grid-cols-3 gap-2 mt-2 pt-1 border-t border-[var(--border)]">
            <div className="flex flex-col">
              <span className="text-[11px] font-mono text-[var(--text-muted)]">{t('tempProfile')}</span>
              <span className="font-mono text-[11px] text-[var(--text)] font-bold flex items-center gap-1">
                <span className="w-3 h-3 text-[var(--text-muted)]" /> 21.4°C / 44%
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-mono text-[var(--text-muted)]">{t('linesRemaining')}</span>
              <span className="font-mono text-[11px] text-[var(--color-stock-warning)] font-bold">
                {totalLines - countedLines} {t('itemsRemaining')}
              </span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-[11px] font-mono text-[var(--text-muted)]">{t('palletId')}</span>
              <span className="font-mono text-[11px] text-[var(--text)] font-bold">EG-PLT-982</span>
            </div>
          </div>
        </section>

        {/* ── WORKFLOW CONTROL BAR ── */}
        <div className="flex items-center gap-2">
          <button className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] min-h-[44px] px-3 rounded-xl flex items-center justify-center gap-2 active:bg-[var(--surface-muted)] transition-colors">
            <span className="w-5 h-5 text-[var(--primary)]" />
            <span className="font-mono text-[13px]">{t('filter.uncounted', { count: totalLines - countedLines })}</span>
          </button>
          <button className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] min-h-[44px] px-3 rounded-xl flex items-center justify-center gap-2 active:bg-[var(--surface-muted)] transition-colors">
            <span className="w-5 h-5 text-[var(--color-stock-warning)]" />
            <span className="font-mono text-[13px]">{t('filter.discrepant', { count: lines.filter((l) => l.diff !== 0).length })}</span>
          </button>
          <button aria-label={t('audioBeep')} className="w-11 min-h-[44px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-xl flex items-center justify-center active:scale-95 transition-transform">
            <span className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* ── INVENTORY AUDIT TABLE ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="bg-[var(--surface-2)] border-b border-[var(--border)] px-3 py-2 flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            <div className="w-[50%]">{t('col.product')}</div>
            <div className="w-[18%] text-right font-mono">{t('col.expiry')}</div>
            <div className="w-[20%] text-right font-mono">{t('col.count')}</div>
            <div className="w-[12%] text-right font-mono">{t('col.diff')}</div>
          </div>
          <div className="divide-y divide-[var(--border)]/30">
            {lines.map((line) => {
              const isDiscrepant = line.diff !== 0;
              const isFocused = line.id === 'focused';
              return (
                <div
                  key={line.id}
                  className={`p-3 ${isFocused ? 'bg-[var(--surface-2)] border-l-4 border-l-[var(--primary)]' : 'bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors'} flex items-center justify-between min-h-[44px] gap-2`}
                >
                  <div className="w-[50%] pr-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text)] text-[13px] leading-tight truncate">{line.product}</span>
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] truncate">{line.generic}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">SKU {line.sku.slice(-4)}</span>
                      <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">EXP {line.expected > 0 ? '11/26' : '—'}</span>
                    </div>
                  </div>
                  <div className="w-[18%] text-right">
                    <span className="font-mono text-[13px] text-[var(--text)] font-bold block">{line.expected}</span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">{t('units')}</span>
                  </div>
                  <div className="w-[20%] flex justify-end">
                    <button
                      className="w-full min-h-[44px] bg-[var(--surface)] border border-[var(--border)] rounded-lg font-mono text-[13px] text-[var(--text)] font-bold text-right px-2 flex items-center justify-end active:border-[var(--primary)]"
                    >
                      {line.counted}
                    </button>
                  </div>
                  <div className="w-[12%] text-right">
                    <span
                      className={`font-mono text-[13px] font-bold inline-block bg-[var(--surface)] px-2 py-1 rounded border border-[var(--border)] ${
                        isDiscrepant ? 'text-[var(--color-stock-warning)]' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {line.diff > 0 ? `+${line.diff}` : line.diff}
                    </span>
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && (
              <div className="px-3 py-6 text-center text-[var(--text-muted)]">
                {t('empty')}
              </div>
            )}
          </div>
        </section>

        {/* ── QUICK QTY STEPPER ── */}
        <section className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('stepper.title')}</span>
            <span className="font-mono text-[11px] text-[var(--primary)]">{t('stepper.target', { qty: 120 })}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[-10, -1, 1, 10].map((delta) => (
              <button
                key={delta}
                className="min-h-[48px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-xl font-mono text-[13px] font-bold flex items-center justify-center text-center active:bg-[var(--surface-muted)] transition-colors"
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
          </div>
          <button
            className="w-full min-h-[44px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl flex items-center justify-center gap-2 font-mono text-[13px] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] active:scale-[0.99]"
          >
            <span className="w-4 h-4" />
            {t('stepper.accept', { qty: 120 })}
          </button>
        </section>

        {/* ── FINISH COUNT ── */}
        <section className="pt-2">
          <button className="w-full min-h-[48px] bg-[var(--primary)] text-[var(--primary-foreground)] font-mono text-[16px] font-bold rounded-xl flex items-center justify-center gap-2 active:-translate-y-px transition-transform duration-100">
            <span className="w-5 h-5" />
            {t('finishCount')}
            <span className="font-mono text-[11px] bg-[var(--primary-foreground)]/10 px-2 py-0.5 rounded ml-1">{countedLines}/{totalLines}</span>
          </button>
          <p className="text-[13px] font-body-md text-center text-[var(--text-muted)] mt-2">
            {t('edaTimestamp', { time: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
          </p>
        </section>
      </main>

      {/* ── DOCKED BOTTOM NAVIGATION ── */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-3 py-1 bg-[var(--surface-raised)] border-t border-[var(--border)]">
        <a
          className="flex flex-col items-center justify-center bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg px-3 py-2 min-h-[48px] min-w-[48px] active:scale-95 transition-transform"
          href="#stocktake"
        >
          <span className="w-5 h-5 text-[var(--primary-foreground)]" />
          <span className="font-mono text-[11px] text-[var(--primary-foreground)] font-bold">{t('nav.stocktake')}</span>
        </a>
        <a
          className="flex flex-col items-center justify-center text-[var(--text-muted)] px-3 py-2 min-h-[48px] min-w-[48px] hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:scale-95 transition-transform"
          href="#scanner"
        >
          <span className="w-5 h-5" />
          <span className="font-mono text-[11px]">{t('nav.scanner')}</span>
        </a>
        <a
          className="flex flex-col items-center justify-center text-[var(--text-muted)] px-3 py-2 min-h-[48px] min-w-[48px] hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:scale-95 transition-transform relative"
          href="#discrepancies"
        >
          <span className="w-5 h-5" />
          <span className="font-mono text-[11px]">{t('nav.discrepancies')}</span>
          <span className="absolute top-2 right-3 w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
        </a>
        <a
          className="flex flex-col items-center justify-center text-[var(--text-muted)] px-3 py-2 min-h-[48px] min-w-[48px] hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:scale-95 transition-transform"
          href="#sync"
        >
          <span className="w-5 h-5" />
          <span className="font-mono text-[11px]">{t('nav.sync')}</span>
        </a>
      </nav>

      {/* ── FLOATING BARCODE SCAN ── */}
      <aside className="fixed right-4 bottom-20 z-40">
        <button aria-label={t('scanBarcode')} className="w-14 h-14 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center shadow-lg active:scale-90 transition-transform border-2 border-[var(--surface-raised)]">
          <span className="w-7 h-7" />
        </button>
      </aside>
    </div>
  );
}
