import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { CountSheet } from '@/components/stocktake/count-sheet';
import { submitStocktakeAction } from './actions';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import type { SheetLine } from '@/lib/api/stocktake-sheet';

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

  const sheetRows = balanceRows.map((balance) => {
    const batch = batchRows.find((b) => b.id === balance.batch_id);
    const product = productName.get(batch?.product_id ?? '') ?? '—';
    const generic = productGeneric.get(batch?.product_id ?? '') ?? '';
    return {
      batchId: batch?.id ?? balance.batch_id,
      productId: batch?.product_id ?? balance.batch_id,
      lotNumber: batch?.lot_number ?? '—',
      productName: product,
      expiryDate: batch?.expiry_date ?? '',
      qtyOnHand: balance.qty_on_hand,
    };
  });

  const totalLines = sheetRows.length;

  async function handleSubmit(locationId: string, lines: SheetLine[]) {
    return submitStocktakeAction(locationId, lines);
  }

  return (
    <div className="bg-[var(--surface)] text-[var(--text)] flex flex-col overflow-x-hidden select-none">
      <section className="flex-1 pt-[56px] pb-[160px] px-4 space-y-4 max-w-lg mx-auto w-full">
        <h1 className="pf-display text-sm font-semibold tracking-tight">{t('title')}</h1>
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
                <p className="text-[13px] text-sm text-[var(--text-muted)]">
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
              <div className="font-mono text-[13px] text-[var(--text)] font-bold">{totalLines} <span className="text-[var(--text-muted)] font-normal">lines</span></div>
            </div>
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
                {totalLines} {t('itemsRemaining')}
              </span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-[11px] font-mono text-[var(--text-muted)]">{t('palletId')}</span>
              <span className="font-mono text-[11px] text-[var(--text)] font-bold">—</span>
            </div>
          </div>
        </section>

        {/* ── COUNT SHEET ── */}
        <CountSheet
          locationId={selectedLocationId}
          rows={sheetRows}
          submit={handleSubmit}
        />
      </section>

      {/* ── DOCKED BOTTOM NAVIGATION ── */}
      <div className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-3 py-1 bg-[var(--surface-raised)] border-t border-[var(--border)]">
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
      </div>

      {/* ── FLOATING BARCODE SCAN ── */}
      <aside className="fixed right-4 bottom-20 z-40">
        <button aria-label={t('scanBarcode')} className="w-14 h-14 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center shadow-lg active:scale-90 transition-transform border-2 border-[var(--surface-raised)]">
          <span className="w-7 h-7" />
        </button>
      </aside>
    </div>
  );
}
