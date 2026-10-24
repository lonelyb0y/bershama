import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type RequisitionRow = Database['public']['Tables']['requisitions']['Row'];
type RequisitionLineRow = Database['public']['Tables']['requisition_lines']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type FacilityRow = Database['public']['Tables']['facilities']['Row'];

async function asRows<T>(result: { data: unknown } | null): Promise<T[]> {
  return (Array.isArray(result?.data) ? result.data : []) as T[];
}

export default async function RequisitionsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('requisitions');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const canApprove = session.role === 'TENANT_ADMIN' || session.role === 'WAREHOUSE_MANAGER';
  const canRaise = canApprove || session.role === 'PHARMACY_MANAGER' || session.role === 'DISTRIBUTOR';

  const supabase = await getSupabase();

  const [reqs, lines, products, facilities] = await Promise.all([
    supabase
      .from('requisitions')
      .select('id, code, facility_id, status, justification, requested_at, decided_at')
      .order('requested_at', { ascending: false })
      .limit(50),
    supabase.from('requisition_lines').select('id, requisition_id, product_id, qty_requested, qty_allocated').limit(200),
    supabase.from('products').select('id, name_en, name_ar').eq('is_active', true),
    supabase.from('facilities').select('id, name_en, name_ar, code').eq('is_active', true),
  ]);

  const reqList = await asRows<RequisitionRow>(reqs);
  const lineList = await asRows<RequisitionLineRow>(lines);
  const productList = await asRows<ProductRow>(products);
  const facilityList = await asRows<FacilityRow>(facilities);

  const productName = new Map(
    productList.map((p) => [p.id, locale === 'ar' ? p.name_ar : p.name_en]),
  );
  const facilityName = new Map(
    facilityList.map((f) => [f.id, locale === 'ar' ? f.name_ar : f.name_en]),
  );

  // Lines grouped by requisition
  const linesByReq = new Map<string, RequisitionLineRow[]>();
  for (const line of lineList) {
    const existing = linesByReq.get(line.requisition_id) ?? [];
    existing.push(line);
    linesByReq.set(line.requisition_id, existing);
  }

  const pendingReqs = reqList.filter((r) => r.status === 'PENDING' || r.status === 'DRAFT');
  const resolvedReqs = reqList.filter((r) => r.status !== 'PENDING' && r.status !== 'DRAFT').slice(0, 4);

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── SUB-HEADER BAR ── */}
      <section className="border-b border-[var(--border)]/30 bg-[var(--surface-raised)]/60 backdrop-blur-sm">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)]">
              <span className="text-[var(--primary)] font-medium">{t('hub')} </span>
              <span className="text-[var(--text-muted)]">•</span>
              <span>{t('nightShift')}</span>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="text-[var(--color-stock-ok)] bg-[var(--color-stock-ok)]/10 px-2 py-0.5 rounded border border-[var(--color-stock-ok)]/20">
                {t('edaCompliance')}
              </span>
            </div>
            <h1 className="pf-display text-[1.25rem] font-semibold tracking-tight mt-1">
              {t('title')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center text-[11px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-3 py-2 rounded-xl border border-[var(--border)]/30">
              <span className="text-[var(--text-muted)] mr-2">{t('batchId')}:</span>
              <span className="font-mono text-[var(--primary)]">CAI-2026-N04</span>
            </div>
            <button className="flex items-center gap-1 px-3 py-2 bg-[var(--surface-2)] border border-[var(--border)]/40 rounded-xl text-[var(--text)] text-[11px] font-mono hover:bg-[var(--surface-muted)] transition-colors">
              <span className="w-3 h-3" /> {t('filterView')}
            </button>
          </div>
        </div>
      </section>

      {/* ── MAIN WORKSPACE ── */}
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT WIDE PANEL ── */}
          <section className="lg:col-span-8 flex flex-col gap-4">
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-sm bg-[var(--color-stock-warning)] animate-pulse" />
                  <span className="font-mono text-[13px] text-[var(--text)] tracking-wide">{t('needsDecision')}</span>
                </div>
                <div className="px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)]/40 text-[11px] font-mono text-[var(--text-muted)]">
                  <span className="font-bold text-[var(--text)]">{pendingReqs.length}</span> of <span className="text-[var(--text-muted)]">11</span> {t('pendingDecision')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded-xl text-[11px] font-mono bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] border border-[var(--border)]/30 text-[var(--text)] transition-colors">
                  {t('selectAll')}
                </button>
                <button className="px-3 py-2 rounded-xl text-[11px] font-mono bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] border border-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors flex items-center gap-1">
                  <span className="w-3 h-3" /> {t('exportManifest')}
                </button>
              </div>
            </div>

            {/* Requisition cards ── */}
            <div className="flex flex-col gap-4">
              {pendingReqs.map((req) => {
                const reqLines = linesByReq.get(req.id) ?? [];
                const facility = facilityName.get(req.facility_id) ?? req.facility_id.slice(0, 8);
                const isCritical = req.status === 'PENDING';

                return (
                  <article
                    key={req.id}
                    className={`bg-[var(--surface-raised)] border rounded-xl p-5 hover:border-[var(--border)]/60 transition-all duration-150 ${isCritical ? 'border-[var(--border)]/30' : 'border-[var(--color-stock-critical)]/30'}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border)]/20">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[13px] font-bold text-[var(--primary)] tracking-wider">{req.code}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-mono text-[var(--color-stock-warning)] border border-[var(--color-stock-warning)]/30 bg-[var(--color-stock-warning)]/15`}
                          >
                            ▲ {t('status.dispatchClearance')}
                          </span>
                        </div>
                        <div className="text-[13px] font-body-md text-[var(--text-muted)] mt-0.5">
                          {t('facility', { name: facility })}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] font-mono text-[var(--text-muted)]">{t('prioritySlot')}</span>
                        <div className="text-[11px] font-mono text-[var(--text-muted)]">Zone A • Cairo Sector</div>
                      </div>
                    </div>

                    <div className="py-3 space-y-2">
                      <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                        {t('requestedLines', { count: reqLines.length })}
                      </div>
                      {reqLines.map((line) => {
                        const product = productName.get(line.product_id) ?? '—';
                        return (
                          <div
                            key={line.id}
                            className="bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]/25 flex flex-col md:flex-row md:items-center justify-between gap-2 hover:bg-[var(--surface-2)]/60 transition-colors"
                          >
                            <div className="flex items-start gap-2">
                              <span className="w-4 h-4 text-[var(--text-muted)]" />
                              <div>
                                <div className="font-medium text-[var(--text)] text-[13px]">{product}</div>
                                <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                                  <span>Ambient Aisle 1</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between md:justify-end gap-4 text-right">
                              <div className="font-mono text-[11px] font-bold text-[var(--text)]">{line.qty_requested} pk</div>
                              <div className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30 bg-[var(--color-stock-ok)]/10">
                                {t('standardFefo')}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3 border-t border-[var(--border)]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <Link
                        href="#inspect"
                        className="text-[var(--primary)] font-mono text-[11px] hover:text-[var(--primary-fixed)] underline-offset-4 hover:underline flex items-center gap-1 transition-colors"
                      >
                        {t('inspectTelemetry')} <span className="w-3 h-3" />
                      </Link>
                      <div className="flex items-center gap-2">
                        <button className="h-9 px-4 rounded-xl border border-[var(--border)]/40 bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] hover:border-[var(--primary)]/50 text-[var(--text)] text-[11px] font-mono transition-all active:scale-[0.99]">
                          {t('allocate')}
                        </button>
                        <button className="h-9 px-5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-mono text-[11px] font-semibold hover:bg-[color:var(--primary)]/90 shadow-sm transition-all active:scale-[0.99]">
                          {t('release')}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* RIGHT NARROW PANEL ── */}
          <aside className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="font-mono text-[13px] text-[var(--text)] tracking-wide">{t('recentlyResolved')}</h2>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/20 bg-[var(--color-stock-ok)]/10">
                  {t('audit60m')}
                </span>
              </div>
              <p className="text-[13px] font-body-md text-[var(--text-muted)] mt-1">{t('last60minAudit')}</p>
            </div>

            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]/30 overflow-hidden">
              {resolvedReqs.map((req) => (
                <div key={req.id} className="p-4 bg-[var(--surface-raised)] hover:bg-[var(--surface-2)] transition-colors duration-150">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[13px] font-bold text-[var(--primary)] tracking-wide">{req.code}</span>
                      <div className="font-medium text-[var(--text)] text-[13px] mt-0.5">
                        {facilityName.get(req.facility_id) ?? req.facility_id.slice(0, 8)}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">{t('justNow')}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-mono text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/25 bg-[var(--color-stock-ok)]/12 flex items-center gap-1"
                    >
                      <span className="w-1 h-1 rounded-full bg-[var(--color-stock-ok)]" />
                      {t('status.allocated')}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">Dock Bay 03</span>
                  </div>
                </div>
              ))}
              {resolvedReqs.length === 0 && (
                <div className="px-4 py-6 text-center text-[var(--text-muted)]">
                  {t('noResolved')}
                </div>
              )}
            </div>

            {/* Telemetry gauge ── */}
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl p-4">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]/20">
                <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{t('coldStorage')}</span>
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-ping" />
                  <span className="text-[11px] font-mono text-[var(--primary)]">{t('live')}</span>
                </div>
              </div>
              <div className="flex items-baseline justify-between mt-3">
                <div>
                  <span className="font-display text-[1.5rem] text-[var(--text)] tracking-tight">3.4°C</span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)] ml-1">{t('avgRun')}</span>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-mono text-[var(--primary)]">{t('tempRange', { min: 2.1, max: 4.8 })}</div>
                  <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">{t('target', { low: 2.0, high: 8.0 })}</div>
                </div>
              </div>
              <div className="w-full bg-[var(--surface)] h-1 rounded-full overflow-hidden mt-3">
                <div className="bg-[var(--primary)] h-full w-[42%]" />
              </div>
              <div className="flex justify-between items-center mt-2 text-[11px] font-mono text-[var(--text-muted)]">
                <span>{t('sensorId')}</span>
                <span>{t('calibration')}</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
