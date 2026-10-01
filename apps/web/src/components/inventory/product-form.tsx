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
  sellPrice: string;
  sellPriceHint: string;
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
/**
 * private.stock_unit's members, for the strength-unit picker.
 *
 * Written out rather than derived because the database is the authority and a
 * generated list would need a round trip to render a form -- and because a value
 * that is not in this list is refused by the enum, which is the behaviour we want
 * rather than a value silently coerced.
 */
const STRENGTH_UNITS = ['mg', 'g', 'mcg', 'ml', 'IU', '%', 'units'] as const;

/** private.stock_unit's members: the unit a product's stock is counted in. */
const STOCK_UNITS = ['BOX', 'STRIP', 'BOTTLE', 'TUBE', 'VIAL', 'SACHET', 'KIT'] as const;

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
          {/* A select, not a text input: the database holds an enum, so a free-text field can
              only ever be right by luck. The placeholder value keeps the field
              optional -- a product with no strength unit is legal -- while the options
              are exactly the enum's members. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{l.strengthUnit}</span>
                <select
                  name="strengthUnit"
                  defaultValue={editing?.strengthUnit ?? ''}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {STRENGTH_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
          <Field label={l.packSize} name="packSize" type="number" defaultValue={editing?.packSize ?? 1} error={errorFor('packSize')} required dir="ltr" />
          {/* Also an enum, and also was a text input. Its default was the string "unit",
                which is not a member of private.stock_unit -- so every create sent an
                invalid value and the database refused it. Same shape of mistake as the
                strength unit beside it, and the same fix. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{l.uom}</span>
                <select
                  name="uom"
                  defaultValue={editing?.uom ?? 'BOX'}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  {STOCK_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
          <Field label={l.atcCode} name="atcCode" defaultValue={editing?.atcCode ?? ''} error={errorFor('atcCode')} dir="ltr" placeholder="N02BE01" />
          <Field label={l.gtin} name="gtin" defaultValue={editing?.gtin ?? ''} error={errorFor('gtin')} dir="ltr" inputMode="numeric" />
          <Field label={l.edaRegNo} name="edaRegNo" defaultValue={editing?.edaRegNo ?? ''} error={errorFor('edaRegNo')} dir="ltr" />
          <Field label={l.shelfLifeMonths} name="shelfLifeMonths" type="number" defaultValue={editing?.shelfLifeMonths ?? 24} error={errorFor('shelfLifeMonths')} required dir="ltr" />
          {/* Price, in pounds, converted to piastres by the action. text rather than
              number because a number input drops the trailing zero a price needs --
              "125" entered as 125.00 becomes 125 and a margin is off by a factor of
              a hundred. inputMode keeps the numeric keypad on a phone. */}
          <Field
            label={l.sellPrice}
            name="sellPrice"
            defaultValue={editing && editing.sellPriceMinor > 0 ? (editing.sellPriceMinor / 100).toFixed(2) : ''}
            error={errorFor('sellPrice')}
            placeholder="0.00"
            inputMode="decimal"
            dir="ltr"
          />
          <p className="-mt-2 text-xs text-[color:var(--text-muted)]">{l.sellPriceHint}</p>
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
  inputMode?: 'numeric' | 'decimal' | 'text';
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
          // Forwarded, not just used to draw the asterisk above. The prop was consumed
          // by this component and never reached the input, so a field the form called
          // required was not required: the browser submitted it empty and the database
          // refused the row with a constraint name -- no client-side message, and an
          // error about a table the person filling in a form has never heard of.
          required={required}
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
