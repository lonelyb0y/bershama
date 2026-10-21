'use client';

import { useActionState, useEffect, useRef } from 'react';

import { createRequisition, type RequisitionActionResult } from '@/app/[locale]/admin/inventory/requisitions/actions';
import type { Locale } from '@/i18n/routing';

/**
 * "Raise a request" — a facility and a reason, nothing else.
 *
 * ── why it is a form and not a link to an empty page ────────────────────────
 *
 * A request needs exactly two decisions before it has any content: who it is
 * for, and why. Everything else is adding lines, which happens on the request
 * itself. So this form is two fields, and the screen it creates is the screen
 * you then work in -- rather than a route that exists only to host a form.
 *
 * The justification is optional in the database and still requested here, as a
 * hint rather than a requirement. A warehouse that runs out of a seasonal line
 * every March should not be blocked by a text box, and a request nobody can
 * explain later is the thing this field is for.
 */
export function NewRequisitionForm({
  facilities,
  locale,
  labels: l,
}: {
  facilities: Array<{ id: string; nameEn: string; nameAr: string | null; code: string; kind: string }>;
  locale: Locale;
  labels: {
    title: string;
    facility: string;
    justification: string;
    justificationHint: string;
    submit: string;
    facilityRequired: string;
    errorSummary: string;
    created: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RequisitionActionResult, FormData>(
    createRequisition,
    { ok: false, errors: [] },
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.ok && state.errors.length > 0) {
      summaryRef.current?.focus();
    }
  }, [state]);

  // Facilities a request can be raised against: pharmacies for a pharmacy
  // manager's own site, anything for the distributor side. Filtering here rather
  // than in the database is fine -- the list is a dozen rows and the list is
  // already tenant-scoped by RLS.
  const options = facilities.filter((f) => f.kind === 'PHARMACY' || f.kind === 'WAREHOUSE');

  if (state.ok) {
    return (
      <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-600">
        {l.created}
      </p>
    );
  }

  return (
    <details className="rounded-xl border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">{l.title}</summary>

      <form action={formAction} className="space-y-3 border-t p-4">
        {state.errors.length > 0 && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            aria-labelledby="new-req-error"
            className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 outline-none"
          >
            <p id="new-req-error" className="text-sm font-medium text-red-600">
              {l.errorSummary}
            </p>
            <ul className="list-inside list-disc text-sm text-red-600">
              {state.errors.map((e) => (
                <li key={e.field}>
                  <a href="#new-req-facility" className="underline underline-offset-2">
                    {e.field === 'facility' ? l.facilityRequired : e.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="pf-field block">
          <span className="pf-field__label">{l.facility}</span>
          <select
            id="new-req-facility"
            name="facilityId"
            required
            aria-invalid={state.errors.some((e) => e.field === 'facility') || undefined}
            className="w-full rounded-2xl border px-3 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              —
            </option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {locale === 'ar' ? (f.nameAr ?? f.nameEn) : f.nameEn} ({f.code})
              </option>
            ))}
          </select>
        </label>

        <label className="pf-field block">
          <span className="pf-field__label">{l.justification}</span>
          <textarea
            name="justification"
            rows={2}
            placeholder={l.justificationHint}
            className="w-full rounded-2xl border px-3 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          {l.submit}
        </button>
      </form>
    </details>
  );
}
