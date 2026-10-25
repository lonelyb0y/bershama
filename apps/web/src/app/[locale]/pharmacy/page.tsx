import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type RequisitionRow = Database['public']['Tables']['requisitions']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function PharmacyDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pharmacy');
  const tNav = await getTranslations('nav');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.pharmacy.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const { data } = await supabase
    .from('requisitions')
    .select('id, code, status, justification, requested_at, decided_at')
    .eq('requested_by', session.userId)
    .order('requested_at', { ascending: false })
    .limit(50);

  const rows: RequisitionRow[] = (data ?? []) as RequisitionRow[];

  const waiting = rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'DRAFT').length;
  const allocated = rows.filter((r) => r.status === 'ALLOCATED').length;
  const delivered = rows.filter((r) => r.status === 'DELIVERED').length;

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── TOP SHELL ── */}
      <header className="w-full bg-[var(--surface-raised)] border-b border-[var(--border)]/30 sticky top-0 z-50">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] ring-2 ring-[var(--primary)]/20" />
              <span className="pf-display text-sm font-semibold text-[var(--primary)] tracking-tight">
                Bershama
              </span>
            </Link>
            <div className="hidden lg:flex items-center h-5 w-[1px] bg-[var(--border)]/40" />
            <div className="hidden sm:flex items-center gap-2 bg-[var(--surface-2)] px-3 py-1 rounded-full border border-[var(--border)]/40">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
              <span className="font-mono text-[11px] text-[var(--text)]">
                Al-Amal Clinical Pharmacy — Dokki Branch
              </span>
              <span className="text-[var(--text-muted)] font-mono text-[10px]">|</span>
              <span className="font-mono text-[11px] font-semibold text-[var(--primary)] tracking-wider">
                DISPENSING ACTIVE
              </span>
              <span className="text-[var(--text-muted)] font-mono text-[10px]">|</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                <span className="w-3 h-3 text-[var(--primary)]" />
                +4.1°C
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-4 h-full">
            <Link href="/pharmacy" className="text-[var(--primary)] border-b-2 border-[var(--primary)] font-mono text-[11px] font-medium h-full flex items-center pt-0.5">
              {tNav('orders')}
            </Link>
            <Link href="/admin/deliveries" className="text-[var(--text-muted)] hover:text-[var(--text)] font-mono text-[11px] transition-colors pt-0.5">
              {tNav('deliveries')}
            </Link>
            <Link href="/admin/inventory/batches" className="text-[var(--text-muted)] hover:text-[var(--text)] font-mono text-[11px] transition-colors pt-0.5">
              {t('stockBuffer')}
            </Link>
            <Link href="/admin/inventory/products" className="text-[var(--text-muted)] hover:text-[var(--text)] font-mono text-[11px] transition-colors pt-0.5">
              {t('formulary')}
            </Link>
            <Link href="/admin/alerts" className="text-[var(--text-muted)] hover:text-[var(--text)] font-mono text-[11px] transition-colors pt-0.5">
              {t('invoices')}
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <button className="px-2 py-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text-muted)] hover:text-[var(--text)] font-cairo text-[11px] font-semibold border border-[var(--border)]/30 transition-colors flex items-center gap-2" title={t('switchToArabic')}>
              <span className="w-3 h-3" />
              <span>العربية</span>
            </button>
            <button className="relative p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors" title={t('systemAlerts')}>
              <span className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
            </button>
            <div className="h-4 w-[1px] bg-[var(--border)]/40" />
            <div className="flex items-center gap-2 pl-1">
              <div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center text-[var(--primary)] font-mono text-[11px] font-semibold">
                LM
              </div>
              <div className="hidden xl:flex flex-col text-left leading-none">
                <span className="font-body-sm text-body-sm font-semibold text-[var(--text)]">{session.fullName}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)] font-normal">Lead Pharmacist · #EG-PH-49102</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex-1 flex flex-col gap-4">
        {/* ── HEADLINE & TELEMETRY SUBHEADER ── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 pb-3 border-b border-[var(--border)]/30">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{t('console.title')}</span>
                <span className="text-[var(--text-muted)]/50">/</span>
                <span className="font-cairo text-[11px] text-[var(--text-muted)] font-normal">{t('console.arName')}</span>
              </div>
              <h1 className="pf-display text-[1.25rem] font-semibold tracking-[-0.02em] text-[var(--text)]">
                {t('pharmacy.title')}
              </h1>
            </div>
            <div className="flex items-center gap-3 bg-[var(--surface-2)] px-3 py-2 rounded-lg border border-[var(--border)]/30">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
                Giza Sector 02
              </span>
              <span className="text-[var(--text-muted)]/40 text-[10px]">|</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">Node #4481-B</span>
              <span className="text-[var(--text-muted)]/40 text-[10px]">|</span>
              <span className="font-mono text-[11px] text-[var(--primary)] font-medium flex items-center gap-1">
                <span className="w-3 h-3" />
                Cairo Core Gateway (18ms)
              </span>
            </div>
          </div>
        </section>

        {/* ── FOUR OPERATIONAL FIGURE PANELS ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-2xl p-3 lg:p-4 flex flex-col justify-between transition-colors hover:border-[var(--border)]/60 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--primary)]/60" />
            <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
              <span className="font-mono text-[11px] uppercase tracking-wider font-medium">{t('panel.onOrder')}</span>
              <span className="w-4 h-4 text-[var(--primary)]" />
            </div>
            <div className="my-0.5">
              <div className="font-mono text-[1.25rem] lg:text-[1.75rem] font-bold text-[var(--text)] tracking-tight">{waiting}</div>
            </div>
            <div className="font-mono text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]/20 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
              {t('panel.inPacking', { count: waiting })}
            </div>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-2xl p-3 lg:p-4 flex flex-col justify-between transition-colors hover:border-[var(--border)]/60 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--color-stock-warning)]/70" />
            <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
              <span className="font-mono text-[11px] uppercase tracking-wider font-medium">{t('panel.inTransit')}</span>
              <span className="w-4 h-4 text-[var(--color-stock-warning)]" />
            </div>
            <div className="my-0.5">
              <div className="font-mono text-[1.25rem] lg:text-[1.75rem] font-bold text-[var(--text)] tracking-tick">{allocated}</div>
            </div>
            <div className="font-mono text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]/20 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-warning)]" />
              {t('panel.vanRoute')}
            </div>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-2xl p-3 lg:p-4 flex flex-col justify-between transition-colors hover:border-[var(--border)]/60 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--color-stock-ok)]/60" />
            <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
              <span className="font-mono text-[11px] uppercase tracking-wider font-medium">{t('panel.arrived')}</span>
              <span className="w-4 h-4 text-[var(--color-stock-ok)]" />
            </div>
            <div className="my-0.5">
              <div className="font-mono text-[1.25rem] lg:text-[1.75rem] font-bold text-[var(--color-stock-ok)] tracking-tick">{delivered}</div>
            </div>
            <div className="font-mono text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]/20 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-ok)]" />
              {t('panel.verified')}
            </div>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--border)]/30 rounded-2xl p-3 lg:p-4 flex flex-col justify-between transition-colors hover:border-[var(--border)]/60 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--color-stock-ok)]/40" />
            <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
              <span className="font-mono text-[11px] uppercase tracking-wider font-medium">{t('panel.expiringSoon')}</span>
              <span className="w-4 h-4 text-[var(--color-stock-ok)]" />
            </div>
            <div className="my-0.5">
              <div className="font-mono text-[1.25rem] lg:text-[1.75rem] font-bold text-[var(--color-stock-ok)] tracking-tick">0</div>
            </div>
            <div className="font-mono text-[11px] text-[var(--color-stock-ok)] pt-1 border-t border-[var(--border)]/20 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-stock-ok)]" />
              {t('panel.noCritical')}
            </div>
          </div>
        </section>

        {/* ── TWO-COLUMN WORKING AREA ── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT: MY ORDERS ── */}
          <div className="lg:col-span-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl p-3 lg:p-4 flex flex-col shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]/20">
              <div className="flex items-center gap-2">
                <h2 className="pf-display text-sm font-semibold tracking-tight text-[var(--text)]">{t('myOrders.title')}</h2>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">{waiting} {t('myOrders.pending')}</span>
              </div>
            </div>

            <div className="overflow-y-auto custom-scroll flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)]/30 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">{t('col.code')}</th>
                    <th className="px-3 py-2 text-left">{t('col.status')}</th>
                    <th className="px-3 py-2 text-left">{t('col.requested')}</th>
                    <th className="px-3 py-2 text-right">{t('col.decided')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/30 font-body-md text-[13px]">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-[var(--surface-2)]/60 transition-colors">
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-[var(--primary)]">{row.code}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                            row.status === 'ALLOCATED'
                              ? 'text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30 bg-[var(--color-stock-ok)]/10'
                              : row.status === 'SUBMITTED'
                              ? 'text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30 bg-[var(--color-stock-warning)]/10'
                              : 'text-[var(--color-stock-critical)] border border-[var(--color-stock-critical)]/30 bg-[var(--color-stock-critical)]/10'
                          }`}
                        >
                          {row.status === 'ALLOCATED' ? t('status.allocated') : row.status === 'SUBMITTED' ? t('status.submitted') : t('status.refused')}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)]">
                        {new Date(row.requested_at).toLocaleDateString(locale)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)] text-right">
                        {row.decided_at ? new Date(row.decided_at).toLocaleDateString(locale) : '—'}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">
                        {t('myOrders.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: QUICK ACTIONS ── */}
          <div className="lg:col-span-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl p-3 lg:p-4 flex flex-col gap-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">{t('quickActions.title')}</h3>
              <Link
                href="/admin/inventory/requisitions"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text)] border border-[var(--border)] transition-colors text-[11px] font-mono"
              >
                <span className="w-3 h-3" />
                {t('quickActions.newRequisition')}
              </Link>
              <Link
                href="/admin/deliveries"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text)] border border-[var(--border)] transition-colors text-[11px] font-mono"
              >
                <span className="w-3 h-3" />
                {t('quickActions.trackDeliveries')}
              </Link>
              <Link
                href="/admin/alerts"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text)] border border-[var(--border)] transition-colors text-[11px] font-mono"
              >
                <span className="w-3 h-3" />
                {t('quickActions.checkAlerts')}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
