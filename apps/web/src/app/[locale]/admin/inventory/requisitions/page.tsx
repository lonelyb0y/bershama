import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { RequisitionQueue } from '@/components/inventory/requisition-queue';
import { NewRequisitionForm } from '@/components/inventory/new-requisition-form';
import { RequisitionLineEditor, RemoveLineButton } from '@/components/inventory/requisition-line-editor';
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
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { open: openReqId } = await searchParams;

  const t = await getTranslations('requisitions');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const canApprove = session.role === 'TENANT_ADMIN' || session.role === 'WAREHOUSE_MANAGER';

  const supabase = await getSupabase();

  const [reqs, lines, products, facilities] = await Promise.all([
    supabase
      .from('requisitions')
      .select('id, code, facility_id, status, justification, requested_at, decided_at')
      .order('requested_at', { ascending: false })
      .limit(50),
    supabase.from('requisition_lines').select('id, requisition_id, product_id, qty_requested, qty_allocated').limit(200),
    supabase.from('products').select('id, name_en, name_ar, sku').eq('is_active', true),
    supabase.from('facilities').select('id, name_en, name_ar, code, kind').eq('is_active', true),
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

  const resolvedReqs = reqList.filter((r) => r.status !== 'PENDING' && r.status !== 'DRAFT').slice(0, 4);

  // The requisition currently opened for line editing
  const openReq = openReqId ? reqList.find((r) => r.id === openReqId) : null;
  const openReqLines = openReq ? (linesByReq.get(openReq.id) ?? []) : [];

  return (
    <div className="bg-[var(--surface)] text-[var(--text)]">
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
            <button className="flex items-center gap-1 px-3 py-2 bg-[var(--surface-2)] border border-[var(--border)]/40 rounded-xl text-[var(--text)] text-[11px] font-mono hover:bg-[var(--surface-muted)] transition-colors">
              <span className="w-3 h-3" /> {t('filterView')}
            </button>
          </div>
        </div>
      </section>

      {/* ── MAIN WORKSPACE ── */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6">
        {/* New requisition form ── */}
        {canApprove && (
          <div className="mb-4">
            <NewRequisitionForm
              facilities={facilityList.map((f) => ({
                id: f.id,
                nameEn: f.name_en,
                nameAr: f.name_ar,
                code: f.code,
                kind: f.kind,
              }))}
              locale={locale}
              labels={{
                title: t('new.title'),
                facility: t('new.facility'),
                justification: t('new.justification'),
                justificationHint: t('new.justificationHint'),
                submit: t('new.submit'),
                facilityRequired: t('new.facilityRequired'),
                errorSummary: t('new.errorSummary'),
                created: t('new.created'),
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT WIDE PANEL ── */}
          <section className="lg:col-span-8 flex flex-col gap-4">
            <RequisitionQueue
              rows={reqList.map((req) => {
                const facility = facilityName.get(req.facility_id) ?? req.code;
                return {
                  id: req.id,
                  code: req.code,
                  facility,
                  status: req.status,
                  statusLabel: t(`status.${req.status}`) ?? req.status,
                  requestedAgo: '',
                  justification: req.justification,
                  needsDecision: req.status === 'PENDING' || req.status === 'DRAFT',
                };
              })}
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
                caption: t('listLabel'),
                needsActionTitle: t('needsDecision'),
                canWaitTitle: t('recentlyResolved'),
              }}
              locale={locale}
            />
          </section>

          {/* RIGHT: OPEN REQUISITION DETAIL ── */}
          {openReq ? (
            <section className="lg:col-span-4 flex flex-col gap-4">
              <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-mono text-sm font-semibold tracking-wide text-[var(--text)]">
                    {openReq.code}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/20 bg-[var(--color-stock-ok)]/10">
                    {openReq.status}
                  </span>
                </div>
                <div className="text-[13px] text-[var(--text-muted)] mb-2">
                  {facilityName.get(openReq.facility_id) ?? openReq.facility_id.slice(0, 8)}
                </div>
                {openReq.justification && (
                  <p className="text-sm text-[var(--text-muted)] mb-4">{openReq.justification}</p>
                )}
                <div className="space-y-2">
                  {openReqLines.map((line) => {
                    const product = productName.get(line.product_id) ?? '—';
                    return (
                      <div
                        key={line.id}
                        className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]/30 flex items-center justify-between"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-[var(--text)] text-sm">{product}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {line.qty_requested} pk
                          </div>
                        </div>
                        <RemoveLineButton
                          lineId={line.id}
                          labels={{ remove: '–', removeLine: t('editor.removeLine') }}
                        />
                      </div>
                    );
                  })}
                  {openReqLines.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)] text-center py-4">
                      {t('editor.noLines')}
                    </p>
                  )}
                </div>
                <RequisitionLineEditor
                  requisitionId={openReq.id}
                  products={productList.map((p) => ({
                    id: p.id,
                    sku: p.sku,
                    nameEn: p.name_en,
                    nameAr: p.name_ar,
                    alreadyOnRequest: openReqLines.some((l) => l.product_id === p.id),
                  }))}
                  canWrite={canApprove}
                  onChanged={() => {}}
                  labels={{
                    add: t('editor.add'),
                    product: t('editor.product'),
                    quantity: t('editor.quantity'),
                    searchProducts: t('editor.searchProducts'),
                    noProducts: t('editor.noProducts'),
                    remove: t('editor.remove'),
                    removeLine: t('editor.removeLine'),
                    qtyRequired: t('editor.qtyRequired'),
                    qtyPositive: t('editor.qtyPositive'),
                    productRequired: t('editor.productRequired'),
                    duplicate: t('editor.duplicate'),
                    errorSummary: t('editor.errorSummary'),
                    lineAdded: t('editor.lineAdded'),
                    lineRemoved: t('editor.lineRemoved'),
                  }}
                />
                {openReq.status === 'DRAFT' && canApprove && (
                  <div className="mt-4 flex items-center gap-2">
                    <form action={async () => {}} className="flex-1">
                      <input type="hidden" name="requisitionId" value={openReq.id} />
                      <button
                        type="submit"
                        className="w-full rounded-xl bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white"
                      >
                        {t('detail.submit')}
                      </button>
                    </form>
                    <form action={async () => {}} className="flex-1">
                      <input type="hidden" name="requisitionId" value={openReq.id} />
                      <button
                        type="submit"
                        className="w-full rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)]"
                      >
                        {t('detail.reject')}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <aside className="lg:col-span-4 flex flex-col gap-4">
              <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 text-[var(--primary)]" />
                    <h2 className="font-mono text-[13px] text-[var(--text)] tracking-wide">
                      {t('recentlyResolved')}
                    </h2>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/20 bg-[var(--color-stock-ok)]/10">
                    {t('audit60m')}
                  </span>
                </div>
                <p className="text-[13px] text-sm text-[var(--text-muted)] mt-1">
                  {t('last60minAudit')}
                </p>
              </div>

              <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]/30 overflow-hidden">
                {resolvedReqs.map((req) => (
                  <div key={req.id} className="p-4 bg-[var(--surface-raised)] hover:bg-[var(--surface-2)] transition-colors duration-150">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[13px] font-bold text-[var(--primary)] tracking-wide">
                          {req.code}
                        </span>
                        <div className="font-medium text-[var(--text)] text-[13px] mt-0.5">
                          {facilityName.get(req.facility_id) ?? req.facility_id.slice(0, 8)}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                        {t('justNow')}
                      </span>
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
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}
