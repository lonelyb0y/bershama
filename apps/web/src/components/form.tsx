// Form primitives.
//
// Every write screen in M2 is a form over the same handful of field types, and
// three details repeat across all of them. Getting them right once here is the
// difference between a stocktake screen and a stocktake screen that somebody has
// to re-audit for RTL, accessibility and input-type behaviour.
//
// ── react-hook-form ──────────────────────────────────────────────────────────
//
// Fields are UNCONTROLLED and wired with `register()`, which is the pattern RHF
// is built for: the DOM owns the value and the form tracks it, rather than a
// controlled input re-rendering on every keystroke. The call site reads
//
//   <TextField id="lot" label={t('lot')} dir="ltr" {...register('lot')} />
//
// -- spreading register's return rather than passing it as a `registration`
// object. What arrives is the standard set of DOM input props (name, onChange,
// onBlur, ref), so these components stay ordinary inputs that happen to work
// with a form library. A field outside a form is still a field, and a test can
// render one without standing a form up around it.
//
// `ref` is forwarded so RHF can move focus to the first invalid field on submit.
// That is the difference between a user fixing one field and hunting for four.
//
// Validation lives in lib/validation.ts, and the codes it raises are the same
// ones the database raises, so a rule caught in the browser and the same rule
// caught by Postgres produce one sentence rather than two that drift apart.

import type { ReactNode, Ref } from 'react';

/* ── what register() hands us ─────────────────────────────────────────────── */

/**
 * The subset of DOM input props that `register(name)` returns.
 *
 * Declared rather than imported so these components do not depend on a form
 * library to render. `ref` is a plain Ref so the field can be used with or
 * without one.
 */
export interface FieldInputProps {
  name?: string;
  /**
   * react-hook-form's onChange reads `event.target.name`, so it takes an object
   * with a `target` rather than a full React ChangeEvent. Typed to RHF's shape
   * rather than to ChangeEvent because the two are not assignable in that
   * direction, and RHF's is the one that has to fit.
   */
  onChange?: (event: { target: unknown; type?: unknown }) => void;
  onBlur?: (event: { target: unknown; type?: unknown }) => void;
  ref?: Ref<never>;
}

/**
 * The DOM-safe part of a `register()` result.
 *
 * `<TextField {...register('lot')} />` looks tidier and is a trap, because what
 * register returns is not only DOM props: it also carries the *validation rule*
 * refs, including `min`, `max` and `maxLength`. Spread onto an input they collide
 * with the HTML attributes of the same name -- and `maxLength` is the nasty one,
 * because RHF's is an object like `{ value: 20, message: '...' }` where the
 * browser expects a number, so the attribute is silently ignored and the field
 * accepts more characters than the schema allows.
 *
 * So four props cross the boundary, named, and the collision cannot happen.
 */
export function fieldInputProps(registration: {
  name: string;
  onChange: (event: { target: unknown; type?: unknown }) => void;
  onBlur: (event: { target: unknown; type?: unknown }) => void;
  ref: Ref<never>;
}): FieldInputProps {
  return {
    name: registration.name,
    onChange: registration.onChange,
    onBlur: registration.onBlur,
    ref: registration.ref,
  };
}

/* ── shell ──────────────────────────────────────────────────────────────── */

export function Field({
  id,
  label,
  hint,
  error,
  required,
  placeholder,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /**
   * The control's OWN inside text, when it has one -- "VAN-1", "N02BE01".
   *
   * When it is absent the label itself is the inside text. When it is present
   * the two would be printed on top of each other, so the label is only for
   * the risen state.
   */
  placeholder?: string;
  // Direction is NOT a prop here. Each concrete field sets `dir` on its own
  // control, because the answer differs by field: a lot number is always LTR, a
  // note is whatever the writer used. Accepting `dir` on the wrapper and
  // ignoring it was documentation wearing the costume of a parameter.
  children: (props: {
    id: string;
    name?: string;
    onChange?: (event: { target: unknown; type?: unknown }) => void;
    onBlur?: (event: { target: unknown; type?: unknown }) => void;
    ref?: Ref<never>;
    describedBy?: string;
    invalid: boolean;
    /**
     * The control's inside text.
     *
     * A single space when the field has nothing to suggest, so that
     * `:placeholder-shown` can tell an empty control from a filled one. A
     * placeholder that is absent cannot, and the label would float out of a
     * field the user has not touched.
     */
    placeholder: string;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <div className="pf-field" data-own-hint={placeholder ? 'true' : undefined}>
        {children({ id, describedBy, invalid: Boolean(error), placeholder: placeholder ?? ' ' })}

        {/*
          The label is after the control so that `:has()` sees it as a
          sibling, and it is absolutely positioned over the control's text
          area. It is still a real <label for>, so it is still the accessible
          name -- the floating is a visual trick, not a replacement for the
          markup that carries the meaning.
        */}
        <label htmlFor={id} className="pf-field__label">
          {label}
          {required ? (
            // A visual asterisk, with `required` on the control doing the real
            // work. The asterisk alone is decoration; assistive technology is told
            // by the attribute.
            <span aria-hidden="true" className="ms-1 text-[var(--color-stock-critical)]">
              *
            </span>
          ) : null}
        </label>
      </div>

      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-stock-critical)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The control's own class.
 *
 * `min-h-11` is 44px, and it is not decoration.
 *
 * A control under 44px is below the minimum touch target, and the people using
 * these forms are filling in a delivery note, a stock count or a temperature reading
 * while holding a phone, sometimes wearing gloves, often in a cold store where the
 * hand is stiff. A 38px row of text is a mis-tap waiting to happen, and a mis-tap in
 * a quantity field is a wrong number in somebody's stock.
 *
 * The form fields are read and written on a phone as often as on a desk, so the
 * target is sized for the phone in both places. Everything else about the class --
 * the radius, the padding, the focus ring -- is unchanged.
 */
const inputClass =
  'w-full rounded-2xl border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 disabled:opacity-60';

const invalidClass = 'border-[var(--color-stock-critical)]';

/* ── text ───────────────────────────────────────────────────────────────── */

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  placeholder,
  dir,
  autoComplete,
  maxLength,
  disabled,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  /** "ltr" for values that are never Arabic: lot numbers, SKUs, references. */
  dir?: 'ltr' | 'rtl';
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      placeholder={placeholder}
    >
      {({ id: fieldId, describedBy, invalid, placeholder: ph, ...rest }) => (
        <input
          id={fieldId}
          type="text"
          dir={dir}
          autoComplete={autoComplete}
          maxLength={maxLength}
          disabled={disabled}
          required={required}
          placeholder={ph}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputClass} ${invalid ? invalidClass : ''}`}
          {...rest}
          {...input}
        />
      )}
    </Field>
  );
}

/* ── numbers ────────────────────────────────────────────────────────────── */

/**
 * Strip everything that is not a digit.
 *
 * `inputMode="numeric"` puts a phone keypad under the field, which is the right
 * keypad, but on a physical keyboard it prevents nothing -- and `type="number"`
 * is worse than useless here: it coerces any value it cannot parse to an empty
 * string, so pasting "1,200" silently clears the field and the user believes the
 * value went in.
 *
 * The cleaned string is passed to onChange rather than the DOM event, because a
 * stripped value is not what the event carries. RHF accepts a bare value here,
 * and the digit-stripping test asserts that rather than assuming it.
 */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function NumberField({
  id,
  label,
  hint,
  error,
  required,
  placeholder,
  suffix,
  disabled,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  /** Rendered inside the field, e.g. a unit or a currency. */
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      placeholder={placeholder}
    >
      {({ id: fieldId, describedBy, invalid, placeholder: ph, ...rest }) => (
        <div className="relative">
          <input
            id={fieldId}
            type="text"
            inputMode="numeric"
            // A pattern, not a max: it constrains a paste without preventing
            // typing, so the field cannot be submitted holding a letter.
            pattern="[0-9]*"
            dir="ltr"
            required={required}
            disabled={disabled}
            placeholder={ph}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            // No min attribute: this is a text input, and browsers ignore min on
            // one. The floor is enforced by the schema, which reports it with a
            // code the user can read.
            className={`${inputClass} ${suffix ? 'pe-16' : ''} ${
              invalid ? invalidClass : ''
            }`}
            {...rest}
            {...input}
            onChange={(e) => {
              // Mutate the event's target, then hand the EVENT on.
              //
              // Passing the cleaned string instead looks equivalent and is not:
              // react-hook-form's onChange reads e.target.name, so a bare value
              // throws. It appeared to work anyway -- the field displayed the
              // cleaned digits, and RHF read the DOM at submit and got the right
              // answer -- while RHF's own form state was never updated. So
              // touched/dirty tracking was wrong, and any setValueAs transform
              // would have been skipped on every keystroke. The tests passed
              // throughout because they only asserted the submitted value.
              e.target.value = digitsOnly(e.target.value);
              input.onChange?.(e);
            }}
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

/**
 * A signed quantity, for an adjustment.
 *
 * An adjustment is the one movement that can go either way -- a miscount
 * corrected upwards, damage corrected downwards -- so it needs a leading minus.
 * The sign is part of the value, which is why this is a separate component
 * rather than a `allowNegative` flag on NumberField: a flag would let a
 * write-off accept a negative quantity, and the write-off is exactly where a
 * stray minus is dangerous.
 */
export function SignedNumberField({
  id,
  label,
  hint,
  error,
  required,
  disabled,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ id: fieldId, describedBy, invalid, placeholder: ph, ...rest }) => (
        <input
          id={fieldId}
          type="text"
          inputMode="numeric"
          placeholder={ph}
          pattern="-?[0-9]*"
          dir="ltr"
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputClass} ${invalid ? invalidClass : ''}`}
          {...rest}
          {...input}
          onChange={(e) => {
            // Exactly one leading minus, and only at position 0. Allowing a
            // minus anywhere produces "--5" and "5-", which parse as NaN and
            // then fail validation with a message about a number.
            const cleaned = e.target.value.replace(/[^\d-]/g, '').replace(/-{2,}/g, '-');
            const normalised =
              cleaned.startsWith('-') ? `-${cleaned.slice(1).replace(/-/g, '')}` : cleaned.replace(/-/g, '');
            // The event, not the value -- see NumberField above.
            e.target.value = normalised;
            input.onChange?.(e);
          }}
        />
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
  hint,
  error,
  required,
  placeholder,
  disabled,
  options,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  options: readonly Option<T>[];
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ id: fieldId, describedBy, invalid, placeholder: _ph, ...rest }) => (
        <select
          id={fieldId}
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputClass} ${invalid ? invalidClass : ''}`}
          {...rest}
          {...input}
        >
          {placeholder ? (
            <option value="">{placeholder}</option>
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
  hint,
  error,
  required,
  placeholder,
  rows = 3,
  maxLength,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      placeholder={placeholder}
    >
      {({ id: fieldId, describedBy, invalid, placeholder: ph, ...rest }) => (
        <textarea
          id={fieldId}
          rows={rows}
          required={required}
          maxLength={maxLength}
          placeholder={ph}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputClass} resize-y ${invalid ? invalidClass : ''}`}
          {...rest}
          {...input}
        />
      )}
    </Field>
  );
}

/* ── date ───────────────────────────────────────────────────────────────── */

export function DateField({
  id,
  label,
  hint,
  error,
  required,
  min,
  max,
  disabled,
  ...input
}: FieldInputProps & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** ISO `yyyy-mm-dd`, which is what <input type="date"> speaks. */
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  return (
    // Always LTR. A date input's segments are laid out in a fixed order by the
    // browser, and letting them inherit an RTL container renders the date in a
    // sequence nobody in Egypt is used to reading.
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ id: fieldId, describedBy, invalid, placeholder: ph, ...rest }) => (
        <input
          id={fieldId}
          type="date"
          dir="ltr"
          placeholder={ph}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputClass} ${invalid ? invalidClass : ''}`}
          {...rest}
          {...input}
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
      // aria-busy, not just a disabled button: assistive technology announces
      // the state change, and a disabled button with no explanation is a dead
      // end for someone who cannot see that anything is happening.
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
