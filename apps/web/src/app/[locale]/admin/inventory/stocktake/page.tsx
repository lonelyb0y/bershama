import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { CountSheet } from '@/components/stocktake/count-sheet';
import { submitStocktakeAction } from './actions';
import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import type { Locale } from '@/i18n/routing';
import type { StocktakeRow } from '@/components/stocktake/count-sheet';
import type { Database } from '@/lib/database.types';

type BalanceRow = Database['public']['Tables']['stock_balances']['Row'];

/**
 * The stocktake screen.
 *
 * Loads the count sheet for one storage location: every batch the database
 * believes is there, with the quantity it believes. The counter then types what
 * is actually on the shelf and the two are compared.
 *
 * A note on what this list IS, because it bounds what a stocktake can find. It
 * is built from stock_balances, so it contains only combinations the system
 * already has a record of. A count can therefore find "the books say 40 and
 * there are 37", but it cannot find "there are 12 cartons on this shelf that the
 * system has never heard of" -- that combination is not a row, and there is
 * nowhere to type it. Closing that needs a per-product line with a free-text
 * batch, which is a bigger change to the ledger than a screen. Recorded here
 * rather than left to be discovered during the first count.
 *
 * The admin surface is the right home for this: stocktake is warehouse work, and
 * the layout's role guard already admits TENANT_ADMIN, WAREHOUSE_MANAGER,
 * DISPATCHER and ANALYST. The write itself is authorised in the database by
 * private.require_inventory_write(), so an ANALYST reaching this page can load
 * it and still be refused on submit.
 */
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
    // To the login page, matching AuthenticatedShell. My first attempt sent this
    // to a sign-out route instead, which would have been wrong twice over: the
    // route is POST-only on purpose (a GET sign-out can be fired by any page
    // simply loading an image), and signing someone out to render a page they
    // are not allowed to see turns an expired session into a logged-out one.
    redirect(`/${locale}/login`);
  }

  const supabase = await getSupabase();
  const { location: locationId } = await searchParams;

  // The locations are the only other list this screen needs, and a stocktake is
  // always scoped to one of them. RLS applies, so this is the caller's tenant and
  // no other: the tenant is never taken from the query string.
  const { data: locations } = await supabase
    .from('storage_locations')
    .select('id, code, name_en, name_ar, kind')
    .eq('is_active', true)
    .neq('kind', 'IN_TRANSIT')
    .order('code');

  const locationRows = (locations ?? []) as Array<{
    id: string;
    code: string;
    name_en: string;
    name_ar: string | null;
    kind: string;
  }>;

  if (locationRows.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="rounded-xl border p-8 text-center text-sm text-[color:var(--text-muted)]">
          {t('noLocations')}
        </p>
      </div>
    );
  }

  const selected = locationRows.find((l) => l.id === locationId) ?? locationRows[0];

  const rows = await loadCountSheet(selected.id, locale);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
      </header>

      {/*
        A plain list of links rather than a <select>. A GET form that navigates is
        the only version of this that survives a reload, a bookmark and the back
        button, and a count is a thing a warehouse does repeatedly at the same
        location. The select would be nicer to use and would lose the URL.
      */}
      <nav aria-label={t('location')} className="flex flex-wrap gap-2">
        {locationRows.map((l) => {
          const active = l.id === selected.id;
          const label = locale === 'ar' ? (l.name_ar ?? l.name_en) : l.name_en;

          return (
            <a
              key={l.id}
              href={`/${locale}/admin/inventory/stocktake?location=${l.id}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                active
                  ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)]/10 font-medium'
                  : 'hover:bg-[color:var(--surface-raised)]'
              }`}
            >
              {/* dir="ltr": a location code is a shelf label, and it is copied
                  onto a count sheet by hand. */}
              <span dir="ltr">{label}</span>
            </a>
          );
        })}
      </nav>

      <CountSheet
        locationId={selected.id}
        rows={rows}
        submit={async (id, lines) => {
          const result = await submitStocktakeAction(id, lines);
          return { summary: result.summary, failures: result.failures };
        }}
      />
    </div>
  );
}

/**
 * Every batch with a balance at one location, joined to its product and lot.
 *
 * Read through RLS as the signed-in user rather than through a privileged
 * function: this is a plain read, and a SECURITY DEFINER wrapper that only
 * SELECTs would be a place for a tenant filter to be forgotten. The rule so far
 * is that the api schema exists for things a caller may not do directly, and this
 * is not one of them.
 */
async function loadCountSheet(locationId: string, locale: Locale): Promise<StocktakeRow[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from('stock_balances')
    .select(
      // products!batches_product_id_fkey, not a bare products(...).
      //
      // Five views in this schema (v_expiry_report, v_inventory_by_batch and the
      // rest) expose both product_id and batch_id, and PostgREST infers
      // relationships from views by matching column names. That makes
      // batches -> products genuinely ambiguous, and it fails with PGRST201
      // "more than one relationship was found" -- verified against the local
      // stack, not reasoned about. Naming the constraint resolves it.
      //
      // Unit tests could not have caught this: it is a property of the deployed
      // schema's shape, not of any function.
      'product_id, batch_id, qty_on_hand, batches(lot_number, expiry_date, products!batches_product_id_fkey(name_en, name_ar))',
    )
    .eq('location_id', locationId)
    .gt('qty_on_hand', 0)
    .order('id');

  if (error || !data) {
    // Logged, and still rendered as an empty sheet. Throwing would replace the
    // screen with a stack trace, which is the wrong answer for a warehouse
    // terminal; but returning [] silently is worse, because a broken query and a
    // genuinely empty location are then indistinguishable, and a count taken
    // against an empty-looking sheet records nothing. The console entry is what
    // makes the difference diagnosable.
    console.error('stocktake: could not load the count sheet', {
      locationId,
      code: error?.code,
      message: error?.message,
    });
    return [];
  }

  const balances = data as unknown as Array<{
    product_id: string;
    batch_id: string;
    qty_on_hand: number;
    batches: {
      lot_number: string;
      expiry_date: string;
      products: { name_en: string; name_ar: string | null };
    } | null;
  }>;

  return balances
    // A balance whose batch was soft-deleted is a row with nothing to describe it.
    // Dropping it is right: there is no lot to count against, and offering one
    // would send a counter to a shelf for a batch the catalogue no longer lists.
    .filter((b): b is (typeof balances)[number] & { batches: NonNullable<typeof b.batches> } =>
      Boolean(b.batches),
    )
    .map((b) => {
      const name = locale === 'ar' ? (b.batches.products.name_ar ?? b.batches.products.name_en) : b.batches.products.name_en;

      return {
        batchId: b.batch_id as string,
        productId: b.product_id as string,
        lotNumber: b.batches.lot_number,
        productName: name,
        expiryDate: b.batches.expiry_date,
        qtyOnHand: Number(b.qty_on_hand),
      } satisfies StocktakeRow;
    });
}

export type { BalanceRow };
