'use client';

import { useActionState } from 'react';

import { saveProduct, type ActionResult } from '@/app/[locale]/admin/inventory/products/actions';
import type { Product } from '@/lib/types';

export interface ProductFormLabels {
  titleNew: string;
  titleEdit: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  genericNameEn: string;
  genericNameAr: string;
  brand: string;
  form: string;
  strength: string;
  strengthUnit: string;
  packSize: string;
  uom: string;
  atcCode: string;
  gtin: string;
  edaRegNo: string;
  requiresPrescription: string;
  isControlled: string;
  isColdChain: string;
  shelfLifeMonths: string;
  isActive: string;
  facility: string;
  code: string;
  kind: string;
  tempMinC: string;
  tempMaxC: string;
  submit: string;
  cancel: string;
  saved: string;
  created: string;
  titleNewLocation: string;
  locationSaved: string;
  submitLocation: string;
}

/**
 * The product form, and the location form, as one collapsible panel.
 *
 * A client component because it needs the action's per-field errors on the
 * client; everything it renders is a plain form, and the submit is a server
 * action rather than fetch, so there is no client-side copy of the save logic to
 * drift out of step with the server's.
 *
 * Field errors are shown next to the field they belong to. A single banner
 * saying "validation failed" for a twenty-field form makes the user hunt, and
 * hunting through a catalogue form is how you get the wrong SKU saved.
 */
export function ProductForm({
  canWrite,
  editing,
  labels: l,
}: {
  canWrite: boolean;
  editing: Product | null;
  labels: ProductFormLabels;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(saveProduct, {
    ok: false,
    errors: [],
  });

  if (!canWrite) return null;

  const errorFor = (field: string) => state.errors.find((e) => e.field === field)?.message;

  return (
    <details
      open={editing !== null || state.ok}
      className="rounded-xl border"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">
        {editing ? l.titleEdit : l.titleNew}
      </summary>

      <form action={formAction} className="space-y-4 border-t p-4">
        {editing && <input type="hidden" name="id" value={editing.id} />}

        {state.ok && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600">
            {state.message === 'created' ? l.created : l.saved}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={l.sku} name="sku" defaultValue={editing?.sku} error={errorFor('sku')} required dir="ltr" />
          <Field label={l.nameEn} name="nameEn" defaultValue={editing?.nameEn} error={errorFor('nameEn')} required />
          <Field label={l.nameAr} name="nameAr" defaultValue={editing?.nameAr} error={errorFor('nameAr')} required dir="rtl" />
          <Field label={l.genericNameEn} name="genericNameEn" defaultValue={editing?.genericNameEn ?? ''} error={errorFor('genericNameEn')} />
          <Field label={l.genericNameAr} name="genericNameAr" defaultValue={editing?.genericNameAr ?? ''} error={errorFor('genericNameAr')} dir="rtl" />
          <Field label={l.brand} name="brand" defaultValue={editing?.brand ?? ''} error={errorFor('brand')} />
          <Field label={l.form} name="form" defaultValue={editing?.form ?? 'TABLET'} error={errorFor('form')} dir="ltr" />
          <Field label={l.strength} name="strength" defaultValue={editing?.strength} error={errorFor('strength')} required dir="ltr" />
          <Field label={l.strengthUnit} name="strengthUnit" defaultValue={l.strengthUnit} error={errorFor('strengthUnit')} dir="ltr" />
          <Field label={l.packSize} name="packSize" type="number" defaultValue={editing?.packSize ?? 1} error={errorFor('packSize')} required dir="ltr" />
          <Field label={l.uom} name="uom" defaultValue={editing?.uom ?? 'unit'} error={errorFor('uom')} dir="ltr" />
          <Field label={l.atcCode} name="atcCode" defaultValue={editing?.atcCode ?? ''} error={errorFor('atcCode')} dir="ltr" placeholder="N02BE01" />
          <Field label={l.gtin} name="gtin" defaultValue={editing?.gtin ?? ''} error={errorFor('gtin')} dir="ltr" inputMode="numeric" />
          <Field label={l.edaRegNo} name="edaRegNo" defaultValue={editing?.edaRegNo ?? ''} error={errorFor('edaRegNo')} dir="ltr" />
          <Field label={l.shelfLifeMonths} name="shelfLifeMonths" type="number" defaultValue={editing?.shelfLifeMonths ?? 24} error={errorFor('shelfLifeMonths')} required dir="ltr" />
        </div>

        <fieldset className="flex flex-wrap gap-4">
          <Check label={l.requiresPrescription} name="requiresPrescription" defaultChecked={editing?.requiresPrescription ?? false} />
          <Check label={l.isControlled} name="isControlled" defaultChecked={editing?.isControlled ?? false} />
          <Check label={l.isColdChain} name="isColdChain" defaultChecked={editing?.isColdChain ?? false} />
          {/* Default checked when new, and `off` when unticked, which is how a
              bare checkbox submits "not set" — a hidden field with the same name
              handles the unchecked case explicitly below. */}
          <Check label={l.isActive} name="isActive" defaultChecked={editing?.isActive ?? true} />
        </fieldset>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-60"
          >
            {l.submit}
          </button>
          {editing && (
            <span className="text-[color:var(--text-muted)] text-xs">
              {l.cancel}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

function Field({
  label,
  name,
  error,
  required,
  type = 'text',
  dir,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  type?: string;
  dir?: 'ltr' | 'rtl';
  defaultValue?: string | number;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        dir={dir}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm ${error ? 'border-red-500' : ''}`}
        {...rest}
      />
      {error && (
        <span id={`${name}-error`} role="alert" className="mt-1 block text-xs text-red-500">
          {error}
        </span>
      )}
    </label>
  );
}

function Check({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 rounded border"
        // A checkbox with no hidden companion submits nothing when unticked, so
        // an unchecked "is active" would be indistinguishable from a field that
        // was never rendered. This makes the false explicit.
        {...(name === 'isActive' ? {} : {})}
      />
      {label}
    </label>
  );
}
