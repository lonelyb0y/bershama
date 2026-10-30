import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import { AlertScanButton } from './alert-scan';
import { AlertList } from './alert-list';

type DbAlertRow = Database['public']['Tables']['alert_events']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('alerts');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const { data } = await supabase
    .from('alert_events')
    .select(
      'id, type, severity, status, entity_type, entity_id, message, data, occurrences, first_seen_at, last_seen_at',
    )
    .in('status', ['OPEN', 'ACK'])
    .order('first_seen_at', { ascending: false })
    .limit(200);

  const rows = await asRows<DbAlertRow>({ data } as { data: unknown });

  const openCount = rows.filter((r) => r.status === 'OPEN').length;
  const acknowledgedCount = rows.filter((r) => r.status === 'ACK').length;

  // Severity ordering: critical first, then warn, then info, then by first seen.
  const sortedRows = [...rows].sort((a, b) => {
    const ra = SEVERITY_RANK[a.severity] ?? 99;
    const rb = SEVERITY_RANK[b.severity] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.first_seen_at.localeCompare(b.first_seen_at);
  });

  // Map database rows (snake_case) to the AlertList component's shape (camelCase).
  const alertItems = sortedRows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    status: r.status,
    entityType: r.entity_type,
    entityId: r.entity_id,
    message: r.message,
    data: (r.data as Record<string, unknown> ?? {}),
    occurrences: r.occurrences,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }));

  const canAct = session.role === 'WAREHOUSE_MANAGER';

  return (
    <div className="bg-[var(--surface)] text-[var(--text)]">
      <section className="flex-1 w-full max-w-[1720px] mx-auto px-4 py-4 flex flex-col gap-4">
        {/* ── HEADER TITLE & CONTROLS ── */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-[var(--border)]/30">
            <div className="flex flex-wrap items-baseline gap-4">
              <div>
                <h1 className="pf-display text-[1.25rem] font-semibold tracking-tight text-[var(--text)] flex items-center gap-2">
                  {t('title')}
                  <span className="text-[11px] font-mono text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)]/30 px-2 py-0.5 rounded tracking-normal">{t('liveDispatchFeed')}</span>
                </h1>
                <p className="text-[13px] text-sm text-[var(--text-muted)] mt-0.5">{t('subtitle')}</p>
              </div>
              <div className="flex items-center gap-2 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]/30">
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)]/40 font-mono text-[11px] font-semibold transition-all">{t('mode.needsAction')}
                  <span className="px-2 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-stock-warning)]/20 border border-[var(--color-stock-warning)]/50 text-[var(--color-stock-warning)]">{openCount}</span>
                </button>
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-muted)] font-mono text-[11px] font-semibold transition-colors">{t('mode.resolved')}
                  <span className="px-2 py-1 rounded-full text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)]/20">{acknowledgedCount}</span>
                </button>
              </div>
              <AlertScanButton locale={locale} />
            </div>

            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <div className="relative w-full sm:w-80">
                <span aria-hidden="true" className="absolute left-3 top-3 text-[var(--text-muted)] text-[18px]"><span className="w-4 h-4" /></span>
                <input type="search" placeholder={t('searchAlerts')} className="w-full bg-[var(--surface-2)] border border-[var(--border)]/35 rounded-xl pl-9 pr-3 py-2 font-mono text-[11px] text-[var(--text)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20 transition-all" />
              </div>
              <button className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-2)] border border-[var(--border)]/35 hover:border-[var(--border)]/60 rounded-xl text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-muted)] transition-colors shrink-0">
                <span className="w-3 h-3" />
                <span>{t('filter.allHubs')}</span>
                <span className="w-3 h-3" />
              </button>
            </div>
          </div>
        </section>

        {/* ── ALERTS LIST ── */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
              <h2 className="pf-display text-sm font-semibold tracking-wide uppercase text-[var(--text)]">{t('section.needsDecision')}</h2>
              <span className="text-[11px] font-mono text-[var(--text-muted)] ml-2">{t('section.requiresSignoff')}</span>
            </div>
            <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
              <span className="w-3 h-3 text-[var(--text-muted)]" />
              <span>{t('section.pollingActive')}</span>
            </div>
          </div>

          <AlertList locale={locale} alerts={alertItems} canAct={canAct} now={new Date()} />
        </section>
      </section>
    </div>
  );
}
