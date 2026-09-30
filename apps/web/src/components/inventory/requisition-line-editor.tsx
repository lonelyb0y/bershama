'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import {
  addRequisitionLine,
  removeRequisitionLine,
  type RequisitionActionResult,
} from '@/app/[locale]/admin/inventory/requisitions/actions';
/**
 * A catalogue product as the picker needs it. `alreadyOnRequest` is carried on
 * the option rather than looked up on render, so the duplicate check is a
 * property of the data the user is looking at.
 */
export interface ProductOption {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  alreadyOnRequest: boolean;
}

/**
 * The requisition line editor.
 *
 * ── why this is a search-then-add and not a grid of inputs ──────────────────
 *
 * A requisition is usually five to fifty products, and a warehouse supervisor
 * knows them by name or by a scan. A twenty-column grid with a dropdown on every
 * row makes them scroll and hunt; a type-ahead that filters the catalogue is the
 * same number of keystrokes as typing the name they already know. This is the
 * "Autocomplete: help users find results faster" pattern, and it is also why the
 * empty state below says "no lines yet" rather than showing a blank grid --
 * a blank grid reads as a broken screen, and there is nothing to type into yet.
 *
 * ── the error summary, which this form would fail without ──────────────────
 *
 * A dozen field errors with no summary means the user has to hunt for the red
 * text, and on a form this size several of them are off the visible area. So
 * failed validation renders a summary at the top with a link per error, and
 * focus moves to it -- the two behaviours together. The inline errors stay, so
 * the summary is a shortcut rather than a replacement.
 */

/** One field's state, so validation can run on blur rather than on submit. */
type Touched = Record<string, boolean>;

function validateLine(productId: string, qty: string, products: ProductOption[]): string[] {
  const errors: string[] = [];

  if (!productId) errors.push('product');
  const n = Number(qty);
  if (!qty.trim()) errors.push('qty');
  else if (!Number.isInteger(n) || n < 1) errors.push('qty');

  // A product already on the request is a double-entry, and the unique index on
  // (tenant, requisition, product) would reject it as a duplicate key. Caught
  // here instead, with a message that says what to do about it.
  if (productId && products.some((p) => p.id === productId && p.alreadyOnRequest)) {
    errors.push('duplicate');
  }

  return errors;
}

export function RequisitionLineEditor({
  requisitionId,
  products,
  canWrite,
  onChanged,
  labels: l,
}: {
  requisitionId: string;
  products: ProductOption[];
  canWrite: boolean;
  onChanged: () => void;
  labels: {
    add: string;
    product: string;
    quantity: string;
    searchProducts: string;
    noProducts: string;
    remove: string;
    removeLine: string;
    qtyRequired: string;
    qtyPositive: string;
    productRequired: string;
    duplicate: string;
    errorSummary: string;
    lineAdded: string;
    lineRemoved: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RequisitionActionResult, FormData>(
    addRequisitionLine,
    { ok: false, errors: [] },
  );
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [touched, setTouched] = useState<Touched>({});
  const [filter, setFilter] = useState('');
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);

  /*
   * Server errors and blur errors are one set, derived rather than stored twice.
   *
   * The first version of this set state inside the effect, which is the shape
   * React warns about: a setState in an effect triggers a second render pass and
   * the value could be one render stale. Deriving `lineErrors` during render from
   * the last server result, and using the effect only for the one thing that is
   * genuinely a side effect -- moving focus -- removes both problems.
   */
  const serverErrors = state.ok ? [] : state.errors.map((e) => e.field);
  const lineErrors = serverErrors.length > 0 ? serverErrors : localErrors;

  /*
   * Clear the form when an add succeeds.
   *
   * Done by adjusting state DURING render when `state` changes, which is React's
   * documented pattern for deriving state from a value that arrived rather than
   * from an event. The alternative -- clearing it in an effect -- is the shape
   * React warns about, and it also renders once with the old values still in the
   * fields, so the user sees the line they just added still sitting in the box.
   *
   * React 19 resets uncontrolled fields after a form action, but these are
   * controlled because blur validation needs their values, so the reset is ours
   * to do.
   */
  const [lastResult, setLastResult] = useState(state);
  if (state !== lastResult) {
    setLastResult(state);
    if (state.ok) {
      setProductId('');
      setQty('');
      setTouched({});
      setLocalErrors([]);
      onChanged();
    }
  }

  // The effect is for the one thing that is genuinely a side effect: moving DOM
  // focus. Nothing here sets state.
  useEffect(() => {
    if (!state.ok && state.errors.length > 0) {
      // So a keyboard or screen-reader user is told the submit failed without
      // having to go looking for it.
      summaryRef.current?.focus();
    }
  }, [state]);

  const available = products.filter((p) => !p.alreadyOnRequest);

  const matches = filter.trim()
    ? available.filter((p) => {
        const needle = filter.trim().toLowerCase();
        return (
          p.nameEn.toLowerCase().includes(needle) ||
          p.nameAr.includes(filter.trim()) ||
          p.sku.toLowerCase().includes(needle)
        );
      })
    : available;

  const blurCheck = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setLocalErrors(validateLine(productId, qty, products));
  };

  if (!canWrite) return null;

  const messageFor = (code: string) =>
    code === 'product'
      ? l.productRequired
      : code === 'qty'
        ? qty.trim()
          ? l.qtyPositive
          : l.qtyRequired
        : code === 'duplicate'
          ? l.duplicate
          : l.qtyRequired;

  /*
   * When an error is shown.
   *
   * Once a field has been blurred, or once the server has come back with errors,
   * the message stays. Not before: telling somebody their quantity is invalid
   * while they are still typing the first digit is noise, and it moves the text
   * under the cursor on a form they are mid-way through.
   */
  const showError = (code: string) =>
    lineErrors.includes(code) && (touched[code] === true || serverErrors.length > 0);

  return (
    <div className="space-y-3">
      {lineErrors.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="req-error-title"
          className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 outline-none"
        >
          <p id="req-error-title" className="text-sm font-medium text-red-600">
            {l.errorSummary}
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-red-600">
            {lineErrors.map((code) => (
              <li key={code}>
                <a href={`#req-${code}`} className="underline underline-offset-2">
                  {messageFor(code)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="requisitionId" value={requisitionId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="qty" value={qty} />

        <label className="block">
          <span className="mb-1 block text-xs font-medium">{l.searchProducts}</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={l.searchProducts}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            aria-describedby="req-product-hint"
          />
          <span id="req-product-hint" className="sr-only">
            {l.searchProducts}
          </span>
        </label>

        {/* A radio group rather than a <select>: the list is searchable, the
            selected value is visible before submitting, and a 40-item dropdown
            that also has to be scrolled is worse than a list you can read. */}
        <fieldset className="max-h-64 overflow-y-auto rounded-lg border p-1">
          <legend className="sr-only">{l.product}</legend>
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[color:var(--text-muted)]">
              {l.noProducts}
            </p>
          ) : (
            matches.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--surface-raised)]"
              >
                <input
                  type="radio"
                  name="product-choice"
                  value={p.id}
                  checked={productId === p.id}
                  onChange={() => {
                    setProductId(p.id);
                    setLocalErrors(validateLine(p.id, qty, products));
                  }}
                  className="size-4"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.nameEn}</span>
                  <span className="block truncate text-xs text-[color:var(--text-muted)]" dir="rtl">
                    {p.nameAr}
                  </span>
                </span>
                <span dir="ltr" className="shrink-0 font-mono text-xs text-[color:var(--text-muted)]">
                  {p.sku}
                </span>
              </label>
            ))
          )}
        </fieldset>
        {showError('product') && (
          <p id="req-product" role="alert" className="text-xs text-red-500">
            {l.productRequired}
          </p>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium">{l.quantity}</span>
          <input
            id="req-qty"
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => blurCheck('qty')}
            aria-invalid={showError('qty') || undefined}
            aria-describedby={showError('qty') ? 'req-qty-error' : undefined}
            className={`w-28 rounded-lg border px-3 py-2 text-sm ${showError('qty') ? 'border-red-500' : ''}`}
          />
          {showError('qty') && (
            <p id="req-qty-error" role="alert" className="mt-1 text-xs text-red-500">
              {messageFor('qty')}
            </p>
          )}
        </label>

        <button
          type="submit"
          disabled={pending || productId === ''}
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          {l.add}
        </button>
      </form>

      {state.ok && (
        <p className="text-sm text-emerald-600" role="status">
          {l.lineAdded}
        </p>
      )}
    </div>
  );
}

export function RemoveLineButton({
  lineId,
  labels,
}: {
  lineId: string;
  labels: { remove: string; removeLine: string };
}) {
  const [, formAction, pending] = useActionState(removeRequisitionLine, undefined);
  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="lineId" value={lineId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={labels.removeLine}
        className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-[color:var(--text-muted)]/10 disabled:opacity-50"
      >
        {labels.remove}
      </button>
    </form>
  );
}
