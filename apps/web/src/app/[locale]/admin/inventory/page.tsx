import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
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
    supabase.from('stock_balances').select('id', { count: 'exact', head: true }).gt('qty_on_hand', 0),
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-[color:var(--text-muted)] mt-1 text-sm">
          {t('subtitle', { count: lowStock.count ?? 0 })}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {doors.map((d) => (
          <Link
            key={d.href}
            href={d.href}
          // This route is already the parent of where this link goes, so prefetching
          // it round-trips a page you are standing on.
          prefetch={false}
            className="rounded-xl border p-5 transition-colors hover:bg-[color:var(--surface-raised)]"
          >
            <h2 className="font-semibold">{d.title}</h2>
            <p className="text-[color:var(--text-muted)] mt-1 text-sm">{d.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
