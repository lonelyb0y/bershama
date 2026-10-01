import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { Link } from '@/i18n/routing';
import {
  approveRequisition,
  rejectRequisition,
  submitRequisition,
} from './actions';
import { RequisitionLineEditor, RemoveLineButton } from '@/components/inventory/requisition-line-editor';
import { NewRequisitionForm } from '@/components/inventory/new-requisition-form';
import type { Locale } from '@/i18n/routing';

/**
 * Requisitions: raise one, add lines to it, submit it, approve it.
 *
 * ── one screen, not four ────────────────────────────────────────────────────
 *
 * A warehouse supervisor raising a request is doing one thing over a few
 * minutes, and splitting "list", "new", "detail" and "approve" across four routes
 * means four times navigating away from the thing they are thinking about. So it
 * is one screen: the list of requests, and the open one in detail beside it.
 * The second column is empty until something is selected, which is a real state
 * and gets a real message rather than a blank panel.
 *
 * ── the approval is one action, not two ─────────────────────────────────────
 *
 * The FEFO preview and the decision are the same round trip. An approver who saw
 * an allocation and then approved separately could approve a different one than
 * the one on screen -- and the whole point of FEFO is that the figure shown is
 * the figure committed. The per-line allocation below each requested quantity is
 * what got reserved, not a prediction.
 */
export default async function RequisitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('requisitions');
  const session = await getSession();
  if (!session) notFound();

  // The distributor side approves; a pharmacy manager raises and submits. Named
  // roles rather than a `canWrite` boolean passed down, so the page reads as a
  // statement about the two jobs rather than about permissions.
  const canApprove = session.role === 'TENANT_ADMIN' || session.role === 'WAREHOUSE_MANAGER';
  const canRaise =
    canApprove || session.role === 'PHARMACY_MANAGER' || session.role === 'DISTRIBUTOR';

  const { open } = await searchParams;
  const supabase = await getSupabase();

  const { data: listData } = await supabase
    .from('requisitions')
    .select('id, code, facility_id, status, justification, requested_at, decided_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (listData ?? []) as Array<{
    id: string;
    code: string;
    facility_id: string;
    status: string;
    justification: string | null;
    requested_at: string;
    decided_at: string | null;
  }>;

  // Facility names for both the list and the form's picker, in one read.
  const { data: facilityData } = await supabase
    .from('facilities')
    .select('id, name_en, name_ar, code, kind')
    .eq('is_active', true)
    .order('name_en');

  const facilities = (facilityData ?? []).map((f) => ({
    id: f.id as string,
    nameEn: f.name_en as string,
    nameAr: f.name_ar as string | null,
    code: f.code as string,
    kind: f.kind as string,
  }));

  const facilityName = (id: string) => {
    const f = facilities.find((x) => x.id === id);
    if (!f) return id.slice(0, 8);
    return locale === 'ar' ? (f.nameAr ?? f.nameEn) : f.nameEn;
  };

  // ── the open request, if any ─────────────────────────────────────────────
  const openRow = open ? rows.find((r) => r.id === open) : undefined;
  const onRequest = new Set<string>();
  let openLines: Array<{
    id: string;
    product_id: string;
    qty_requested: number;
    qty_allocated: number | null;
    shortage_qty: number | null;
  }> = [];

  if (openRow) {
    const { data: lineData } = await supabase
      .from('requisition_lines')
      .select('id, product_id, qty_requested, qty_allocated, shortage_qty')
      .eq('requisition_id', openRow.id)
      .order('created_at');

    openLines = (lineData ?? []) as typeof openLines;
    for (const l of openLines) onRequest.add(l.product_id);
  }

  // Products for the picker. Fetched unconditionally so the variable is always
  // bound: reading a `var` declared inside an if-block and used outside it is a
  // bug, and the fix is not to move the declaration but to not need the branch.
  //
  // A read, so it goes through RLS on the table rather than an api function --
  // reads do not hit the write-path problem that forced the api functions in the
  // first place.
  const { data: productData } = await supabase
    .from('products')
    .select('id, sku, name_en, name_ar')
    .eq('is_active', true)
    .order('name_en')
    .limit(500);

  const productOptions = (
    (productData ?? []) as Array<{ id: string; sku: string; name_en: string; name_ar: string | null }>
  ).map((pr) => ({
    id: pr.id,
    sku: pr.sku,
    nameEn: pr.name_en,
    nameAr: pr.name_ar ?? pr.name_en,
    alreadyOnRequest: onRequest.has(pr.id),
  }));


  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* ── the list ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-[color:var(--text-muted)] mt-1 text-sm">
            {t('subtitle', { count: rows.length })}
          </p>
        </header>

        <nav aria-label={t('listLabel')} className="space-y-1">
          {rows.length === 0 ? (
            <p className="rounded-xl border p-6 text-center text-sm text-[color:var(--text-muted)]">
              {t('empty')}
            </p>
          ) : (
            rows.map((r) => {
              const isOpen = r.id === openRow?.id;

              return (
                <Link
                  key={r.id}
                  href={isOpen ? '/admin/inventory/requisitions' : `/admin/inventory/requisitions?open=${r.id}`}
                  // Same reasoning as the catalogue's per-row edit links: one prefetch
                  // per row, each re-running the requisitions query to prove an open
                  // panel exists.
                  prefetch={false}
                  aria-current={isOpen ? 'page' : undefined}
                  className={`block rounded-lg border p-3 transition-colors hover:bg-[color:var(--surface-raised)] ${
                    isOpen ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)]/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span dir="ltr" className="font-mono text-sm font-medium">
                      {r.code}
                    </span>
                    <StatusPill status={r.status} label={t(`status.${r.status}`)} />
                  </div>
                  <p className="text-[color:var(--text-muted)] mt-1 truncate text-xs">
                    {facilityName(r.facility_id)}
                  </p>
                </Link>
              );
            })
          )}
        </nav>

        {canRaise && (
          <NewRequisitionForm
            facilities={facilities}
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
        )}
      </div>

      {/* ── the open request ─────────────────────────────────────────────── */}
      <div>
        {!openRow ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed p-8">
            <p className="max-w-sm text-center text-sm text-[color:var(--text-muted)]">
              {t('selectHint')}
            </p>
          </div>
        ) : (
          <RequestDetail
            key={openRow.id}
            row={openRow}
            lines={openLines}
            productOptions={productOptions}
            facilityName={facilityName(openRow.facility_id)}
            canRaise={canRaise}
            canApprove={canApprove}
            labels={{
              submitted: t('detail.submitted'),
              submittedAt: t('detail.submittedAt'),
              decidedAt: t('detail.decidedAt'),
              requested: t('detail.requested'),
              allocated: t('detail.allocated'),
              shortage: t('detail.shortage'),
              productLabel: t('detail.product'),
              submit: t('detail.submit'),
              approve: t('detail.approve'),
              approveHint: t('detail.approveHint'),
              reject: t('detail.reject'),
              rejectReason: t('detail.rejectReason'),
              cancel: t('detail.cancel'),
              add: t('editor.add'),
              editorProduct: t('editor.product'),
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
              noLines: t('detail.noLines'),
            }}
          />
        )}
      </div>
    </div>
  );
}

function RequestDetail({
  row,
  lines,
  productOptions,
  facilityName,
  canRaise,
  canApprove,
  labels,
}: {
  row: { id: string; code: string; status: string; justification: string | null; requested_at: string; decided_at: string | null };
  lines: Array<{ id: string; product_id: string; qty_requested: number; qty_allocated: number | null; shortage_qty: number | null }>;
  productOptions: Array<{ id: string; sku: string; nameEn: string; nameAr: string; alreadyOnRequest: boolean }>;
  facilityName: string;
  canRaise: boolean;
  canApprove: boolean;
  labels: Record<string, string>;
}) {
  const productName = (id: string) => productOptions.find((p) => p.id === id);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 dir="ltr" className="font-mono text-xl font-semibold tracking-tight">
            {row.code}
          </h2>
          <p className="text-[color:var(--text-muted)] mt-1 text-sm">{facilityName}</p>
          {row.justification && (
            <p className="mt-2 text-sm">{row.justification}</p>
          )}
        </div>
        <StatusPill status={row.status} label={labels[row.status] ?? row.status} />
      </header>

      {lines.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-sm text-[color:var(--text-muted)]">
          {labels.noLines}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {lines.map((l) => {
            const p = productName(l.product_id);
            const short = (l.shortage_qty ?? 0) > 0;

            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p?.nameEn ?? l.product_id.slice(0, 8)}</p>
                  <p dir="ltr" className="text-[color:var(--text-muted)] font-mono text-xs">
                    {p?.sku ?? ''}
                  </p>
                </div>

                <div className="text-end text-sm">
                  <span className="block tabular-nums">
                    {labels.requested} {l.qty_requested}
                  </span>
                  {l.qty_allocated !== null && (
                    <span
                      className={`block text-xs tabular-nums ${
                        short ? 'text-amber-600' : 'text-emerald-600'
                      }`}
                    >
                      {short
                        ? `${labels.allocated} ${l.qty_allocated} · ${labels.shortage} ${l.shortage_qty}`
                        : `${labels.allocated} ${l.qty_allocated}`}
                    </span>
                  )}
                </div>

                {row.status === 'DRAFT' && canRaise && (
                  <RemoveLineButton
                    lineId={l.id}
                    labels={{ remove: labels.remove, removeLine: labels.removeLine }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {row.status === 'DRAFT' && canRaise && (
        <RequisitionLineEditor
          requisitionId={row.id}
          products={productOptions}
          canWrite
          onChanged={() => {}}
          labels={{
            add: labels.add,
            product: labels.editorProduct,
            quantity: labels.quantity,
            searchProducts: labels.searchProducts,
            noProducts: labels.noProducts,
            remove: labels.remove,
            removeLine: labels.removeLine,
            qtyRequired: labels.qtyRequired,
            qtyPositive: labels.qtyPositive,
            productRequired: labels.productRequired,
            duplicate: labels.duplicate,
            errorSummary: labels.errorSummary,
            lineAdded: labels.lineAdded,
            lineRemoved: labels.lineRemoved,
          }}
        />
      )}

      {row.status === 'DRAFT' && canRaise && (
        <form action={submitRequisition}>
          <input type="hidden" name="requisitionId" value={row.id} />
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
          >
            {labels.submit}
          </button>
        </form>
      )}

      {row.status === 'SUBMITTED' && canApprove && (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm text-[color:var(--text-muted)]">{labels.approveHint}</p>

          <div className="flex flex-wrap items-center gap-2">
            <form action={approveRequisition}>
              <input type="hidden" name="requisitionId" value={row.id} />
              <button
                type="submit"
                className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
              >
                {labels.approve}
              </button>
            </form>

            <details className="flex-1">
              <summary className="cursor-pointer text-sm text-[color:var(--text-muted)] select-none">
                {labels.reject}
              </summary>
              <form action={rejectRequisition} className="mt-2 flex gap-2">
                <input type="hidden" name="requisitionId" value={row.id} />
                <label className="sr-only" htmlFor="reject-note">
                  {labels.rejectReason}
                </label>
                <input
                  id="reject-note"
                  name="note"
                  required
                  placeholder={labels.rejectReason}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-[color:var(--text-muted)]/10"
                >
                  {labels.reject}
                </button>
              </form>
            </details>
          </div>
        </div>
      )}

      {row.decided_at && (
        <p className="text-[color:var(--text-muted)] text-xs">
          <time dateTime={row.decided_at}>{row.decided_at.slice(0, 16).replace('T', ' ')}</time>
        </p>
      )}
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  // Four tones, not one with opacity variations: these are states a person has
  // to tell apart at a glance while scrolling, so they are distinguished by hue
  // AND by the label text, never by colour alone.
  const tones: Record<string, string> = {
    DRAFT: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
    SUBMITTED: 'border-sky-500/40 text-sky-600',
    ALLOCATED: 'border-emerald-500/40 text-emerald-600',
    REJECTED: 'border-red-500/40 text-red-500',
    DISCARDED: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
  };

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        tones[status] ?? tones.DRAFT
      }`}
    >
      {label}
    </span>
  );
}


