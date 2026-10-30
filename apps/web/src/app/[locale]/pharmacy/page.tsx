import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { RequisitionQueue } from '@/components/inventory/requisition-queue';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type RequisitionRow = Database['public']['Tables']['requisitions']['Row'];
type FacilityRow = Database['public']['Tables']['facilities']['Row'];

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
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.pharmacy.includes(session.role)) notFound();

  const supabase = await getSupabase();

  const [reqs, facilities] = await Promise.all([
    supabase
      .from('requisitions')
      .select('id, code, status, justification, requested_at, decided_at, facility_id')
      .order('requested_at', { ascending: false })
      .limit(50),
    supabase.from('facilities').select('id, name_en, name_ar, code').eq('is_active', true),
  ]);

  const rows: RequisitionRow[] = (reqs.data ?? []) as RequisitionRow[];
  const facilityList: FacilityRow[] = (facilities.data ?? []) as FacilityRow[];

  const waiting = rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'DRAFT').length;
  const allocated = rows.filter((r) => r.status === 'ALLOCATED').length;
  const delivered = rows.filter((r) => r.status === 'DELIVERED').length;

  // The pharmacy's own facility: the first active facility in the tenant.
  const ownFacility = facilityList[0];
  const facilityName = ownFacility
    ? locale === 'ar' && ownFacility.name_ar
      ? ownFacility.name_ar
      : ownFacility.name_en
    : t('yourFacility');

  return (
    <div className="bg-[var(--surface)] text-[var(--text)]">
      <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex-1 flex flex-col gap-4">
        {/* ── HEADLINE & TELEMETRY SUBHEADER ── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 pb-3 border-b border-[var(--border)]/30">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{t('console.title')}</span>
                <span className="text-[var(--text-muted)]/50">/</span>
                <span className="font-arabic text-[11px] text-[var(--text-muted)] font-normal">{t('console.arName')}</span>
              </div>
              <h1 className="pf-display text-[1.25rem] font-semibold tracking-[-0.02em] text-[var(--text)]">
                {t('title')}
              </h1>
            </div>
            <div className="flex items-center gap-3 bg-[var(--surface-2)] px-3 py-2 rounded-lg border border-[var(--border)]/30">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)]" />
                {facilityName}
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
                <tbody className="divide-y divide-[var(--border)]/30 text-sm text-[13px]">
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

          {/* RIGHT: REQUISITION QUEUE ── */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <RequisitionQueue
              rows={rows.map((r) => ({
                id: r.id,
                code: r.code,
                facility: facilityName,
                status: r.status,
                statusLabel: t(`status.${r.status}`) ?? r.status,
                requestedAgo: '',
                justification: r.justification,
                needsDecision: r.status === 'SUBMITTED' || r.status === 'DRAFT',
              }))}
              labels={{
                code: t('column.code'),
                facility: t('column.facility'),
                status: t('column.status'),
                requested: t('column.requested'),
                justification: t('column.justification'),
                needsAction: t('filter.needsAction'),
                canWait: t('filter.canWait'),
                all: t('filter.all'),
                searchPlaceholder: t('searchPlaceholder'),
                searchLabel: t('searchLabel'),
                emptyNeedsAction: t('emptyNeedsAction'),
                emptyNeedsActionBody: t('emptyNeedsActionBody'),
                emptyAll: t('emptyAll'),
                emptyAllBody: t('emptyAllBody'),
                caption: t('caption'),
                needsActionTitle: t('myOrders.title'),
                canWaitTitle: t('recentlyResolved'),
              }}
              locale={locale}
              showFilters={false}
            />
          </div>
        </section>
      </section>
    </div>
  );
}
