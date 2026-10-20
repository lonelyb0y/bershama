import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { BatchTable } from '@/components/inventory/batch-table';
import type { Locale } from '@/i18n/routing';
import type { BatchRowView } from '@/components/inventory/batch-table';

/**
 * Batches: the lots stock actually moves in.
 *
 * A product says what something is; a batch says which particular delivery of it
 * is here, when it expires and what it cost. Every unit of stock in this system
 * belongs to a batch, which is why the batch list is the screen a warehouse
 * manager opens most often and why it is sorted by expiry rather than by name --
 * the first thing anyone wants to know is what is about to go off.
 *
 * Read-only here. Creating a batch implies a goods-received document, its
 * costing and its quality release, and the README defers GRN explicitly. A
 * "create batch" form that let someone type an expiry date and a cost would
 * bypass all three, so the list shows what exists and the write waits for the
 * receipt that should drive it.
 */
export default async function BatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('batches');
  const session = await getSession();
  if (!session) notFound();

  const { status } = await searchParams;

  const rows = await loadBatches(locale, status);

  const filters = [
    { value: '', label: t('filter.all') },
    { value: 'RELEASED', label: t('status.RELEASED') },
    { value: 'QUARANTINED', label: t('status.QUARANTINED') },
    { value: 'DEPLETED', label: t('status.DEPLETED') },
    { value: 'EXPIRED', label: t('status.EXPIRED') },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-[color:var(--text-muted)] mt-1 text-sm">{t('subtitle', { count: rows.length })}</p>
      </header>

      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (status ?? '') === f.value;
          return (
            <a
              key={f.value || 'all'}
              href={f.value === '' ? `/admin/inventory/batches` : `/admin/inventory/batches?status=${f.value}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                active
                  ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)]/10 font-medium'
                  : 'hover:bg-[color:var(--surface-raised)]'
              }`}
            >
              {f.label}
            </a>
          );
        })}
      </nav>

      <BatchTable
        rows={rows}
        labels={{
          lot: t('lot'),
          product: t('product'),
          expiry: t('expiry'),
          statusLabel: t('statusLabel'),
          supplier: t('supplier'),
          days: t('days'),
          daysColumn: t('daysColumn'),
          over: t('over'),
          empty: t('empty'),
          emptyBody: t('emptyBody'),
          expired: t('expired'),
          expiringSoon: t('expiringSoon'),
          readOnly: t('readOnly'),
          status: {
            RELEASED: t('status.RELEASED'),
            QUARANTINED: t('status.QUARANTINED'),
            DEPLETED: t('status.DEPLETED'),
            EXPIRED: t('status.EXPIRED'),
          },
        }}
      />
    </div>
  );
}

interface BatchRow {
  id: string;
  product_id: string;
  lot_number: string;
  mfg_date: string;
  expiry_date: string;
  unit_cost_minor: number;
  status: string;
  supplier_name: string | null;
  deleted_at: string | null;
  products: { name_en: string; name_ar: string | null; sku: string } | null;
}

/**
 * The batch list, as a plain async function rather than inline in the component.
 *
 * Not style for its own sake: it reads the clock, and `Date.now()` inside a
 * component body is render impurity -- React requires a component to be a pure
 * function of its props, and a lint rule here says so. A helper called from
 * render is not render, and the value it computes once per request is exactly
 * the same number the component would have used.
 */
async function loadBatches(locale: Locale, status?: string): Promise<BatchRowView[]> {
  const supabase = await getSupabase();
  let query = supabase
  .from('batches')
  .select(
    // products!batches_product_id_fkey, named rather than bare, because
    // several views in this schema expose both product_id and batch_id and
    // PostgREST infers the relationship from view column names -- which makes
    // batches -> products ambiguous and fails with PGRST201. See the stocktake
    // page for the same note at the query site.
    'id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor, status, supplier_name, deleted_at, products!batches_product_id_fkey(name_en, name_ar, sku)',
  )
  .is('deleted_at', null)
  .order('expiry_date');

// The status arrives from a query string, so it is a string and not a BatchStatus.
// Rather than casting it -- which would turn a mistyped filter into a database
// error instead of an empty list -- it is checked here: an unrecognised status is no
// filter at all, which is what somebody who mistyped one meant.
const BATCH_STATUSES = ['RELEASED', 'QUARANTINED', 'EXPIRED', 'RECALLED', 'DEPLETED'] as const;

if (status && (BATCH_STATUSES as readonly string[]).includes(status)) {
  query = query.eq('status', status as (typeof BATCH_STATUSES)[number]);
}

const { data, error } = await query.limit(200);

if (error) {
  // A broken query and a genuinely empty filter look identical otherwise, and a
  // warehouse manager acting on "no batches" when the query failed is a real
  // consequence. A 404 is the honest answer: the screen cannot show what it
  // was asked for.
  throw new Error(`batches query failed: ${error.code} ${error.message}`);
}

const now = Date.now();

// A batch whose product has been deleted is a row with nothing to describe it.
// It is dropped rather than shown as a blank line, and the count is taken
// after the drop so the heading never claims to have listed something it did
// not. The same rule as the stocktake sheet: a row that cannot be identified
// is a row that cannot be acted on.
const named = ((data ?? []) as unknown as BatchRow[]).filter(
  (b): b is BatchRow & { products: NonNullable<BatchRow['products']> } => Boolean(b.products),
);

const rows = named.map((b) => {
  const expiry = new Date(b.expiry_date).getTime();
  const days = Math.floor((expiry - now) / 86_400_000);

  return {
    id: b.id,
    lotNumber: b.lot_number,
    productName: locale === 'ar' ? b.products.name_ar ?? b.products.name_en : b.products.name_en,
    sku: b.products.sku,
    mfgDate: b.mfg_date,
    expiryDate: b.expiry_date,
    status: b.status,
    supplierName: b.supplier_name,
    // Computed here rather than in the database because it is a property of
    // "now", which a stored column would freeze at write time. A batch that
    // expires tomorrow has to start looking different without anyone updating
    // it.
    daysToExpiry: days,
  };
});
  return rows;
}
