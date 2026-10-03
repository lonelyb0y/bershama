import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase/server';
import { asRows } from '@/lib/mappers';
import type { Database } from '@/lib/database.types';
import type { Locale } from '@/i18n/routing';
import { AlertList } from './alert-list';
import { AlertScanButton } from './alert-scan';
import type { AlertRow } from './alert-list';

/**
 * The alert centre.
 *
 * ── what this is for ───────────────────────────────────────────────────────────
 *
 * A warehouse manager has two questions that nothing else on the dashboard answers:
 * *what is wrong right now*, and *what did I already deal with*. This page is the
 * first, and the open count on the dashboard is the same answer in one number.
 *
 * ── the severity scale is three states, and they mean different things ──────────
 *
 * `INFO` is a thing to know about. `WARN` is a thing to do this week. `CRITICAL` is
 * expired stock, or stock that cannot be trusted, and it is the only one that should
 * ever page anybody. Collapsing them into "important" is how an alert centre becomes
 * wallpaper, so they are rendered as three visually distinct states and sorted worst
 * first rather than newest first.
 *
 * Newest-first is the wrong order for an operations list. A CRITICAL from four days
 * ago still outranks a fresh INFO, because the thing that needs doing has not been
 * done.
 *
 * ── resolved alerts are collapsed by default, not hidden ────────────────────────
 *
 * "Resolved" is a filter, not a delete. Someone auditing what happened to last
 * week's expiry alerts needs them, and an alert that vanishes on resolution leaves no
 * trace that it was ever raised.
 */

/** Open and acknowledged, worst first. Resolved is one click away. */
async function loadAlerts(): Promise<AlertRow[]> {
  const supabase = await getSupabase();

  const { data } = await supabase
    .from('alert_events')
    .select(
      'id, type, severity, status, entity_type, entity_id, message, data, occurrences, first_seen_at, last_seen_at',
    )
    .in('status', ['OPEN', 'ACK'])
    // Severity is an enum, so a text sort is alphabetical and useless. Ordered here
    // and sorted again below by an explicit rank, because Postgres cannot sort an enum
    // by a custom order and the browser should not be asked to.
    .order('first_seen_at', { ascending: false })
    .limit(200);

  return asRows<Database['public']['Tables']['alert_events']['Row']>(data).map((row) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    entityType: row.entity_type,
    entityId: row.entity_id,
    message: row.message,
    data: (row.data ?? {}) as Record<string, unknown>,
    occurrences: row.occurrences,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }));
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('alerts');
  const tNav = await getTranslations('nav');
  const { status, type } = await searchParams;

  const session = await getSession();
  const canAct = session?.role === 'WAREHOUSE_MANAGER' || session?.role === 'TENANT_ADMIN';

  let rows = await loadAlerts();

  if (status === 'all') {
    // "All" means including resolved, which is the audit view.
    const supabase = await getSupabase();
    const { data } = await supabase
      .from('alert_events')
      .select(
        'id, type, severity, status, entity_type, entity_id, message, data, occurrences, first_seen_at, last_seen_at',
      )
      .order('first_seen_at', { ascending: false })
      .limit(200);
    rows = asRows<Database['public']['Tables']['alert_events']['Row']>(data).map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      status: row.status,
      entityType: row.entity_type,
      entityId: row.entity_id,
      message: row.message,
      data: (row.data ?? {}) as Record<string, unknown>,
      occurrences: row.occurrences,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  if (type) rows = rows.filter((row) => row.type === type);

  // Worst first, then oldest-first within a severity: two CRITICALs from different
  // days, the older one has been waiting longer.
  rows.sort((a, b) => {
    const bySeverity = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    return a.firstSeenAt.localeCompare(b.firstSeenAt);
  });

  const counts = {
    open: rows.filter((row) => row.status === 'OPEN').length,
    ack: rows.filter((row) => row.status === 'ACK').length,
    critical: rows.filter((row) => row.severity === 'CRITICAL' && row.status !== 'RESOLVED').length,
  };

  const now = new Date();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="pf-section-title">{tNav('alerts')}</p>
          <h1 className="pf-display mt-1">{t('title')}</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canAct && <AlertScanButton locale={locale} />}

          <div className="pf-pills" role="group" aria-label={t('filter')}>
          <Link
            href={`/${locale}/admin/alerts`}
            prefetch={false}
            className="pf-pill"
            data-active={status !== 'all'}
            aria-current={status !== 'all' ? 'true' : undefined}
          >
            {t('needsAction', { n: counts.open + counts.ack })}
          </Link>
          <Link
            href={`/${locale}/admin/alerts?status=all`}
            prefetch={false}
            className="pf-pill"
            data-active={status === 'all'}
            aria-current={status === 'all' ? 'true' : undefined}
          >
            {t('includingResolved')}
          </Link>
          </div>
        </div>
      </header>

      {/* Three numbers, not a chart. The question this page answers is a count, and a
          count rendered as a number is answerable at a glance from across a warehouse. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="pf-glass rounded-2xl p-4">
          <p className="text-xs font-medium text-[color:var(--text-muted)]">{t('open')}</p>
          <p className="mt-1 text-2xl font-semibold tabular">{counts.open}</p>
        </article>
        <article className="pf-glass rounded-2xl p-4">
          <p className="text-xs font-medium text-[color:var(--text-muted)]">{t('acknowledged')}</p>
          <p className="mt-1 text-2xl font-semibold tabular">{counts.ack}</p>
        </article>
        <article
          className={`pf-glass rounded-2xl p-4 ${counts.critical > 0 ? 'border-red-500/40' : ''}`}
        >
          <p className="text-xs font-medium text-[color:var(--text-muted)]">{t('critical')}</p>
          <p className="mt-1 text-2xl font-semibold tabular">{counts.critical}</p>
        </article>
      </section>

      <AlertList
        locale={locale}
        alerts={rows}
        canAct={canAct}
        now={now}
      />
    </div>
  );
}