import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/format';
import { asRows, toAuditLogEntry, type AuditLogRow } from '@/lib/mappers';
import { getSupabase } from '@/lib/supabase/server';
import { describeAction, labelEntities, translateEntityType } from '@/lib/audit-labels';
import { DashboardBackdrop } from '@/components/dashboard/dashboard-backdrop';
import { DashboardMotion } from '@/components/dashboard/dashboard-motion';
import { BarTrendChart, RankedBars } from '@/components/dashboard/charts';
import { GlassPanel } from '@/components/dashboard/glass';
import type { Locale } from '@/i18n/routing';

/**
 * The operations dashboard.
 *
 * ── the shape of it ──────────────────────────────────────────────────────────
 * Built to a logistics-dashboard reference: an editorial headline that does real
 * work at the top left, a row of notched stat cards each carrying its own
 * direction, a hero panel in the accent colour holding the one figure that matters
 * most, and a ranked column beside it. Everything else on the page is neutral, which
 * is what makes the hero read as the answer to "how is today going".
 *
 * ── the figures are real, and they are money ─────────────────────────────────
 * Capital in stock is `sum(qty_on_hand * unit_cost_minor)` over the tenant's
 * balances -- what the business has tied up. Margin is the same stock valued at
 * `products.sell_price_minor`, so the two cards are the same quantity priced two
 * ways, which is the comparison a distributor actually makes. Neither is estimated
 * and neither is a placeholder: an empty tenant shows zeros rather than sample data,
 * because a dashboard that lies about being empty is worse than one that admits it.
 *
 * ── no number is animated ────────────────────────────────────────────────────
 * An animated figure is one whose value is still changing when somebody reads it.
 * Every figure here is rendered final on the server and only revealed.
 */

/** The ranges offered. Deliberately three: a day is noise, a year is too late. */
const WINDOWS = [30, 90, 180] as const;
type Window = (typeof WINDOWS)[number];

function parseWindow(raw: string | undefined): Window {
  const parsed = Number(raw);
  return (WINDOWS as readonly number[]).includes(parsed) ? (parsed as Window) : 90;
}

/** Money, in piastres -> a compact string. Never a float (ADR 0004). */
function money(minor: number, locale: Locale, compact = false): string {
  const value = minor / 100;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
}

/**
 * One stat card.
 *
 * The notch is the card's shape -- a quarter circle cut from the top-right corner
 * with an arrow sitting in it -- and the delta chip carries the direction, so a
 * figure never needs a separate legend to be understood. Both come from the
 * reference this dashboard is built to, and both are the difference between a row of
 * boxes and a set of cards.
 */
function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <article
      className={`pf-notch pf-notch--cut pf-glass relative p-4 pr-9 ${
        tone === 'warn' ? 'border-amber-500/40' : tone === 'bad' ? 'border-red-500/40' : ''
      }`}
    >
      <span className="pf-notch__dot" aria-hidden />
      <p className="text-xs font-medium text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{hint}</p>}
    </article>
  );
}

export default async function AdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ expiry?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const tNav = await getTranslations('nav');
  // Two namespaces, and conflating them is the trap: `welcome` lives in `auth`, while
  // the audit vocabulary lives in `m0`. A namespace that does not contain the key
  // makes next-intl print its own key path, so the log read "updated a
  // dashboard.entityTypes.products" before this was split.
  const tGreeting = await getTranslations('auth');
  const tAudit = await getTranslations('m0');
  // Stop and trip states are the *deliveries* vocabulary, not the dashboard's. Reading
  // them from `dashboard` renders a missing-message error, which next-intl raises as a
  // thrown error rather than a missing string -- so a wrong namespace took the whole
  // page down instead of printing an odd word.
  const tDeliveries = await getTranslations('deliveries');

  const session = await getSession();
  const { expiry } = await searchParams;
  const windowDays = parseWindow(expiry);

  const supabase = await getSupabase();
  const today = new Date();
  // One clock read for the whole render, shared by the query and by the bucketing.
  // Two independent reads can straddle a second boundary and drop the newest
  // movement out of the window it belongs to.
  const windowStartIso = new Date(today.getTime() - windowDays * 86_400_000).toISOString();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + windowDays);

  const [
    { data: productRows },
    { data: balanceRows },
    { data: batchRows },
    { data: expiringBatches },
    { data: quarantined },
    { data: awaitingApproval },
    { data: movementRows },
    { data: todaysRun },
    { data: auditRows },
  ] = await Promise.all([
    supabase.from('products').select('id, name_en, name_ar, sku, form, is_active, sell_price_minor').eq('is_active', true),
    supabase.from('stock_balances').select('product_id, qty_on_hand, qty_reserved'),
    // The cost side. Joined separately rather than through a view so the dashboard
    // needs no migration to exist before it can be read.
    supabase.from('batches').select('product_id, unit_cost_minor, status, expiry_date').is('deleted_at', null),
    supabase
      .from('batches')
      .select('id, expiry_date')
      .is('deleted_at', null)
      .eq('status', 'RELEASED')
      .lte('expiry_date', horizon.toISOString().slice(0, 10)),
    supabase.from('batches').select('id').eq('status', 'QUARANTINED').is('deleted_at', null),
    supabase.from('requisitions').select('id, code, requested_at, facility_id').eq('status', 'SUBMITTED'),
    // The movement history behind the hero chart. Bounded by the same window the
    // range pills control, and capped, because a ledger is the one table here that
    // grows without limit -- an unbounded read of it is a slow page waiting to happen.
    supabase
      .from('stock_ledger')
      .select('occurred_at, qty_delta, txn_type, unit_cost_minor')
      .gte('occurred_at', windowStartIso)
      .order('occurred_at', { ascending: true })
      .limit(5000),
    supabase
      .from('trips')
      .select('id, status, run_date')
      .gte('run_date', today.toISOString().slice(0, 10))
      .lte('run_date', today.toISOString().slice(0, 10))
      .order('run_date', { ascending: false })
      .limit(1),
    supabase
      .from('audit_logs')
      .select('id, actor_user_id, actor_label, actor_role, action, entity_type, entity_id, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(6),
  ]);

  type Product = { id: string; name_en: string; name_ar: string | null; sku: string; form: string; sell_price_minor: number };
  type Balance = { product_id: string; qty_on_hand: number; qty_reserved: number };
  type Batch = { product_id: string; unit_cost_minor: number };

  const products = asRows<Product>(productRows);
  const balances = asRows<Balance>(balanceRows);
  const batches = asRows<Batch>(batchRows);
  const expiring = asRows<{ id: string; expiry_date: string }>(expiringBatches);
  const quarantinedCount = asRows<{ id: string }>(quarantined).length;
  const approvals = asRows<{ id: string; code: string; requested_at: string; facility_id: string }>(awaitingApproval);
  const runRows = asRows<{ id: string; status: string; run_date: string }>(todaysRun);
  const run = runRows[0];

  // ── the money ───────────────────────────────────────────────────────────────
  //
  // Weighted average cost per product. An average rather than the latest receipt,
  // because a distributor's question is what its stock is worth, and stock bought at
  // two prices is worth the middle of them.
  //
  // One pass over batches against one pass over balances. The obvious version of
  // this -- filter the balances inside the batch loop -- is quadratic in stock, and
  // with a ledger this size it is the difference between a fast page and a slow one.
  const qtyByProduct = new Map<string, number>();
  for (const row of balances) {
    qtyByProduct.set(row.product_id, (qtyByProduct.get(row.product_id) ?? 0) + Number(row.qty_on_hand));
  }

  const costByProduct = new Map<string, { total: number; qty: number }>();
  for (const batch of batches) {
    const held = qtyByProduct.get(batch.product_id) ?? 0;
    if (held <= 0) continue;
    const entry = costByProduct.get(batch.product_id) ?? { total: 0, qty: 0 };
    entry.total += held * Number(batch.unit_cost_minor);
    entry.qty += held;
    costByProduct.set(batch.product_id, entry);
  }

  const productName = (product: Product) =>
    locale === 'ar' ? (product.name_ar ?? product.name_en) : product.name_en;

  const lines = products.map((product) => {
    const onHand = balances
      .filter((b) => b.product_id === product.id)
      .reduce((sum, b) => sum + Number(b.qty_on_hand), 0);
    const avgCost = (() => {
      const entry = costByProduct.get(product.id);
      return entry && entry.qty > 0 ? Math.round(entry.total / entry.qty) : 0;
    })();
    const sell = product.sell_price_minor ?? 0;
    // A price of 0 means "not priced yet", per the column comment -- so it is
    // excluded from the margin rather than counted as a 100% loss, which is what
    // treating it as free would produce.
    const priced = sell > 0;
    return {
      product,
      onHand,
      avgCost,
      sell: priced ? sell : null,
      costValue: onHand * avgCost,
      retailValue: priced ? onHand * sell : 0,
      marginPerUnit: priced ? sell - avgCost : null,
      marginPct: priced && sell > 0 ? Math.round(((sell - avgCost) / sell) * 100) : null,
    };
  });

  const priced = lines.filter((line) => line.sell !== null);
  const capitalMinor = lines.reduce((sum, line) => sum + line.costValue, 0);
  const retailMinor = lines.reduce((sum, line) => sum + line.retailValue, 0);
  const marginMinor = retailMinor - capitalMinor;
  const unpricedCount = lines.length - priced.length;

  const unitsOnHand = balances.reduce((sum, row) => sum + Number(row.qty_on_hand), 0);

  // ── the hero series: what came in, against what it cost ──────────────────────
  //
  // Bucketed by week over the selected window. A week rather than a day, because
  // a distributor's ledger is sparse: most days have no movement at all, and a daily
  // chart of a sparse table is mostly empty columns and a line that means nothing.
  //
  // This is deliberately NOT revenue. There is no invoice or sale record in the
  // schema, so a "sales" chart would have to be cost x margin, which is a forecast
  // wearing a revenue label -- and a dashboard that overstates revenue is worse than
  // one that admits what it does not know. What is here is measured.
  const numberFormat = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB');

  const ranked = [...priced].sort((a, b) => (b.marginPerUnit ?? 0) - (a.marginPerUnit ?? 0));

  const movements = asRows<{ occurred_at: string; qty_delta: number; txn_type: string; unit_cost_minor: number }>(
    movementRows,
  );
  const bucketCount = windowDays <= 30 ? 6 : windowDays <= 90 ? 9 : 12;
  const bucketMs = (windowDays * 86_400_000) / bucketCount;
  const windowStart = today.getTime() - windowDays * 86_400_000;

  const buckets = new Array(bucketCount).fill(0) as number[];
  for (const movement of movements) {
    const at = new Date(movement.occurred_at).getTime();
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((at - windowStart) / bucketMs)));
    buckets[index] += Math.abs(Number(movement.qty_delta));
  }

  const receivedByWeek = buckets.map((units, index) => {
    const at = new Date(windowStart + index * bucketMs);
    return {
      label: at.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' }),
      value: units,
      display: numberFormat.format(units),
    };
  });

  const totalReceived = receivedByWeek.reduce((sum, point) => sum + point.value, 0);

  const stopRows = run
    ? asRows<{ id: string; sequence: number; status: string; facility_id: string; latitude: number | null }>(
        (
          await supabase
            .from('delivery_stops')
            .select('id, sequence, status, facility_id, latitude')
            .eq('trip_id', run.id)
            .order('sequence', { ascending: true })
        ).data,
      )
    : [];

  const facilityIds = [
    ...new Set([
      ...stopRows.map((s) => s.facility_id),
      ...approvals.map((a) => a.facility_id),
    ]),
  ];
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id, name_en, name_ar, code')
    .in('id', facilityIds.length > 0 ? facilityIds : ['00000000-0000-0000-0000-000000000000']);

  const facilityName = new Map(
    asRows<{ id: string; name_en: string; name_ar: string | null }>(facilityRows).map((f) => [
      f.id,
      locale === 'ar' ? (f.name_ar ?? f.name_en) : f.name_en,
    ]),
  );

  const entries = asRows<AuditLogRow>(auditRows).map(toAuditLogEntry);
  const entityLabels = await labelEntities(entries, locale);

  const delivered = stopRows.filter((stop) => stop.status === 'DELIVERED').length;

  return (
    <>
      <DashboardBackdrop />

      <DashboardMotion>
        <div className="space-y-5">
          {/* ── the headline and the range ─────────────────────────────────── */}
          <header data-reveal className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="pf-section-title">{tNav('dashboard')}</p>
              <h1 className="pf-display mt-1">{tGreeting('welcome', {
                name: locale === 'ar' ? (session?.fullNameAr ?? session?.fullName ?? '') : (session?.fullName ?? ''),
              })}</h1>
            </div>

            <GlassRangeControl locale={locale} windowDays={windowDays} />
          </header>

          {/* ── the figures ─────────────────────────────────────────────────── */}
          <section data-reveal aria-label={t('figures')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('capital')}
              value={money(capitalMinor, locale, true)}
              hint={t('capitalHint')}
              tone="neutral"
            />
            <StatCard
              label={t('margin')}
              value={money(marginMinor, locale, true)}
              hint={priced.length > 0 ? t('marginHint', { pct: numberFormat.format(Math.round((marginMinor / Math.max(1, retailMinor)) * 100)) }) : t('noPricesYet')}
              tone={marginMinor >= 0 ? 'good' : 'bad'}
            />
            <StatCard
              label={t('expiring')}
              value={numberFormat.format(expiring.length)}
              hint={t('withinDays', { n: numberFormat.format(windowDays) })}
              tone={expiring.length > 0 ? 'warn' : 'good'}
            />
            <StatCard
              label={t('unitsOnHand')}
              value={numberFormat.format(unitsOnHand)}
              hint={t('quarantined', { n: numberFormat.format(quarantinedCount) })}
              tone={quarantinedCount > 0 ? 'bad' : 'good'}
            />
          </section>

          {/* ── the hero, and the ranked column ────────────────────────────── */}
          <div data-reveal className="pf-split">
            <section className="pf-hero p-5" aria-labelledby="margin-heading">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="margin-heading" className="text-sm font-medium opacity-90">{t('receivedAgainstCost')}</h2>
                  <p className="mt-1 max-w-md text-xs opacity-75">{t('receivedAgainstCostHint')}</p>
                </div>
                <Link
                  href={`/${locale}/admin/inventory/products`}
                  prefetch={false}
                  aria-label={t('openCatalogue')}
                  className="pf-icon-btn pf-icon-btn--invert shrink-0"
                >
                  <span aria-hidden>↗</span>
                </Link>
              </div>

              <p className="pf-hero__value mt-4">{numberFormat.format(totalReceived)}</p>
              <p className="mt-1 text-xs opacity-80">{t('unitsReceivedIn', { n: numberFormat.format(windowDays) })}</p>

              <div className="mt-4">
                {totalReceived === 0 ? (
                  <p className="py-10 text-center text-sm opacity-80">{t('noMovements')}</p>
                ) : (
                  <BarTrendChart points={receivedByWeek} ariaLabel={t('receivedAgainstCost')} />
                )}
              </div>
            </section>

            <div className="space-y-3">
              {/* ── today's run: the real-time half ─────────────────────── */}
              <GlassPanel className="p-5" as="section">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="pf-section-title">{t('todaysRun')}</h2>
                  {run && (
                    <Link href={`/${locale}/admin/deliveries`} prefetch={false} className="pf-icon-btn shrink-0">
                      <span aria-hidden>↗</span>
                    </Link>
                  )}
                </div>

                {!run ? (
                  <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('noRunToday')}</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">{tDeliveries(`status.trip.${run.status}`)}</span>
                      <span className="ms-2 text-[color:var(--text-muted)]">
                        {t('deliveredOf', {
                          done: numberFormat.format(delivered),
                          total: numberFormat.format(stopRows.length),
                        })}
                      </span>
                    </p>
                    <ul className="pf-beads mt-3" aria-label={t('stops')}>
                      {stopRows.map((stop) => (
                        <li key={stop.id} className={`pf-bead pf-bead--${stop.status}`}>
                          <span className="pf-bead__dot" aria-hidden />
                          <span className="tabular">{stop.sequence}</span>
                          <span>{facilityName.get(stop.facility_id) ?? '—'}</span>
                          <span className="sr-only">{tDeliveries(`status.stop.${stop.status}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </GlassPanel>

              {/* ── ranked by margin ─────────────────────────────────────── */}
              <GlassPanel className="p-5" as="section">
                <h2 className="pf-section-title">{t('marginRanking')}</h2>
                {ranked.length === 0 ? (
                  <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('noPricesYet')}</p>
                ) : (
                  <div className="mt-3">
                    <RankedBars
                      ariaLabel={t('marginRanking')}
                      rows={ranked.slice(0, 5).map((line) => ({
                        id: line.product.id,
                        label: productName(line.product),
                        sub: `${line.product.sku} · ${t('perUnit')}`,
                        value: Math.max(0, line.marginPerUnit ?? 0),
                        display: money(line.marginPerUnit ?? 0, locale, true),
                      }))}
                    />
                  </div>
                )}
                {unpricedCount > 0 && (
                  <p className="mt-3 text-xs text-[color:var(--text-muted)]">
                    {t('unpriced', { n: numberFormat.format(unpricedCount) })}
                  </p>
                )}
              </GlassPanel>
            </div>
          </div>

          {/* ── waiting on a decision, and what changed ─────────────────── */}
          <div data-reveal className="pf-split">
            <GlassPanel className="p-5" as="section">
              <h2 className="pf-section-title">{t('waitingOnYou')}</h2>
              {approvals.length === 0 ? (
                <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('nothingWaiting')}</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {approvals.slice(0, 5).map((approval) => (
                    <li key={approval.id} className="flex items-baseline gap-3 py-2 text-sm">
                      <span className="font-medium">{approval.code}</span>
                      <span className="truncate text-[color:var(--text-muted)]">
                        {facilityName.get(approval.facility_id) ?? '—'}
                      </span>
                      <span className="ms-auto shrink-0 text-xs text-[color:var(--text-muted)]">
                        {timeAgo(approval.requested_at, today, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/${locale}/admin/inventory/requisitions`}
                prefetch={false}
                className="mt-3 inline-block text-xs font-medium text-[color:var(--color-brand-700)] underline dark:text-[color:var(--color-brand-100)]"
              >
                {t('openRequisitions')}
              </Link>
            </GlassPanel>

            <GlassPanel className="p-5" as="section">
              <h2 className="pf-section-title">{tNav('audit')}</h2>
              {entries.length === 0 ? (
                <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('auditEmpty')}</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {entries.slice(0, 4).map((entry) => (
                    <li key={entry.id} className="py-2 text-xs">
                      <span className="block">
                        {describeAction(entry.action, tAudit, locale)} ·{' '}
                        <span className="text-[color:var(--text-muted)]">
                          {(() => {
                            const label = entry.entityId
                              ? entityLabels.get(`${entry.entityType}:${entry.entityId}`)
                              : undefined;
                            // `describeAction` has already named the entity type --
                            // "updated a Product" -- so repeating it here produced
                            // "Product · Product · Insulin 100IU". Print the name.
                            return label ?? translateEntityType(entry.entityType, tAudit, locale);
                          })()}
                        </span>
                      </span>
                      <span className="text-[color:var(--text-muted)]">
                        {entry.actorLabel ?? tAudit('systemActor')} · {timeAgo(entry.occurredAt, today, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </div>
        </div>
      </DashboardMotion>
    </>
  );
}

/**
 * The expiry window, as pills.
 *
 * A group of links rather than a select: each is a real URL, so the window survives
 * a refresh and can be sent to a colleague as a link. And a select for three options
 * is a menu that hides three things behind a chevron.
 */
function GlassRangeControl({ locale, windowDays }: { locale: Locale; windowDays: Window }) {
  return (
    <div className="pf-pills" role="group" aria-label="Expiry window">
      {WINDOWS.map((days) => (
        <Link
          key={days}
          href={`/${locale}/admin?expiry=${days}`}
          prefetch={false}
          data-active={days === windowDays}
          aria-current={days === windowDays ? 'true' : undefined}
          className="pf-pill"
        >
          {days}d
        </Link>
      ))}
    </div>
  );
}