import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { BatchTable } from '@/components/inventory/batch-table';
import { StatTile } from '@/components/ui/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
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
 *
 * ── the four figures ──────────────────────────────────────────────────────────
 *
 * They are four separate counts, and they are not the same question. How many
 * lots are there (all of them), how many need a decision inside the window
 * (the ones a person can still act on), how many are already gone (a number
 * somebody has to be told about), and how many are held back (received, and
 * not yet released for supply).
 *
 * A shelf that shows one number and calls it "the situation" is a shelf that
 * cannot answer a question. Which of these four is a person about to walk in
 * and ask for?
 */
const WINDOWS = [90, 180, 365] as const;
type Window = (typeof WINDOWS)[number];

function parseWindow(raw: string | undefined): Window {
  const parsed = Number(raw);
  return (WINDOWS as readonly number[]).includes(parsed) ? (parsed as Window) : 90;
}

export default async function BatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ status?: string; expiry?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('batches');
  const session = await getSession();
  if (!session) notFound();

  const { status, expiry } = await searchParams;
  const windowDays = parseWindow(expiry);

  const [rows, counts] = await Promise.all([
    loadBatches(locale, status),
    loadCounts(windowDays),
  ]);

  const filters = [
    { value: '', label: t('filter.all') },
    { value: 'RELEASED', label: t('status.RELEASED') },
    { value: 'QUARANTINED', label: t('status.QUARANTINED') },
    { value: 'DEPLETED', label: t('status.DEPLETED') },
    { value: 'EXPIRED', label: t('status.EXPIRED') },
  ];

  const numberFormat = new Intl.NumberFormat(locale);

  return (
    <div className="space-y-6">
      {/* ── the heading, and the window, and the one action ───────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="pf-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
            <Badge tone="good" shape="circle">
              {t('live')}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[color:var(--text-muted)]">
            <span aria-hidden="true" className="size-2 rounded-full bg-[var(--primary)]" />
            {t('subtitle', { count: counts.total })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
            The window, as pills.

            A group of links rather than a select: each is a real URL, so the
            window survives a refresh and can be sent to a colleague as a link.
            And a select for three options is a menu that hides three things
            behind a chevron.
          */}
          <div className="pf-pills" role="group" aria-label={t('windowLabel')}>
            {WINDOWS.map((days) => (
              <Link
                key={days}
                href={`/${locale}/admin/inventory/batches?expiry=${days}${
                  status ? `&status=${status}` : ''
                }`}
                prefetch={false}
                data-active={days === windowDays}
                aria-current={days === windowDays ? 'true' : undefined}
                className="pf-pill"
              >
                {days}d
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── the four figures ───────────────────────────────────────────────── */}
      <section aria-label={t('figures')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('figureTotal')}
          value={numberFormat.format(counts.total)}
          hint={t('figureTotalHint')}
        />
        <StatTile
          label={t('figureExpiring')}
          value={numberFormat.format(counts.expiring)}
          hint={t('figureExpiringHint')}
          tone={counts.expiring > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t('figureExpired')}
          value={numberFormat.format(counts.expired)}
          hint={t('figureExpiredHint')}
          tone={counts.expired > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t('figureQuarantined')}
          value={numberFormat.format(counts.quarantined)}
          hint={t('figureQuarantinedHint')}
          tone={counts.quarantined > 0 ? 'warn' : 'good'}
        />
      </section>

      {/* ── the filters ────────────────────────────────────────────────────── */}
      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (status ?? '') === f.value;
          return (
            <a
              key={f.value || 'all'}
              href={`/${locale}/admin/inventory/batches?expiry=${windowDays}${
                f.value ? `&status=${f.value}` : ''
              }`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-xl border px-3 py-2 text-sm ${
                active
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 font-medium'
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

/**
 * The four counts.
 *
 * Four separate questions, four separate counts, in parallel. Not one query with
 * four sub-selects: at this size either is instant, and parallel reads read more
 * clearly than a query whose shape is an optimisation nobody asked for.
 */
async function loadCounts(windowDays: Window): Promise<{
  total: number;
  expiring: number;
  expired: number;
  quarantined: number;
}> {
  const supabase = await getSupabase();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = new Date(
    today.getTime() + windowDays * 86_400_000,
  ).toISOString().slice(0, 10);

  const [total, expiring, expired, quarantined] = await Promise.all([
    supabase.from('batches').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    // Expiring: released or quarantined stock that crosses its date inside the
    // window. A RECALLED or DEPLETED lot is not "expiring soon" -- it is
    // already out of the picture, and counting it would put a number on the
    // screen that nobody can act on.
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .in('status', ['RELEASED', 'QUARANTINED'])
      .gte('expiry_date', todayIso)
      .lte('expiry_date', horizonIso),
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .lte('expiry_date', todayIso),
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'QUARANTINED'),
  ]);

  return {
    total: total.count ?? 0,
    expiring: expiring.count ?? 0,
    expired: expired.count ?? 0,
    quarantined: quarantined.count ?? 0,
  };
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
 * The batch statuses, as a literal.
 *
 * A typo in a filter is a URL somebody edited, and the answer to that is the
 * list, not a stack trace.
 */
/**
 * The batch list, as a plain async function rather than inline in the component.
 *
 * Not style for its own sake: it reads the clock, and `Date.now()` inside a
 * component body is render impurity -- React requires a component to be a pure
 * function of its props, and a lint rule here says so. A helper called from
 * render is not render, and the value it computes once per request is exactly
 * the same number the component would have used.
 */
const BATCH_STATUSES = ['RELEASED', 'QUARANTINED', 'EXPIRED', 'RECALLED', 'DEPLETED'] as const;

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
    .order('expiry_date', { ascending: true });

  // An unrecognised status is NO FILTER, not a database error.
  //
  // Rather than casting it -- which would turn a mistyped filter into a query
  // that fails -- it is checked here, so the list comes back whole. Somebody who
  // mistyped one meant to see the list, and a 500 for that is a worse answer
  // than the list they asked for.
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

  return named.map((b) => {
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
}
