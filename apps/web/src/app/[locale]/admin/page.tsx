import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/format';
import { asRows, toAuditLogEntry, type AuditLogRow } from '@/lib/mappers';
import { getSupabase } from '@/lib/supabase/server';
import { describeAction, labelEntities, translateEntityType } from '@/lib/audit-labels';
import { GlassPanel, MetricTile } from '@/components/dashboard/glass';
import { DashboardMotion, LiftOnHover } from '@/components/dashboard/dashboard-motion';
import { DashboardBackdrop } from '@/components/dashboard/dashboard-backdrop';
import type { Locale } from '@/i18n/routing';

/**
 * The operations dashboard.
 *
 * ── what a dashboard is for, and what it is not ─────────────────────────────
 * It answers three questions in the first second: is anything about to expire, is
 * anything out of stock, and what is happening on the road today. Everything else on
 * the screen is one click from those three answers.
 *
 * What it is not is a design showcase with figures in it. Every number here is
 * read from the database as the signed-in user through RLS, so the page cannot show
 * a figure that is not true for this tenant, and an empty tenant shows zeros rather
 * than sample data -- a dashboard that lies about being empty is worse than one that
 * admits it.
 *
 * ── the numbers are rendered final, never tweened ───────────────────────────
 * See dashboard-motion.tsx. An animated figure is a figure whose value is still
 * changing when somebody reads it.
 *
 * ── the expiry window is a link, not a widget ───────────────────────────────
 * Changing the window is a navigation to the same page with a different range. That
 * means it works without JavaScript, survives a refresh, and can be sent to somebody
 * else as a URL -- which a client-side filter toggle cannot do.
 */

/** The ranges offered. Deliberately three: a day is noise, a year is too late. */
const WINDOWS = [30, 90, 180] as const;
type Window = (typeof WINDOWS)[number];

function parseWindow(raw: string | undefined): Window {
  const parsed = Number(raw);
  return (WINDOWS as readonly number[]).includes(parsed) ? (parsed as Window) : 90;
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
  // the audit vocabulary (entityTypes, systemActor, auditFootnote) lives in `m0`.
  //
  // The audit vocabulary:
  // Not in `dashboard` and not in `auth`, and getting it wrong is silent in a way
  // that is easy to ship: next-intl renders a missing key as its own full path, so
  // the log reads "updated a auth.entityTypes.products" and credits
  // "auth.systemActor" instead of naming a product and saying "System". It took two
  // wrong guesses to find, so the namespace is named here.
  const tGreeting = await getTranslations('auth');
  const tAudit = await getTranslations('m0');

  const session = await getSession();
  const { expiry } = await searchParams;
  const windowDays = parseWindow(expiry);

  const supabase = await getSupabase();
  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + windowDays);

  // ── the reads ──────────────────────────────────────────────────────────────
  //
  // Six queries, in one Promise.all. They are deliberately separate rather than one
  // view: each is a different question with a different shape, and a dashboard that
  // needs a view to exist before it can be read is a dashboard that cannot show a
  // partial answer when one query is slow.
  const [
    { data: productRows },
    { data: balanceRows },
    { data: expiringBatches },
    { data: quarantined },
    { data: awaitingApproval },
    { data: todaysRun },
    { data: auditRows },
  ] = await Promise.all([
    supabase.from('products').select('id, is_active').eq('is_active', true),
    supabase.from('stock_balances').select('qty_on_hand, qty_reserved'),
    supabase
      .from('batches')
      .select('id, expiry_date')
      .is('deleted_at', null)
      .eq('status', 'RELEASED')
      .lte('expiry_date', horizon.toISOString().slice(0, 10))
      .order('expiry_date', { ascending: true }),
    supabase.from('batches').select('id').eq('status', 'QUARANTINED').is('deleted_at', null),
    supabase.from('requisitions').select('id, code, requested_at, facility_id').eq('status', 'SUBMITTED'),
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

  const products = asRows<{ id: string; is_active: boolean }>(productRows);
  const balances = asRows<{ qty_on_hand: number; qty_reserved: number }>(balanceRows);
  const expiring = asRows<{ id: string; expiry_date: string }>(expiringBatches);
  const quarantinedCount = asRows<{ id: string }>(quarantined).length;
  const approvals = asRows<{ id: string; code: string; requested_at: string; facility_id: string }>(
    awaitingApproval,
  );
  const runRows = asRows<{ id: string; status: string; run_date: string }>(todaysRun);
  const run = runRows[0];

  const unitsOnHand = balances.reduce((sum, row) => sum + Number(row.qty_on_hand), 0);
  const unitsReserved = balances.reduce((sum, row) => sum + Number(row.qty_reserved), 0);

  // The stops for today's run, in the order they will be driven.
  const stops = run
    ? asRows<{ id: string; sequence: number; status: string; facility_id: string }>(
        (
          await supabase
            .from('delivery_stops')
            .select('id, sequence, status, facility_id')
            .eq('trip_id', run.id)
            .order('sequence', { ascending: true })
        ).data,
      )
    : [];

  // Facility names for the run strip and the approval list, in one read rather than
  // one per row. Without it every stop reads as a uuid, which is not a place.
  const facilityIds = [
    ...new Set([
      ...stops.map((stop) => stop.facility_id),
      ...approvals.map((approval) => approval.facility_id),
    ]),
  ];
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id, name_en, name_ar, code')
    .in('id', facilityIds.length > 0 ? facilityIds : ['00000000-0000-0000-0000-000000000000']);

  const facilityName = new Map(
    asRows<{ id: string; name_en: string; name_ar: string | null; code: string }>(facilityRows).map(
      (facility) => [facility.id, locale === 'ar' ? (facility.name_ar ?? facility.name_en) : facility.name_en],
    ),
  );

  const entries = asRows<AuditLogRow>(auditRows).map(toAuditLogEntry);
  const entityLabels = await labelEntities(entries, locale);

  const delivered = stops.filter((stop) => stop.status === 'DELIVERED').length;
  const remaining = stops.length - delivered;

  const numberFormat = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB');

  return (
    <>
      <DashboardBackdrop />

      <DashboardMotion>
        <div className="space-y-6">
          <header data-reveal className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{tNav('dashboard')}</h1>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                {tGreeting('welcome', {
                  // The Arabic name on the Arabic page. whoami has returned
                  // full_name_ar since migration 0015, and the greeting ignored it,
                  // so a person's name was spelled in Latin script on an Arabic screen.
                  name:
                    locale === 'ar'
                      ? (session?.fullNameAr ?? session?.fullName ?? '')
                      : (session?.fullName ?? ''),
                })}
              </p>
            </div>

            <GlassPanel interactive className="px-3 py-2" as="div">
              <span className="me-2 text-xs text-[color:var(--text-muted)]">{t('expiryWindow')}</span>
              {/* A group of links rather than a <select>: each is a real URL, so the
                  window survives a refresh and can be sent to a colleague. */}
              <span className="inline-flex gap-1" role="group" aria-label={t('expiryWindow')}>
                {WINDOWS.map((days) => (
                  <Link
                    key={days}
                    href={`/${locale}/admin?expiry=${days}`}
                    // Three variants of the page already on screen. Prefetching them
                    // re-runs this route's seven queries three times over, to prove
                    // something the user can see by clicking.
                    prefetch={false}
                    aria-current={days === windowDays ? 'true' : undefined}
                    className={`rounded-md px-2 py-1 text-xs font-medium tabular ${
                      days === windowDays
                        ? 'bg-[color:var(--color-brand-600)] text-white'
                        : 'hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    {numberFormat.format(days)}
                  </Link>
                ))}
              </span>
            </GlassPanel>
          </header>

          {/* ── the three questions ─────────────────────────────────────────── */}
          <section aria-label={t('figures')} className="pf-dash">
            <div data-reveal>
              <LiftOnHover>
                <MetricTile
                  label={t('unitsOnHand')}
                  value={numberFormat.format(unitsOnHand)}
                  hint={t('reserved', { n: numberFormat.format(unitsReserved) })}
                  tone="neutral"
                />
              </LiftOnHover>
            </div>

            <div data-reveal>
              <LiftOnHover>
                <MetricTile
                  label={t('expiring')}
                  // The window is named in the figure rather than only in the
                  // heading: "12" under "Expiring soon" is a number somebody has to
                  // interpret, and 12 of what, over how long, is the actual fact.
                  value={numberFormat.format(expiring.length)}
                  hint={t('withinDays', { n: numberFormat.format(windowDays) })}
                  tone={expiring.length > 0 ? 'warn' : 'good'}
                />
              </LiftOnHover>
            </div>

            <div data-reveal>
              <LiftOnHover>
                <MetricTile
                  label={t('quarantined')}
                  value={numberFormat.format(quarantinedCount)}
                  hint={t('quarantinedHint')}
                  tone={quarantinedCount > 0 ? 'bad' : 'good'}
                />
              </LiftOnHover>
            </div>

            <div data-reveal>
              <LiftOnHover>
                <MetricTile
                  label={t('awaitingApproval')}
                  value={numberFormat.format(approvals.length)}
                  hint={t('awaitingHint')}
                  tone={approvals.length > 0 ? 'warn' : 'good'}
                />
              </LiftOnHover>
            </div>

            <div data-reveal>
              <LiftOnHover>
                <MetricTile
                  label={t('activeProducts')}
                  value={numberFormat.format(products.length)}
                  hint={t('activeProductsHint')}
                  tone="neutral"
                />
              </LiftOnHover>
            </div>
          </section>

          {/* ── today on the road ──────────────────────────────────────────── */}
          <section data-reveal aria-labelledby="run-heading" className="pf-dash">
            <GlassPanel className="pf-dash__span-2 p-5" as="section">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="run-heading" className="pf-section-title">
                  {t('todaysRun')}
                </h2>
                {run && (
                  <Link
                    href={`/${locale}/admin/deliveries`}
                    // Two drill-through links from the dashboard. Prefetching a
                    // route costs its full query set, and these are choices made from
                    // the figures on screen rather than the first thing anybody clicks.
                    prefetch={false}
                    className="text-xs font-medium text-[color:var(--color-brand-600)] underline dark:text-[color:var(--color-brand-100)]"
                  >
                    {t('openDeliveries')}
                  </Link>
                )}
              </div>

              {!run ? (
                <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('noRunToday')}</p>
              ) : (
                <>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">{t(`deliveries.status.trip.${run.status}`)}</span>
                    <span className="ms-2 text-[color:var(--text-muted)]">
                      {t('deliveredOf', {
                        done: numberFormat.format(delivered),
                        total: numberFormat.format(stops.length),
                      })}
                    </span>
                  </p>

                  {stops.length > 0 ? (
                    <ul className="pf-beads mt-4" aria-label={t('stops')}>
                      {stops.map((stop) => (
                        <li key={stop.id} className={`pf-bead pf-bead--${stop.status}`}>
                          <span className="pf-bead__dot" aria-hidden />
                          <span className="tabular">{stop.sequence}</span>
                          <span>{facilityName.get(stop.facility_id) ?? '—'}</span>
                          <span className="sr-only">
                            {t(`deliveries.status.stop.${stop.status}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('noStops')}</p>
                  )}

                  {remaining > 0 && (
                    <p className="mt-4 text-sm text-[color:var(--text-muted)]">
                      {t('stopsRemaining', { n: numberFormat.format(remaining) })}
                    </p>
                  )}
                </>
              )}
            </GlassPanel>

            {/* ── waiting on a decision ───────────────────────────────────── */}
            <GlassPanel className="p-5" as="section">
              <h2 className="pf-section-title">{t('waitingOnYou')}</h2>

              {approvals.length === 0 ? (
                <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('nothingWaiting')}</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {approvals.slice(0, 5).map((approval) => (
                    <li key={approval.id} className="py-2 text-sm">
                      <span className="font-medium">{approval.code}</span>
                      <span className="ms-2 text-[color:var(--text-muted)]">
                        {facilityName.get(approval.facility_id) ?? '—'}
                      </span>
                      <span className="ms-auto text-xs text-[color:var(--text-muted)]">
                        {timeAgo(approval.requested_at, today, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                href={`/${locale}/admin/inventory/requisitions`}
                    // Two drill-through links from the dashboard. Prefetching a
                    // route costs its full query set, and these are choices made from
                    // the figures on screen rather than the first thing anybody clicks.
                    prefetch={false}
                className="mt-3 inline-block text-xs font-medium text-[color:var(--color-brand-600)] underline dark:text-[color:var(--color-brand-100)]"
              >
                {t('openRequisitions')}
              </Link>
            </GlassPanel>
          </section>

          {/* ── what changed ───────────────────────────────────────────────── */}
          <section data-reveal aria-labelledby="audit-heading">
            <GlassPanel className="p-5" as="section">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="audit-heading" className="pf-section-title">
                  {tNav('audit')}
                </h2>
                <span className="text-xs text-[color:var(--text-muted)]">{tAudit('auditFootnote')}</span>
              </div>

              {entries.length === 0 ? (
                <p className="mt-3 text-sm text-[color:var(--text-muted)]">{t('auditEmpty')}</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                      {/*
                        "facilities.insert" is a database detail, not a sentence. It is
                        rendered as a verb plus a translated noun, because an audit log is
                        read by somebody asking "who changed what" -- and
                        `facilities.insert` answers neither half of that question.
                      */}
                      <span className="text-xs">{describeAction(entry.action, tAudit, locale)}</span>
                      <span className="text-[color:var(--text-muted)]">
                        {translateEntityType(entry.entityType, tAudit, locale)}
                        {entry.entityId
                          ? ` · ${
                              // The short id is a fallback, not the normal case: it appears
                              // only when the row has been deleted or its type is not one
                              // the resolver knows, which are exactly the cases where an
                              // identifier is all there is to show.
                              entityLabels.get(`${entry.entityType}:${entry.entityId}`) ??
                              entry.entityId.slice(0, 8)
                            }`
                          : ''}
                      </span>
                      <span className="ms-auto text-xs text-[color:var(--text-muted)]">
                        {entry.actorLabel ?? tAudit('systemActor')} ·{' '}
                        {timeAgo(entry.occurredAt, today, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </section>
        </div>
      </DashboardMotion>
    </>
  );
}