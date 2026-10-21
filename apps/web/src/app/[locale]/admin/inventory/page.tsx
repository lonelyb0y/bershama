import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { getSession } from '@/lib/session';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';

/**
 * The inventory section index.
 *
 * A section root that 404s is worse than no section root: the nav highlights
 * "Inventory" on a page that does not exist, and the page it should link to is
 * a page away. This is three counts and a list of doors, which is the most a
 * landing page can usefully be when the real work is one click away.
 */
export default async function InventoryIndex({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('inventory');
  const numberFormat = new Intl.NumberFormat(locale);
  const session = await getSession();
  if (!session) notFound();

  const supabase = await getSupabase();

  // Three counts, in three round trips, in parallel. Not one query with three
  // sub-selects: at this size either is instant, and three awaits in parallel
  // reads more clearly than a query whose shape is an optimisation nobody asked
  // for.
  const [products, batches, lowStock] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('batches').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    // The column is product_id, not id.
    //
    // stock_balances is keyed on (tenant_id, location_id, product_id, batch_id) and
    // has no `id` at all, so selecting one made PostgREST answer `42703: column
    // stock_balances.id does not exist`. The count came back zero, the error was
    // swallowed, and the page told a distributor they had no stock in a warehouse
    // holding 650 units -- on the same screen as a dashboard saying 650.
    //
    // It is worth being clear about the failure mode: a count query that errors
    // does not error visibly. It returns null, `?? 0` turns it into a number, and
    // the number is wrong. A wrong count on a stock screen is worse than a broken
    // one, because it is believed.
    supabase.from('stock_balances').select('product_id', { count: 'exact', head: true }).gt('qty_on_hand', 0),
  ]);

  const doors = [
    {
      href: '/admin/inventory/products',
      title: t('catalogue.title'),
      body: t('catalogue.body', { count: products.count ?? 0 }),
    },
    {
      href: '/admin/inventory/batches',
      title: t('batches.title'),
      body: t('batches.body', { count: batches.count ?? 0 }),
    },
    {
      href: '/admin/inventory/stocktake',
      title: t('stocktake.title'),
      body: t('stocktake.body'),
    },
  ];

  return (
    /*
     * A hub is a map, not a wall.
     *
     * This was three cards and then about ninety per cent of the screen. A person
     * arriving here had three doors to choose between and no idea which one held
     * what, and no way to tell whether there was anything waiting.
     *
     * So: the figures first, because they are the reason to be on this page at all;
     * then the doors, as a list rather than three wide boxes, because a list of
     * three lines with a number each is denser and easier to scan than three
     * rectangles.
     */
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle', { count: lowStock.count ?? 0 })}
      />

      <section
        aria-label={t('figures')}
        className="grid gap-3 sm:grid-cols-3"
      >
        <StatTile
          label={t('catalogue.title')}
          value={numberFormat.format(products.count ?? 0)}
          hint={t('catalogue.body', { count: products.count ?? 0 })}
        />
        <StatTile
          label={t('batches.title')}
          value={numberFormat.format(batches.count ?? 0)}
          hint={t('batches.body', { count: batches.count ?? 0 })}
        />
        <StatTile
          label={t('lowStockLabel')}
          value={numberFormat.format(lowStock.count ?? 0)}
          hint={t('lowStockHint')}
          tone={lowStock.count && lowStock.count > 0 ? 'warn' : 'good'}
        />
      </section>

      <nav aria-label={t('doors')} className="overflow-hidden rounded-xl border">
        {doors.map((d, i) => (
          <Link
            key={d.href}
            href={d.href}
            // This route is already the parent of where this link goes, so prefetching
            // it round-trips a page you are standing on.
            prefetch={false}
            className={`flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[color:var(--surface-2)]/60 ${
              i > 0 ? 'border-t' : ''
            }`}
          >
            <div className="min-w-0">
              <span className="block text-sm font-medium">{d.title}</span>
              <span className="block text-xs text-[color:var(--text-muted)]">
                {d.body}
              </span>
            </div>
            <span aria-hidden="true" className="text-[color:var(--text-muted)]">
              &#8250;
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}