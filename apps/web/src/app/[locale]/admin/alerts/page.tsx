import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type AlertRow = Database['public']['Tables']['alert_events']['Row'];

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
  const tNav = await getTranslations('nav');
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

  const rows = await asRows<AlertRow>({ data } as { data: unknown });

  const openCount = rows.filter((r) => r.status === 'OPEN').length;
  const acknowledgedCount = rows.filter((r) => r.status === 'ACK').length;

  const sortedRows = [...rows].sort((a, b) => {
    const ra = SEVERITY_RANK[a.severity] ?? 99;
    const rb = SEVERITY_RANK[b.severity] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.first_seen_at.localeCompare(b.first_seen_at);
  });

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── TOP APP BAR ── */}
      <header className="bg-[var(--surface-raised)] border-b border-[var(--border)]/30 w-full px-4 py-2 sticky top-0 z-50">
        <div className="mx-auto max-w-[1720px] flex justify-between items-center w-full gap-3">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] shadow-[0_0_8px_rgba(67,177,137,0.4)]" />
              <span className="pf-display text-sm font-bold tracking-tight uppercase text-[var(--text)]">
                Bershama <span className="text-[var(--text-muted)] font-normal">{'//'}</span> <span className="text-[var(--primary-text, var(--primary))] font-mono text-[11px] font-medium tracking-widest">OPS CONSOLE</span>
              </span>
            </div>
            <div className="hidden xl:flex items-center gap-1 pl-3 border-l border-[var(--border)]/30 text-[11px] font-mono text-[var(--text-muted)]">
              <span className="text-[var(--color-stock-ok)] uppercase">HUB:</span>
              <span className="text-[var(--text)] font-semibold">Node 04 Cairo Central</span>
              <span className="text-[var(--text-muted)] mx-1">|</span>
              <span className="text-[var(--color-stock-ok)]">CHAMBER:</span>
              <span className="font-mono text-[var(--primary-text, var(--primary))] font-medium">+2.4°C</span>
              <span className="text-[var(--color-stock-ok)] text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-stock-ok)]/10 border border-[var(--color-stock-ok)]/20">NOMINAL</span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-3 text-[11px] font-mono">
            <Link href="/admin/inventory/batches" className="text-[var(--text-muted)] hover:text-[var(--text)] pb-1 transition-colors">{tNav('batches')}</Link>
            <Link href="/admin/deliveries" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{tNav('deliveries')}</Link>
            <Link href="/admin/inventory/requisitions" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">{tNav('requisitions')}</Link>
            <Link href="/admin/alerts" className="border-b-2 border-[var(--primary)] text-[var(--primary-text, var(--primary))] font-semibold pb-1 flex items-center gap-2">{tNav('alerts')}
              <span className="inline-flex items-center justify-center px-2 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-stock-warning)]/20 border border-[var(--color-stock-warning)]/40 text-[var(--color-stock-warning)]">{openCount}</span>
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button className="px-2 py-1 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text)] rounded border border-[var(--border)]/30 hover:bg-[var(--surface-2)] transition-colors" title={t('action.toggleArabic')}>
              العربية
            </button>
            <div className="flex items-center gap-1 text-[var(--text-muted)]">
              <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors relative" title={t('activeAlerts')}>
                <span className="w-4 h-4" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-[var(--color-stock-critical)] rounded-full" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors" title={t('chamberGateway')}>
                <span className="w-4 h-4" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors" title={t('consoleConfig')}>
                <span className="w-4 h-4" />
              </button>
            </div>
            <button className="hidden xl:inline-flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--color-stock-critical)]/60 hover:bg-[var(--color-stock-critical)] text-[var(--color-stock-critical)] hover:text-[var(--surface)] px-3 py-2 rounded-lg text-[11px] font-mono font-semibold transition-all duration-150 active:scale-[0.98]">
              <span className="w-3 h-3" />
              <span>{t('emergencyQuarantine')}</span>
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-[var(--border)]/30">
              <div className="text-right hidden sm:block">
                <div className="text-[11px] font-mono text-[var(--text)] font-semibold leading-tight">{session.fullName}</div>
                <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center justify-end gap-1">
                  <span>EDA Lic. GZ-7704</span>
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
                </div>
              </div>
              <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]/40 flex items-center justify-center text-[var(--primary-text, var(--primary))] font-mono font-bold text-[10px]" title={t('operatorBadge')}>
                TM
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1720px] mx-auto px-4 py-4 flex flex-col gap-4">
        {/* ── HEADER TITLE & CONTROLS ── */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-[var(--border)]/30">
            <div className="flex flex-wrap items-baseline gap-4">
              <div>
                <h1 className="pf-display text-[1.25rem] font-semibold tracking-tight text-[var(--text)] flex items-center gap-2">
                  {t('title')}
                  <span className="text-[11px] font-mono text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)]/30 px-2 py-0.5 rounded tracking-normal">{t('liveDispatchFeed')}</span>
                </h1>
                <p className="text-[13px] font-body-md text-[var(--text-muted)] mt-0.5">{t('subtitle')}</p>
              </div>
              <div className="flex items-center gap-2 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]/30">
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)]/40 font-mono text-[11px] font-semibold transition-all">{t('mode.needsAction')}
                  <span className="px-2 py-1 rounded-full text-[10px] font-mono font-bold bg-[var(--color-stock-warning)]/20 border border-[var(--color-stock-warning)]/50 text-[var(--color-stock-warning)]">{openCount}</span>
                </button>
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-muted)] font-mono text-[11px] font-semibold transition-colors">{t('mode.resolved')}
                  <span className="px-2 py-1 rounded-full text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)]/20">{acknowledgedCount}</span>
                </button>
              </div>
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

          <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
            {sortedRows.length === 0 ? (
              <div className="px-6 py-8 text-center text-[var(--text-muted)]">
                <span className="w-8 h-8 text-[var(--text-muted)]/30" />
                <p className="mt-3 text-[13px]">{t('alerts.allClear')}</p>
                <p className="text-[11px] mt-1">{t('alerts.allClearHint')}</p>
              </div>
            ) : (
              sortedRows.map((alert) => {
                const severity = alert.severity === 'CRITICAL' ? 'critical' : alert.severity === 'WARN' ? 'warning' : 'info';
                const glyph = severity === 'critical' ? '▲' : severity === 'warning' ? '●' : '◆';
                const toneClass = severity === 'critical' ? 'text-[var(--color-stock-critical)] border border-[var(--color-stock-critical)]/30 bg-[var(--color-stock-critical)]/10' :
                  severity === 'warning' ? 'text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30 bg-[var(--color-stock-warning)]/10' :
                  'text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30 bg-[var(--color-stock-ok)]/10';
                return (
                  <div key={alert.id} className="border-b border-[var(--border)]/30 last:border-0 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[var(--primary-text, var(--primary))] font-mono text-[13px] font-semibold tracking-wide uppercase`}>{alert.type}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${toneClass}`}>
                            <span className="text-[9px]">{glyph}</span>
                            <span>{alert.severity}</span>
                          </span>
                        </div>
                        <div className="text-[13px] text-[var(--text)] mt-0.5 leading-snug">{alert.message}</div>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">{new Date(alert.first_seen_at).toLocaleDateString(locale)}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] font-mono">
                      <span className="text-[var(--text-muted)]">{alert.entity_type} · {alert.entity_id}</span>
                      <div className="flex items-center gap-2">
                        <button className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors" aria-label={t('action.acknowledge')}>
                          <span className="w-3 h-3" />
                        </button>
                        <button className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors" aria-label={t('action.resolve')}>
                          <span className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
