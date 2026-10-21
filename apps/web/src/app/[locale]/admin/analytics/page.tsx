import { getTranslations, setRequestLocale } from 'next-intl/server';

import { asRows } from '@/lib/mappers';
import { getSupabase } from '@/lib/supabase/server';
import { MetricTile } from '@/components/dashboard/glass';
import { RankedBars, RankedBarsWithTable } from '@/components/dashboard/charts';
import { daysToExpiry, formatMoney, formatQuantity } from '@/lib/format';
import type { Locale } from '@/i18n/routing';

/**
 * M5 analytics: what the stock is worth, what is about to expire, and what is not moving.
 *
 * ### Why these three and not a revenue number
 *
 * Every figure on this page is derived from two tables the system already treats as
 * authoritative -- stock_balances for what exists now, stock_ledger for how it got there
 * -- and every one of them can be reconciled against the other. There is deliberately no
 * revenue, no "value delivered" and no profit series here, because the system has no
 * invoice or sale-allocation record and a revenue figure without one would be an
 * invention wearing a number's clothes. The dashboard's delivered-margin hero already
 * makes this point by showing zero honestly; this page takes the same position by not
 * offering the metric at all.
 *
 * What a warehouse manager can act on without an invoice ledger is real, though, and it
 * is what this page is for: capital sitting in stock that will not sell, capital sitting
 * in stock that will expire, and stock that is about to run out.
 *
 * ### Reads go through RLS, not a function
 *
 * Every query here is a plain table read through the caller's own session, so tenant
 * isolation is the same RLS policy that protects the dashboard. Adding SECURITY DEFINER
 * RPCs would have been easier to write and would have put forty more definer functions
 * on /rest/v1/rpc/ -- attack surface bought for no isolation the tables do not already
 * provide. See the note on the blind spot in supabase/tests/rls_coverage.test.sql.
 */

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('analytics');
  const tNav = await getTranslations('nav');

  // No session lookup here, and deliberately: this page has no actions and no
  // role-dependent UI, so a role check would be a branch with one arm. Authentication and
  // surface authorisation are already enforced by the (locale)/admin/layout.tsx
  // AuthenticatedShell, which redirects anonymous visitors and 404s the wrong role
  // before this component is ever reached.
  const supabase = await getSupabase();

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000).toISOString();

  // Destructure `.data` here. Assigning the awaited builder instead yields the whole
  // PostgrestResponse, which `asRows` then rejects as "not an array" -- so every query
  // silently became zero rows with no error anywhere. The dashboard does this correctly;
  // this is the same mistake typed out again.
  const [{ data: balanceRows }, { data: batchRows }, { data: productRows }, { data: issueRows }] =
    await Promise.all([
      supabase.from('stock_balances').select('product_id, batch_id, qty_on_hand'),
      // The cost and expiry side. `deleted_at` matters: a deleted batch is not inventory,
      // and letting one into a valuation would silently overstate it.
      supabase
        .from('batches')
        .select('id, product_id, unit_cost_minor, status, expiry_date')
        .is('deleted_at', null),
      supabase.from('products').select('id, sku, name_en, name_ar, form, is_active'),
      // Consumption, from issues only. Receipts are not usage, and counting them would
      // make every product look like it moves.
      supabase
        .from('stock_ledger')
        .select('product_id, qty_delta, unit_cost_minor, occurred_at')
        .lt('qty_delta', 0)
        .gte('occurred_at', thirtyDaysAgo),

  ]);

  type Product = {
    id: string;
    sku: string;
    name_en: string;
    name_ar: string | null;
    form: string | null;
    is_active: boolean;
  };
  type Balance = { product_id: string; batch_id: string; qty_on_hand: number };
  type Batch = {
    id: string;
    product_id: string;
    unit_cost_minor: number | null;
    status: string;
    expiry_date: string;
  };

  const products = asRows<Product>(productRows);
  const balances = asRows<Balance>(balanceRows);
  const batches = asRows<Batch>(batchRows);
  const issues = asRows<{
    product_id: string;
    qty_delta: number;
    unit_cost_minor: number | null;
    occurred_at: string;
  }>(issueRows);

  const productById = new Map(products.map((p) => [p.id, p]));
  const batchById = new Map(batches.map((b) => [b.id, b]));

  // ── units issued per product over the trailing 30 days ─────────────────────
  // qty_delta is negative for an issue, so the negation is what makes this a count of
  // units that left the warehouse rather than a sum of negative numbers.
  const usedByProduct = new Map<string, number>();
  for (const row of issues) {
    usedByProduct.set(
      row.product_id,
      (usedByProduct.get(row.product_id) ?? 0) + Math.abs(row.qty_delta),
    );
  }

  // ── per-product position ───────────────────────────────────────────────────
  type Line = {
    productId: string;
    sku: string;
    name: string;
    onHand: number;
    used30d: number;
    daysOfCover: number | null;
    valueMinor: number;
    expiringValueMinor: number;
    dead: boolean;
  };

  const lines: Line[] = [];
  for (const balance of balances) {
    // Zero and negative balances are not stock. Summing them would net a write-off
    // against real holdings and understate the valuation.
    if (balance.qty_on_hand <= 0) continue;

    const batch = batchById.get(balance.batch_id);
    const product = productById.get(balance.product_id);
    if (!batch || !product) continue;

    // An unpriced batch still occupies shelf space and still expires. Valuing it at zero
    // would hide it from the expiry section, which is the one place it matters most, so
    // it is counted at zero value and still reported as expiring.
    const unitCost = batch.unit_cost_minor ?? 0;
    const valueMinor = balance.qty_on_hand * unitCost;

    const daysLeft = daysToExpiry(batch.expiry_date, today);
    const expiring = batch.status === 'RELEASED' && daysLeft <= 90;

    const used30d = usedByProduct.get(balance.product_id) ?? 0;
    lines.push({
      productId: balance.product_id,
      sku: product.sku,
      name: (locale === 'ar' ? (product.name_ar ?? product.name_en) : product.name_en),
      onHand: balance.qty_on_hand,
      used30d,
      // Linear extrapolation from 30 days. Null rather than Infinity when nothing has
      // moved, because "infinite cover" is a different statement from "no data", and
      // only one of them is true.
      daysOfCover:
        used30d > 0 ? Math.round((balance.qty_on_hand / (used30d / 30)) * 10) / 10 : null,
      valueMinor,
      expiringValueMinor: expiring ? valueMinor : 0,
      dead: used30d === 0,
    });
  }

  // Collapse to one row per product: a product can sit on several batches, and a table
  // with two rows for the same SKU answers no question a manager asked.
  const byProduct = new Map<string, Line>();
  for (const line of lines) {
    const existing = byProduct.get(line.productId);
    if (!existing) {
      byProduct.set(line.productId, { ...line });
      continue;
    }
    existing.onHand += line.onHand;
    existing.valueMinor += line.valueMinor;
    existing.expiringValueMinor += line.expiringValueMinor;
    existing.used30d = Math.max(existing.used30d, line.used30d);
    existing.dead = existing.used30d === 0;
    existing.daysOfCover =
      existing.used30d > 0
        ? Math.round((existing.onHand / (existing.used30d / 30)) * 10) / 10
        : null;
  }

  const all = [...byProduct.values()];

  const inventoryValueMinor = all.reduce((sum, l) => sum + l.valueMinor, 0);
  const expiringValueMinor = all.reduce((sum, l) => sum + l.expiringValueMinor, 0);
  const dead = all.filter((l) => l.dead);
  const deadValueMinor = dead.reduce((sum, l) => sum + l.valueMinor, 0);
  // Fourteen days is the reorder conversation, not a statistical threshold: it is about
  // how long a replenishment lead time takes to arrive.
  const runningLow = all.filter((l) => l.daysOfCover !== null && l.daysOfCover < 14);

  // Worst first, because that is the order a manager acts in. Dead stock is the worst
  // answer to have: capital that will not move at all.
  const ranked = [...all].sort((a, b) => {
    if (a.dead !== b.dead) return a.dead ? -1 : 1;
    const aCover = a.daysOfCover ?? Number.POSITIVE_INFINITY;
    const bCover = b.daysOfCover ?? Number.POSITIVE_INFINITY;
    return aCover - bCover;
  });

  // ── expiry, by value, at three horizons ────────────────────────────────────
  const horizons = [30, 60, 90] as const;

  // Horizon buckets need batch-level detail, which the per-product line has already
  // lost. Recompute from the balances directly rather than pretend the line can answer
  // it.
  const expiryByHorizon = new Map<number, number>();
  for (const balance of balances) {
    if (balance.qty_on_hand <= 0) continue;
    const batch = batchById.get(balance.batch_id);
    if (!batch || batch.status !== 'RELEASED') continue;
    const days = daysToExpiry(batch.expiry_date, today);
    if (days === null) continue;
    for (const horizon of horizons) {
      if (days <= horizon) {
        expiryByHorizon.set(
          horizon,
          (expiryByHorizon.get(horizon) ?? 0) + balance.qty_on_hand * (batch.unit_cost_minor ?? 0),
        );
      }
    }
  }

  const expiryRanked = horizons.map((days) => {
    const value = expiryByHorizon.get(days) ?? 0;
    return {
      id: String(days),
      label: t('expiryWithin', { days }),
      value,
      display: formatMoney(value, { locale }),
    };
  });

  const money = (minor: number) => formatMoney(minor, { locale });

  return (
    <div className="space-y-5">
      <header>
        <p className="pf-section-title">{tNav('analytics')}</p>
        <h1 className="pf-display mt-1">{t('title')}</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
      </header>

      {/* Four numbers, because the first question is always "is anything wrong" and the
          answer is a count of things, not a chart. */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* The one figure on this page that has an exact right answer, so it carries the
            raw piastres alongside the rendered string. A test can reconcile it against
            the balances without parsing a currency symbol out of a localised number. */}
        <div data-testid="inventory-value" data-minor={inventoryValueMinor}>
          <MetricTile
            label={t('inventoryValue')}
            value={money(inventoryValueMinor)}
            hint={t('inventoryValueHint', { products: all.length })}
          />
        </div>
        <MetricTile
          label={t('expiringValue')}
          value={money(expiringValueMinor)}
          hint={t('expiringValueHint')}
          tone={expiringValueMinor > 0 ? 'warn' : 'good'}
        />
        <MetricTile
          label={t('deadStockValue')}
          value={money(deadValueMinor)}
          hint={t('deadStockValueHint', { products: dead.length })}
          tone={dead.length > 0 ? 'warn' : 'good'}
        />
        <MetricTile
          label={t('runningLow')}
          value={formatQuantity(runningLow.length, { locale })}
          hint={t('runningLowHint')}
          tone={runningLow.length > 0 ? 'bad' : 'good'}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* The table is the page. Everything else is a summary of it. */}
        <section className="pf-glass rounded-2xl p-4">
          <h2 className="pf-section-title">{t('coverageTitle')}</h2>
          <p className="mt-1 mb-3 text-xs text-[color:var(--text-muted)]">
            {t('coverageSubtitle')}
          </p>

          {ranked.length === 0 ? (
            <p className="py-6 text-center text-sm text-[color:var(--text-muted)]">
              {t('noStock')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="coverage-table">
                <thead>
                  <tr className="border-b border-current/10 text-left text-xs text-[color:var(--text-muted)]">
                    <th scope="col" className="py-2 pe-3 font-medium">
                      {t('product')}
                    </th>
                    <th scope="col" className="py-2 px-3 text-end font-medium">
                      {t('onHand')}
                    </th>
                    <th scope="col" className="py-2 px-3 text-end font-medium">
                      {t('used30d')}
                    </th>
                    <th scope="col" className="py-2 px-3 text-end font-medium">
                      {t('daysOfCover')}
                    </th>
                    <th scope="col" className="py-2 ps-3 text-end font-medium">
                      {t('value')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((line) => (
                    <tr
                      key={line.productId}
                      className="border-b border-current/5 last:border-0"
                      data-dead={line.dead ? 'true' : undefined}
                      data-value-minor={line.valueMinor}
                      data-on-hand={line.onHand}
                    >
                      <th scope="row" className="py-2 pe-3 text-start font-normal">
                        <span className="block truncate font-medium">{line.name}</span>
                        <span className="block truncate text-xs text-[color:var(--text-muted)]">
                          {line.sku}
                        </span>
                      </th>
                      <td className="tabular px-3 text-end">
                        {formatQuantity(line.onHand, { locale })}
                      </td>
                      <td className="tabular px-3 text-end text-[color:var(--text-muted)]">
                        {formatQuantity(line.used30d, { locale })}
                      </td>
                      <td className="tabular px-3 text-end">
                        {line.dead ? (
                          <span className="text-[color:var(--color-warn)]">{t('notMoving')}</span>
                        ) : (
                          formatQuantity(line.daysOfCover ?? 0, { locale })
                        )}
                      </td>
                      <td className="tabular ps-3 text-end">{money(line.valueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="pf-glass rounded-2xl p-4">
            <h2 className="pf-section-title">{t('expiryTitle')}</h2>
            <p className="mt-1 mb-3 text-xs text-[color:var(--text-muted)]">
              {t('expirySubtitle')}
            </p>
            <RankedBarsWithTable
              rows={expiryRanked}
              ariaLabel={t('expiryTitle')}
              tableLabel={t('value')}
              showLabel={t('showNumbers')}
            />
          </section>

          <section className="pf-glass rounded-2xl p-4">
            <h2 className="pf-section-title">{t('deadTitle')}</h2>
            <p className="mt-1 mb-3 text-xs text-[color:var(--text-muted)]">
              {t('deadSubtitle')}
            </p>
            {dead.length === 0 ? (
              <p className="text-sm text-[color:var(--text-muted)]">{t('deadNone')}</p>
            ) : (
              <RankedBarsWithTable
                ariaLabel={t('deadTitle')}
                tableLabel={t('value')}
                showLabel={t('showNumbers')}
                rows={[...dead]
                  .sort((a, b) => b.valueMinor - a.valueMinor)
                  .slice(0, 6)
                  .map((line) => ({
                    id: line.productId,
                    label: line.name,
                    sub: t('unitsHeld', { n: formatQuantity(line.onHand, { locale }) }),
                    value: line.valueMinor,
                    display: money(line.valueMinor),
                  }))}
              />
            )}
          </section>
        </div>
      </div>

      <p className="text-xs text-[color:var(--text-muted)]">{t('footnote')}</p>
    </div>
  );
}
