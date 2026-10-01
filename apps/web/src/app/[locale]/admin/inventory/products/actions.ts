'use server';

/**
 * Catalogue writes: products, batches, storage locations.
 *
 * These go straight through RLS rather than through the `api` schema, and that
 * is a deliberate choice rather than an omission. The rule in ADR 0002 is that
 * the api schema exists for things a caller may not do directly; creating a
 * product is something a warehouse manager is entitled to do, and the policy
 * `managers create products` already encodes exactly that check. A SECURITY
 * DEFINER wrapper would move the tenant filter into a place where it can be
 * forgotten, in exchange for adding nothing.
 *
 * What these actions add is the session-scoped client, so `tenant_id` comes from
 * the caller's own token and can never be a request parameter, and validation
 * that produces a field-level error rather than a PostgREST code.
 */

import { revalidatePath } from 'next/cache';

import { getSupabaseApi } from '@/lib/supabase/server';
import { getLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export interface FieldError {
  field: string;
  message: string;
}

export interface ActionResult {
  ok: boolean;
  errors: FieldError[];
  /** Set on success, for the form to show a confirmation. */
  message?: string;
}

const ok = (message?: string): ActionResult => ({ ok: true, errors: [], message });

/** Trimmed, and empty becomes null so the column means "not recorded". */
function optional(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s;
}

function requiredString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A money field, entered in pounds, returned in piastres.
 *
 * ADR 0004: money is integer minor units, never a float. Parsing is strict on
 * purpose -- exactly two decimal places, digits and one dot -- because this figure
 * goes into a margin a distributor is audited on, and a lenient parse that turns
 * "12,5" into 1250 or "1.2.3" into NaN is the kind of quiet wrong number that is
 * found a month later.
 *
 * An empty field is 0, which the column comment defines as "not priced yet" rather
 * than as free. Returning null would be tidier but the column is NOT NULL, and 0 is
 * the same thing with one fewer branch.
 */
function minorFromField(value: FormDataEntryValue | null): number {
  const raw = requiredString(value);
  if (raw === '') return 0;
  if (!/^\d+(\.\d{2})?$/.test(raw)) return 0;
  const [whole, frac = '00'] = raw.split('.');
  return Number(whole) * 100 + Number(frac);
}

function boolean(form: FormData, key: string): boolean {
  return form.get(key) === 'on' || form.get(key) === 'true';
}

function positiveInt(value: FormDataEntryValue | null, field: string, errors: FieldError[]): number {
  const raw = requiredString(value);
  const n = Number(raw);
  if (raw === '' || !Number.isInteger(n) || n <= 0) {
    errors.push({ field, message: 'A whole number greater than zero is required' });
    return 1;
  }
  return n;
}

/* ── products ──────────────────────────────────────────────────────────────── */

export async function saveProduct(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const locale = (await getLocale()) as Locale;
  const supabase = await getSupabaseApi();
  const errors: FieldError[] = [];

  const sku = requiredString(form.get('sku'));
  const nameEn = requiredString(form.get('nameEn'));
  const nameAr = requiredString(form.get('nameAr'));

  // Both names are required, not one with the other optional. Egyptian
  // pharmacies stock bilingual packaging, so a record with a single name cannot
  // be ordered against and a name is the one field that cannot be inferred.
  if (!sku) errors.push({ field: 'sku', message: 'A SKU is required' });
  if (!nameEn) errors.push({ field: 'nameEn', message: 'An English name is required' });
  if (!nameAr) errors.push({ field: 'nameAr', message: 'An Arabic name is required' });

  const packSize = positiveInt(form.get('packSize'), 'packSize', errors);
  const shelfLifeMonths = positiveInt(form.get('shelfLifeMonths'), 'shelfLifeMonths', errors);

  // GTIN is either absent or a valid EAN-13/8. Not validated for a check digit:
  // the check digit is derived from digits the manufacturer chooses, and a
  // length check catches the typo that actually happens, which is a missing or
  // doubled digit.
  const gtin = optional(form.get('gtin'));
  if (gtin && !/^\d{8}$|^\d{13,14}$/.test(gtin)) {
    errors.push({ field: 'gtin', message: 'A GTIN is 8 or 13 digits' });
  }

  const atcCode = optional(form.get('atcCode'));
  if (atcCode && !/^[A-Z]\d{2}[A-Z]?\d?$/i.test(atcCode)) {
    errors.push({ field: 'atcCode', message: 'An ATC code looks like N02BE01' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const row = {
    sku,
    name_en: nameEn,
    name_ar: nameAr,
    generic_name_en: optional(form.get('genericNameEn')),
    generic_name_ar: optional(form.get('genericNameAr')),
    brand: optional(form.get('brand')),
    form: requiredString(form.get('form')) || 'UNSPECIFIED',
    strength: requiredString(form.get('strength')),
    strength_unit: optional(form.get('strengthUnit')),
    pack_size: packSize,
    uom: requiredString(form.get('uom')) || 'unit',
    atc_code: atcCode?.toUpperCase() ?? null,
    gtin,
    eda_reg_no: optional(form.get('edaRegNo')),
    requires_prescription: boolean(form, 'requiresPrescription'),
    is_controlled: boolean(form, 'isControlled'),
    is_cold_chain: boolean(form, 'isColdChain'),
    shelf_life_months: shelfLifeMonths,
    is_active: form.get('isActive') !== 'off',
  };

    // Piastres from a field entered in pounds; see minorFromField.
    const sellPrice = minorFromField(form.get('sellPrice'));
const id = optional(form.get('id'));

    // Through api.* rather than a table write. The tenant triggers call private.*,
    // which a client role cannot name, so a direct insert or update returns 42501 --
    // and this form has been failing on exactly that, quietly enough that the
    // existence of the api functions was mistaken for their use here.
    //
    // Optional arguments are omitted rather than passed as null: the generated types
    // mark a DEFAULT NULL parameter as optional but not nullable, and omitting takes
    // the same default at runtime.
    const common = {
      p_sku: row.sku,
      p_name_en: row.name_en,
      p_name_ar: row.name_ar,
      p_form: row.form,
      p_requires_prescription: row.requires_prescription,
      p_is_controlled: row.is_controlled,
      p_is_cold_chain: row.is_cold_chain,
      p_shelf_life_months: row.shelf_life_months,
      ...(row.generic_name_en ? { p_generic_name_en: row.generic_name_en } : {}),
      ...(row.generic_name_ar ? { p_generic_name_ar: row.generic_name_ar } : {}),
      ...(row.brand ? { p_brand: row.brand } : {}),
      ...(row.strength ? { p_strength: row.strength } : {}),
      ...(row.strength_unit ? { p_strength_unit: row.strength_unit } : {}),
      ...(row.pack_size ? { p_pack_size: row.pack_size } : {}),
      ...(row.uom ? { p_uom: row.uom } : {}),
      ...(row.atc_code ? { p_atc_code: row.atc_code } : {}),
      ...(row.gtin ? { p_gtin: row.gtin } : {}),
      ...(row.eda_reg_no ? { p_eda_reg_no: row.eda_reg_no } : {}),
    };

    const { error } = id
      ? await supabase.rpc('update_product', {
          p_id: id,
          ...common,
          p_is_active: row.is_active,
          p_sell_price_minor: sellPrice,
        })
      : await supabase.rpc('create_product', common);

  if (error) {
    // 23505 is a unique violation. On `sku` it is the single most likely thing a
    // user will hit, and "duplicate key" is not an answer to "why did my save
    // fail"; the SKU is named instead.
    if (error.code === '23505') {
      return { ok: false, errors: [{ field: 'sku', message: 'That SKU is already in use' }] };
    }
    return { ok: false, errors: [{ field: 'form', message: error.message }] };
  }

  revalidatePath(`/${locale}/admin/inventory/products`);
  return ok(id ? undefined : 'created');
}

/**
 * Products are deactivated, not deleted.
 *
 * A product can be years deep in stock, batches, movements and audit history, and
 * a hard delete would either cascade through all of that or fail on the
 * foreign keys -- and either way it destroys the evidence that the stock existed.
 * is_active keeps the row and its history while taking it out of ordering.
 */
export async function setProductActive(form: FormData): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const supabase = await getSupabaseApi();

  // Read from the form rather than taking bound arguments. A closure or a
  // `.bind()` in a Server Component's <form action> is a function passed to a
  // Client Component, which React refuses -- "Functions cannot be passed
  // directly to Client Components unless you explicitly expose it by marking it
  // with use server". Hidden inputs carry the same two values with none of that.
  const id = optional(form.get('id'));
  const active = form.get('active') === 'true';

  if (!id) {
    throw new Error('setProductActive called without an id');
  }

  const { error } = await supabase.rpc('set_product_active', { p_id: id, p_active: active });
  if (error) {
    // A failed deactivation that renders as a successful one is worse than an
    // error: the row simply does not change on the next render, and the person
    // who clicked believes the product is inactive.
    throw new Error(`setProductActive failed: ${error.code} ${error.message}`);
  }

  revalidatePath(`/${locale}/admin/inventory/products`);
}

/* ── storage locations ─────────────────────────────────────────────────────── */

export async function saveLocation(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const locale = (await getLocale()) as Locale;
  const supabase = await getSupabaseApi();
  const errors: FieldError[] = [];

  const code = requiredString(form.get('code'));
  const nameEn = requiredString(form.get('nameEn'));
  const nameAr = requiredString(form.get('nameAr'));
  const facilityId = requiredString(form.get('facilityId'));

  if (!code) errors.push({ field: 'code', message: 'A code is required' });
  if (!nameEn) errors.push({ field: 'nameEn', message: 'An English name is required' });
  if (!nameAr) errors.push({ field: 'nameAr', message: 'An Arabic name is required' });
  if (!facilityId) errors.push({ field: 'facilityId', message: 'A facility is required' });

  // A cold-store threshold above the warm threshold would silently produce a
  // range that can never be satisfied, so the pair is checked here rather than
  // left to a constraint nobody reads.
  const minC = Number(optional(form.get('tempMinC')) ?? '');
  const maxC = Number(optional(form.get('tempMaxC')) ?? '');
  if (form.get('tempMinC') && form.get('tempMaxC') && minC > maxC) {
    errors.push({ field: 'tempMaxC', message: 'The maximum cannot be below the minimum' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const row = {
    facility_id: facilityId,
    code,
    name_en: nameEn,
    name_ar: nameAr,
    kind: requiredString(form.get('kind')) || 'AMBIENT',
    temp_min_c: form.get('tempMinC') ? minC : null,
    temp_max_c: form.get('tempMaxC') ? maxC : null,
    is_active: form.get('isActive') !== 'off',
  };

  const id = optional(form.get('id'));
  const { error } = id
    ? await supabase.rpc('update_location', {
          p_id: id,
          p_code: row.code,
          p_name_en: row.name_en,
          p_name_ar: row.name_ar,
          p_kind: row.kind,
          ...(row.temp_min_c === null ? {} : { p_temp_min_c: row.temp_min_c }),
          ...(row.temp_max_c === null ? {} : { p_temp_max_c: row.temp_max_c }),
        })
      : await supabase.rpc('create_location', {
          p_code: row.code,
          p_facility_id: row.facility_id,
          p_name_en: row.name_en,
          p_name_ar: row.name_ar,
          p_kind: row.kind,
          ...(row.temp_min_c === null ? {} : { p_temp_min_c: row.temp_min_c }),
          ...(row.temp_max_c === null ? {} : { p_temp_max_c: row.temp_max_c }),
        });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, errors: [{ field: 'code', message: 'That code is already in use here' }] };
    }
    return { ok: false, errors: [{ field: 'form', message: error.message }] };
  }

  revalidatePath(`/${locale}/admin/inventory/products`);
  return ok();
}
