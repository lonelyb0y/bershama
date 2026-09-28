// Form primitives.
//
// Every write screen in M2 is a form over the same handful of field types, and
// three details repeat across all of them. Getting them right once here is the
// difference between a stocktake screen and a stocktake screen that somebody has
// to re-audit for RTL, accessibility and input-type behaviour.
//
//   1. `id` and `htmlFor` are paired, always. A label that is not associated with
//      its control is invisible to a screen reader, and this is an application
//      used in a warehouse by people wearing gloves.
//
//   2. The error message is tied to the input with `aria-describedby` and
//      `aria-invalid`, so it is announced when focus lands on the field rather
//      than only at the top of the form.
//
//   3. `dir="ltr"` on fields whose content is always left-to-right. A lot number,
//      a SKU, an email or a cost reordering inside an RTL container looks like a
//      typo to the person reading it, and they will transcribe it wrong.
//
// Numbers get more attention than they look like they need. Stock is whole units
// and money is integer minor units, so the input is `inputMode="numeric"` (a
// phone keypad, no letters) rather than `type="number"` -- which silently returns
// '' for anything non-numeric, so a pasted value with a thousands separator
// vanishes with no error. The value is kept as a string and parsed on submit,
// because a controlled number input cannot represent "being typed".

import type { ReactNode } from 'react';

/* ── shell ──────────────────────────────────────────────────────────────── */

export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  // Direction is NOT a prop here. Each concrete field sets `dir` on its own
  // control, because the answer differs by field: a lot number is always LTR, a
  // note is whatever the writer used. Accepting `dir` on the wrapper and
  // ignoring it was documentation wearing the costume of a parameter.
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? (
          // A visual asterisk plus `required` on the control. The asterisk alone
          // is decoration; screen readers get the word from the control.
          <span aria-hidden="true" className="ms-1 text-[var(--color-stock-critical)]">
            *
          </span>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {hint}
        </p>
      ) : null}

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs text-[var(--color-stock-critical)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60';

/* ── text ───────────────────────────────────────────────────────────────── */

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  placeholder,
  dir,
  autoComplete,
  maxLength,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <input
          id={id}
          name={id}
          type="text"
          dir={dir}
          autoComplete={autoComplete}
          maxLength={maxLength}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`mt-1 ${inputClass} ${invalid ? 'border-[var(--color-stock-critical)]' : ''}`}
        />
      )}
    </Field>
  );
}

/* ── numbers ────────────────────────────────────────────────────────────── */

export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  placeholder,
  dir = 'ltr',
  min = 0,
  max,
  suffix,
  disabled,
}: {
  id: string;
  label: string;
  /** Kept as a string so a half-typed value is representable. */
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  min?: number;
  max?: number;
  /** A unit rendered inside the field, e.g. "EGP" or "boxes". */
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <div className="relative mt-1">
          <input
            id={id}
            name={id}
            // inputMode rather than type="number": a number input coerces
            // anything it cannot parse to an empty string, so pasting
            // "1,200" silently clears the field instead of showing an error.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            dir={dir}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            value={value}
            min={min}
            max={max}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            // Strip anything that is not a digit as it is typed, rather than
            // validating on submit. A field that cannot hold an invalid value
            // cannot be submitted invalid, and the reason is visible while
            // typing rather than after a round trip.
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
            className={`${inputClass} ${suffix ? 'pe-16' : ''} ${
              invalid ? 'border-[var(--color-stock-critical)]' : ''
            }`}
          />
          {suffix ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-[color:var(--text-muted)]"
            >
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/* ── select ─────────────────────────────────────────────────────────────── */

export interface Option<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SelectField<T extends string = string>({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  error,
  required,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  value: T | '';
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <select
          id={id}
          name={id}
          required={required}
          disabled={disabled}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value as T)}
          className={`mt-1 ${inputClass} ${invalid ? 'border-[var(--color-stock-critical)]' : ''}`}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/* ── textarea ───────────────────────────────────────────────────────────── */

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  placeholder,
  rows = 3,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <textarea
          id={id}
          name={id}
          rows={rows}
          required={required}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`mt-1 ${inputClass} resize-y ${
            invalid ? 'border-[var(--color-stock-critical)]' : ''
          }`}
        />
      )}
    </Field>
  );
}

/* ── date ───────────────────────────────────────────────────────────────── */

export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  min,
  max,
  disabled,
}: {
  id: string;
  label: string;
  /** ISO `yyyy-mm-dd`, which is what <input type="date"> speaks. */
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  return (
    // Always LTR. A date input's segments are laid out in a fixed order by the
    // browser, and letting them inherit an RTL container renders the date in a
    // sequence nobody in Egypt is used to reading.
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <input
          id={id}
          name={id}
          type="date"
          dir="ltr"
          required={required}
          disabled={disabled}
          value={value}
          min={min}
          max={max}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`mt-1 ${inputClass} ${
            invalid ? 'border-[var(--color-stock-critical)]' : ''
          }`}
        />
      )}
    </Field>
  );
}

/* ── buttons ────────────────────────────────────────────────────────────── */

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  pending,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const variants = {
    primary: 'bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)]',
    secondary:
      'border bg-transparent hover:bg-[color:var(--surface-raised)] disabled:hover:bg-transparent',
    danger: 'bg-[var(--color-stock-critical)] text-white hover:opacity-90',
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      // aria-busy, not just a disabled button: a screen reader announces the
      // state change, and a disabled button with no explanation is a dead end
      // for someone who cannot see that anything is happening.
      aria-busy={pending || undefined}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {pending ? (
        <>
          <span aria-hidden="true">…</span>
          <span className="sr-only">Working</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
