import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { StatTile } from '@/components/ui/stat-tile';
import { Badge, Ltr } from '@/components/ui/badge';
import { getSession } from '@/lib/session';
import { daysToExpiry, formatMoney } from '@/lib/format';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';

/**
 * The inventory hub.
 *
 * ── what it is now ────────────────────────────────────────────────────────────
 *
 * Four figures, a table of where the stock is, and the lots that need attention
 * first. The previous version was four figures and three links.
 *
 * The links are still there -- in the navigation, where they belong -- but a hub
 * whose job is "where is my stock and what is about to expire" should answer
 * the question on the screen, not point at another screen that would answer it.
 *
 * ── every number is a real one ────────────────────────────────────────────────
 *
 * The units, the value and the expiry exposure are summed from
 * `stock_balances` against the batch that carries the cost and the expiry. The
 * asset value is `qty_on_hand * unit_cost_minor` per location -- the value of
 * what is on the shelf, at what it cost, which is the only value a distributor
 * can act on.
 *
 * Where a figure does not exist, it is an em dash. Never a zero: a location
 * with no stock is not the same as a location whose stock is worth nothing.
 */
type Zone = {
  id: string;
  code: string;
  name: string;
  units: number;
  valueMinor: number;
  soonestDays: number | null;
};

type Lot = {
  id: string;
  lotNumber: string;
  productName: string;
  days: number;
};

type Inventory = {
  products: number;
  batches: number;
  expiring: number;
  quarantined: number;
  zones: Zone[];
  atRisk: Lot[];
  asOf: string;
};

/**
 * The reads, in one place.
 *
 * Not style for its own sake: it reads the clock, and `Date.now()` inside a
 * component body is render impurity -- React requires a component to be a pure
 * function of its props, and a lint rule here says so. A helper called from
 * render is not render, and the value it computes once per request is exactly
 * the same number the component would have used.
 */
async function loadInventory(locale: Locale): Promise<Inventory> {
  const supabase = await getSupabase();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

  // Six reads, in parallel.
  //
  // Not one query with six sub-selects: at this size either is instant, and
  // parallel reads read more clearly than a query whose shape is an optimisation
  // nobody asked for.
  //
  // The balances are read as rows and aggregated here rather than in the
  // database, because the aggregation is per location and the database has no
  // view for it -- and because a view that only one screen uses is a view that
  // goes stale silently.
  const [products, batches, expiring, quarantined, locations, balances, lots, productList] =
    await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
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
        .eq('status', 'QUARANTINED'),
      supabase
        .from('storage_locations')
        .select('id, code, name_en, name_ar, kind')
        .eq('is_active', true),
      supabase
        .from('stock_balances')
        .select('location_id, batch_id, qty_on_hand')
        .gt('qty_on_hand', 0),
      supabase
        .from('batches')
        .select('id, lot_number, expiry_date, status, unit_cost_minor, product_id')
        .is('deleted_at', null),
      supabase.from('products').select('id, name_en, name_ar'),
    ]);

  const productName = new Map(
    asRows<{ id: string; name_en: string; name_ar: string }>(productList).map((p) => [
      p.id,
      locale === 'ar' ? p.name_ar : p.name_en,
    ]),
  );

  const lotRows = asRows<{
    id: string;
    lot_number: string;
    expiry_date: string;
    status: string;
    unit_cost_minor: number;
    product_id: string;
  }>(lots);
  const lotById = new Map(lotRows.map((l) => [l.id, l]));

  // ── per location: units, value, and the soonest expiry in it ────────────────
  const zones = new Map<string, Zone>(
    asRows<{ id: string; code: string; name_en: string; name_ar: string }>(locations).map(
      (l) => [
        l.id,
        {
          id: l.id,
          code: l.code,
          name: locale === 'ar' ? l.name_ar : l.name_en,
          units: 0,
          valueMinor: 0,
          soonestDays: null,
        },
      ],
    ),
  );

  const balanceRows = asRows<{ location_id: string; batch_id: string; qty_on_hand: number }>(
    balances,
  );

  for (const balance of balanceRows) {
    const zone = zones.get(balance.location_id);
    if (!zone) continue;
    const lot = lotById.get(balance.batch_id);
    if (!lot) continue;

    zone.units += balance.qty_on_hand;
    zone.valueMinor += balance.qty_on_hand * lot.unit_cost_minor;

    const days = daysToExpiry(lot.expiry_date);
    if (zone.soonestDays === null || days < zone.soonestDays) {
      zone.soonestDays = days;
    }
  }

  const zoneList = [...zones.values()].sort((a, b) => {
    // The zones that need attention first, then the rest by code.
    const ra = a.soonestDays === null ? 9999 : a.soonestDays;
    const rb = b.soonestDays === null ? 9999 : b.soonestDays;
    return ra - rb || a.code.localeCompare(b.code);
  });

  // ── the lots that need attention first ──────────────────────────────────────
  const atRisk: Lot[] = [...lotRows]
    .filter((lot) => {
      if (lot.status === 'RECALLED' || lot.status === 'DEPLETED') return false;
      if (!balanceRows.some((b) => b.batch_id === lot.id)) return false;
      return daysToExpiry(lot.expiry_date) <= 90;
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
    .slice(0, 4)
    .map((lot) => ({
      id: lot.id,
      lotNumber: lot.lot_number,
      productName: productName.get(lot.product_id) ?? '—',
      days: daysToExpiry(lot.expiry_date),
    }));

  return {
    products: products.count ?? 0,
    batches: batches.count ?? 0,
    expiring: expiring.count ?? 0,
    quarantined: quarantined.count ?? 0,
    zones: zoneList,
    atRisk,
    asOf: today.toLocaleString(locale),
  };
}

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

  const data = await loadInventory(locale);

  return (
    <div className="space-y-6">
      {/* ── the heading, and what is true right now ────────────────────────── */}
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
            {t('asOf', { time: data.asOf })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/admin/inventory/products"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--text-muted)]/10"
          >
            {t('newProduct')}
          </Link>
          <Link
            href="/admin/inventory/batches"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-[filter,transform] hover:brightness-110 active:translate-y-px"
          >
            {t('receiveStock')}
          </Link>
        </div>
      </div>

      {/* ── the four figures ───────────────────────────────────────────────── */}
      <section aria-label={t('figures')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols4">
        <StatTile
          label={t('catalogue.title')}
          value={numberFormat.format(data.products)}
          hint={t('catalogue.body', { count: data.products })}
        />
        <StatTile
          label={t('batches.title')}
          value={numberFormat.format(data.batches)}
          hint={t('batches.body', { count: data.batches })}
        />
        <StatTile
          label={t('expiringLabel')}
          value={numberFormat.format(data.expiring)}
          hint={t('expiringHint')}
          tone={data.expiring > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t('quarantinedLabel')}
          value={numberFormat.format(data.quarantined)}
          hint={t('quarantinedHint')}
          tone={data.quarantined > 0 ? 'warn' : 'good'}
        />
      </section>

      {/* ── where the stock is, and what is about to expire ─────────────────── */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section
          aria-label={t('byLocation.title')}
          className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="pf-display flex items-center gap-2 text-sm font-semibold">
              {t('byLocation.title')}
            </h2>
            <span className="pf-mono text-[11px] text-[var(--text-muted)]">
              {numberFormat.format(data.zones.length)} {t('byLocation.zones')}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">{t('byLocation.title')}</caption>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/60">
                  <th scope="col" className="px-3 py-2 text-start text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('byLocation.zone')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('byLocation.units')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('byLocation.value')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('byLocation.expiry')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((zone) => (
                  <tr key={zone.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-3 py-2">
                      <span className="block font-medium">{zone.name}</span>
                      <span className="pf-mono block text-[11px] text-[var(--text-muted)]">
                        <Ltr>{zone.code}</Ltr>
                      </span>
                    </td>
                    <td className="pf-mono px-3 py-2 text-end tabular-nums">
                      {numberFormat.format(zone.units)}
                    </td>
                    <td className="pf-mono px-3 py-2 text-end tabular-nums">
                      {zone.units > 0 ? formatMoney(zone.valueMinor, { locale }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {zone.soonestDays === null ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <ExpiryBand days={zone.soonestDays} t={t} />
                      )}
                    </td>
                  </tr>
                ))}
                {data.zones.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-sm text-[var(--text-muted)]"
                    >
                      {t('byLocation.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── the lots that need attention first ───────────────────────────── */}
        <section
          aria-label={t('mostAtRisk.title')}
          className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="pf-display flex items-center gap-2 text-sm font-semibold">
              {t('mostAtRisk.title')}
            </h2>
            {data.atRisk.length > 0 ? (
              <Badge tone="warn" shape="circle">
                {t('mostAtRisk.shiftTriage')}
              </Badge>
            ) : null}
          </div>

          {data.atRisk.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--text-muted)]">
              {t('mostAtRisk.empty')}
            </p>
          ) : (
            <ul>
              {data.atRisk.map((lot) => (
                <li
                  key={lot.id}
                  className="border-b border-[var(--border)] px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="pf-mono text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                        {t('mostAtRisk.lot')}
                      </p>
                      <p className="mt-0.5 truncate font-medium">{lot.productName}</p>
                      <p className="pf-mono mt-1 text-[11px] text-[var(--text-muted)]">
                        <Ltr>{lot.lotNumber}</Ltr>
                      </p>
                    </div>
                    <ExpiryBand days={lot.days} t={t} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The days to expiry, as a band.
 *
 * Colour, a shape and the number. Three, not one: the number is the value, the
 * shape survives a greyscale printout, and the colour is the fastest read for
 * the person who already knows what they are looking at.
 */
function ExpiryBand({
  days,
  t,
}: {
  days: number;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}) {
  if (days < 0) {
    return (
      <Badge tone="bad" shape="triangle">
        {t('expired')}
      </Badge>
    );
  }
  if (days <= 7) {
    return (
      <Badge tone="bad" shape="triangle">
        {t('days', { days })}
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge tone="warn" shape="circle">
        {t('days', { days })}
      </Badge>
    );
  }
  return (
    <Badge tone="good" shape="diamond">
      {t('days', { days })}
    </Badge>
  );
}

function asRows<T>(result: { data: unknown } | null): T[] {
  return Array.isArray(result?.data) ? (result.data as T[]) : [];
}
