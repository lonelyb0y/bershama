'use server';

/**
 * Requisition writes, as server actions.
 *
 * These are thin. Every decision worth testing -- FEFO, the lifecycle, the
 * shortage arithmetic -- lives in the database as an api.* function, where it is
 * one transaction and cannot be bypassed. An action here supplies the locale,
 * binds a client to the caller's session, and translates a database error into
 * something a person can act on.
 *
 * The translation is the part worth reading. A raw Postgres error for a form is
 * not a message: "duplicate key value violates unique constraint" tells a
 * warehouse supervisor nothing about which field to change.
 */

import { revalidatePath } from 'next/cache';

import { getSupabaseApi } from '@/lib/supabase/server';
import { getLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export interface RequisitionActionResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
  /** A stable code the form maps to a translated string, never a raw message. */
  code?: string;
}

const fail = (field: string, code: string): RequisitionActionResult => ({
  ok: false,
  errors: [{ field, message: code }],
  code,
});

/**
 * A database error, as a field and a stable code.
 *
 * Only the errors this form can actually provoke are mapped. Anything else is
 * passed through as `form` with the raw message, because inventing a friendly
 * string for an error nobody anticipated would be worse than showing the truth.
 */
function translateDbError(error: { code?: string; message: string }): RequisitionActionResult {
  const m = error.message;

  if (error.code === '23505') {
    // Unique violation. The requisition_lines index is (tenant, requisition,
    // product), so this is always "that product is already on the request".
    return fail('product', 'duplicate');
  }
  if (m.includes('a quantity below one')) return fail('qty', 'qtyPositive');
  if (m.includes('no active product')) return fail('product', 'unknownProduct');
  if (m.includes('cannot be changed')) return fail('form', 'notDraft');
  if (m.includes('a % request cannot be changed') || m.includes('cannot be changed')) {
    return fail('form', 'notDraft');
  }
  if (m.includes('no editable line')) return fail('form', 'lineNotEditable');
  if (m.includes('only a warehouse manager')) return fail('form', 'forbidden');
  if (m.includes('your role cannot raise')) return fail('form', 'forbidden');
  if (m.includes('IN_TRANSIT')) return fail('kind', 'transitRefused');
  if (m.includes('GTIN')) return fail('gtin', 'gtin');
  if (m.includes('maximum cannot be below')) return fail('tempMaxC', 'tempRange');
  if (m.includes('sku, name_en and name_ar')) return fail('form', 'namesRequired');
  if (m.includes('both names are required')) return fail('form', 'namesRequired');
  if (m.includes('a requisition with no lines')) return fail('form', 'emptyRequest');
  if (m.includes('a rejection needs a reason')) return fail('note', 'reasonRequired');

  return { ok: false, errors: [{ field: 'form', message: m }], code: 'unknown' };
}

export async function addRequisitionLine(
  _prev: RequisitionActionResult | undefined,
  form: FormData,
): Promise<RequisitionActionResult> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  const requisitionId = String(form.get('requisitionId') ?? '');
  const productId = String(form.get('productId') ?? '');
  const qty = Number(String(form.get('qty') ?? '').trim());

  if (!requisitionId) return fail('form', 'unknown');
  if (!productId) return fail('product', 'productRequired');
  if (!Number.isInteger(qty) || qty < 1) {
    return fail('qty', String(form.get('qty') ?? '').trim() ? 'qtyPositive' : 'qtyRequired');
  }

  const { error } = await api.rpc('add_requisition_line', {
    p_requisition_id: requisitionId,
    p_product_id: productId,
    p_qty_requested: qty,
  });

  if (error) return translateDbError(error);

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
  return { ok: true, errors: [] };
}

export async function removeRequisitionLine(
  _prev: void,
  form: FormData,
): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  const lineId = String(form.get('lineId') ?? '');
  if (!lineId) return;

  // A failed removal is a no-op rather than a thrown error: the line is still
  // there and the list re-renders unchanged, which is the honest outcome. The
  // alternative -- surfacing an error for a line that is not removable because
  // the request was submitted -- would be noise about a state the user can see.
  await api.rpc('remove_requisition_line', { p_line_id: lineId });

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
}

export async function createRequisition(
  _prev: RequisitionActionResult,
  form: FormData,
): Promise<RequisitionActionResult> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  const facilityId = String(form.get('facilityId') ?? '');
  const justification = String(form.get('justification') ?? '');

  if (!facilityId) return fail('facility', 'facilityRequired');

  const { data, error } = await api.rpc('create_requisition', {
    p_facility_id: facilityId,
    // Omitted rather than null: the generated type marks a DEFAULT NULL parameter as
    // optional but not nullable, and the default is null anyway.
    ...(justification ? { p_justification: justification } : {}),
  });

  if (error) return translateDbError(error);

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
  return { ok: true, errors: [], code: (data as { id?: string } | null)?.id };
}

export async function submitRequisition(form: FormData): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  await api.rpc('submit_requisition', {
    p_requisition_id: String(form.get('requisitionId') ?? ''),
  });

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
}

/**
 * Approve, and therefore allocate.
 *
 * One action rather than two, because the FEFO result IS the approval. An
 * approver who could see an allocation and then approve it separately could
 * approve a different allocation than the one they were shown -- so the preview
 * and the decision are the same round trip, and the figure on screen is the
 * figure that was committed.
 */
export async function approveRequisition(form: FormData): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  await api.rpc('allocate_requisition', {
    p_requisition_id: String(form.get('requisitionId') ?? ''),
  });

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
}

export async function rejectRequisition(form: FormData): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const api = await getSupabaseApi();

  const note = String(form.get('note') ?? '').trim();
  if (!note) return;

  await api.rpc('reject_requisition', {
    p_requisition_id: String(form.get('requisitionId') ?? ''),
    p_note: note,
  });

  revalidatePath(`/${locale}/admin/inventory/requisitions`);
}
