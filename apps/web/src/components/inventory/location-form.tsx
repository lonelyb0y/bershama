'use client';

import { useActionState } from 'react';

import { saveLocation, type ActionResult } from '@/app/[locale]/admin/inventory/products/actions';
/** Only the labels this form uses, so it cannot drift against the product one. */
export interface LocationFormLabels {
  titleNewLocation: string;
  locationSaved: string;
  submitLocation: string;
  facility: string;
  code: string;
  nameEn: string;
  nameAr: string;
  kind: string;
  tempMinC: string;
  tempMaxC: string;
  isActive: string;
}

/**
 * The storage-location form.
 *
 * Lives beside the product form on the same screen, because the two are edited
 * by the same person in the same sitting: setting up a warehouse means creating
 * its locations and the products that will sit in them. A location with no
 * product, or a product with nowhere to live, is a half-finished setup.
 *
 * Kept in the same file as the product form so the two share one `Field` and one
 * error style. Two forms that differ by a pixel of padding read as two systems.
 */
export function LocationForm({
  canWrite,
  facilities,
  labels: l,
}: {
  canWrite: boolean;
  facilities: Array<{ id: string; label: string; code: string }>;
  labels: LocationFormLabels;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(saveLocation, {
    ok: false,
    errors: [],
  });

  if (!canWrite) return null;

  const errorFor = (field: string) => state.errors.find((e) => e.field === field)?.message;

  return (
    <details open={state.ok} className="w-fit max-w-full rounded-xl border">
      <summary className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium select-none hover:bg-[color:var(--text-muted)]/10">
        {l.titleNewLocation}
      </summary>

      <form action={formAction} className="w-[min(40rem,92vw)] space-y-4 border-t p-4">
        {state.ok && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600">
            {l.locationSaved}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{l.facility} *</span>
            <select
              name="facilityId"
              aria-invalid={errorFor('facilityId') ? true : undefined}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${errorFor('facilityId') ? 'border-red-500' : ''}`}
              defaultValue=""
            >
              <option value="" disabled>
                —
              </option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.code})
                </option>
              ))}
            </select>
            {errorFor('facilityId') && (
              <span role="alert" className="mt-1 block text-xs text-red-500">
                {errorFor('facilityId')}
              </span>
            )}
          </label>

          <Field label={l.code} name="code" error={errorFor('code')} required dir="ltr" />
          <Field label={l.nameEn} name="nameEn" error={errorFor('nameEn')} required />
          <Field label={l.nameAr} name="nameAr" error={errorFor('nameAr')} required dir="rtl" />

          <label className="block">
            <span className="mb-1 block text-xs font-medium">{l.kind}</span>
            <select name="kind" defaultValue="AMBIENT" className="w-full rounded-lg border px-3 py-2 text-sm">
              <option value="AMBIENT">AMBIENT</option>
              <option value="COLD">COLD</option>
              <option value="DISPENSE">DISPENSE</option>
              <option value="QUARANTINE">QUARANTINE</option>
              {/* IN_TRANSIT is not offered. It is a system-created staging
                  location for goods on a vehicle, and letting a user create one
                  by hand would produce a shelf that appears in stock counts but
                  is not physically somewhere. */}
            </select>
          </label>

          <Field
            label={l.tempMinC}
            name="tempMinC"
            type="number"
            error={errorFor('tempMinC')}
            dir="ltr"
            placeholder="2"
          />
          <Field
            label={l.tempMaxC}
            name="tempMaxC"
            type="number"
            error={errorFor('tempMaxC')}
            dir="ltr"
            placeholder="8"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked className="size-4 rounded border" />
          {l.isActive}
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-60"
        >
          {l.submitLocation}
        </button>
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
  placeholder,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  type?: string;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
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
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm ${error ? 'border-red-500' : ''}`}
      />
      {error && (
        <span role="alert" className="mt-1 block text-xs text-red-500">
          {error}
        </span>
      )}
    </label>
  );
}
