'use client';

// The stocktake count sheet.
//
// One row per batch at a location, with a box to type what is actually on the
// shelf. This is the screen where a wrong number becomes a wrong ledger, so most
// of the decisions here are about not letting a careless entry through.
//
// ── why the system quantity sits next to every box ──────────────────────────
//
// The counter needs to see what the books say while counting. Not to copy it --
// the two are meant to be compared -- but because a count taken without a
// reference is slower, not faster: the counter has to remember or re-fetch what
// they expected, and people count faster against a number than from memory. The
// variance is computed live so a mistake is visible before saving rather than in
// a reconciliation report a week later.
//
// ── why this is plain state and not a form library ──────────────────────────
//
// A count sheet is 5 to 500 rows of one shape. react-hook-form is built for a
// fixed set of named fields, and useFieldArray for a dynamic list whose length is
// the data -- which is not what this is: there is one implicit field per row and
// the interesting state is the set of BLANK ones. The blank-vs-zero distinction
// and per-line failure reporting are both easier to reason about as a record.
//
// The form library earns its place on the single-line movement forms, where
// cross-field validation and submit state matter. Reached for there.
//
// ── why the cell inputs are not the shared Field components ─────────────────
//
// Field is a vertical form control: label above, hint under it, error under
// that. Inside a table that layout is wrong, and repeating a visible "Counted"
// heading on 200 rows is noise. A cell input instead takes its accessible name
// from the row it sits in, via aria-label naming the product and the lot -- the
// spreadsheet pattern, where the column header and the row header together say
// what the cell holds.
//
// The digit-stripping behaviour is the same as NumberField's and is asserted
// here too, rather than assumed to be shared: two implementations of one rule is
// a risk, and the alternative -- a shared primitive wrapped for table layout --
// is more machinery than the rule deserves.

import { useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';

import { Button } from '@/components/form';
import { ErrorBanner, NoticeBanner, type ActionError } from '@/components/data';
import { daysToExpiry, expiryBand, formatQuantity } from '@/lib/format';
import { ADJUSTMENT_REASONS, REASON_CODES } from '@/lib/errors';
import type { SheetFailure, SheetLine } from '@/lib/api/stocktake-sheet';

export interface StocktakeRow {
  batchId: string;
  productId: string;
  lotNumber: string;
  productName: string;
  expiryDate: string;
  qtyOnHand: number;
}

export interface StocktakeSubmission {
  summary: string;
  failures: SheetFailure[];
}

export function CountSheet({
  locationId,
  rows,
  submit,
}: {
  locationId: string;
  rows: StocktakeRow[];
  /**
   * Injected rather than imported, so this component has no dependency on the
   * server action and can be tested with a plain function.
   */
  submit: (locationId: string, lines: SheetLine[]) => Promise<StocktakeSubmission>;
}) {
  const t = useTranslations('stocktake');
  const tInv = useTranslations('inventory');
  // next-intl types useLocale() as a bare string, so it will not narrow to the
  // application's Locale. Narrowed here once, because formatQuantity and the
  // reason labels both index on it and both fail to compile against a string.
  const locale = useLocale() as Locale;

  // Absent means "not counted", which is NOT the same as '0' meaning "counted,
  // and the shelf is empty". A missing key and a zero value are different facts.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<SheetFailure[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [formError, setFormError] = useState<ActionError | null>(null);

  const [isPending, startTransition] = useTransition();

  const enteredCount = useMemo(
    () => rows.filter((r) => (counts[r.batchId] ?? '').trim() !== '').length,
    [rows, counts],
  );

  function reset() {
    // A fresh edit invalidates the previous verdict about this sheet. Leaving
    // the old failure list on screen under the correction is how a user decides
    // the correction did not work.
    setFailures([]);
    setSummary(null);
  }

  function setCount(batchId: string, value: string) {
    setCounts((prev) => ({ ...prev, [batchId]: value }));
    reset();
  }

  function onSave() {
    setFormError(null);
    reset();

    const lines: SheetLine[] = rows.map((row) => ({
      productId: row.productId,
      batchId: row.batchId,
      countedQty: counts[row.batchId] ?? '',
      reasonCode: reasons[row.batchId] ?? '',
    }));

    startTransition(async () => {
      try {
        const result = await submit(locationId, lines);

        setSummary(result.summary);
        setFailures(result.failures);

        // A clean run clears the boxes. The counts are now in the books, and
        // re-submitting the same numbers would book a second variance if the
        // system figure moved in between.
        if (result.failures.length === 0) {
          setCounts({});
          setReasons({});
        }
      } catch (error) {
        setFormError({
          message:
            error instanceof Error
              ? error.message
              : 'The count sheet could not be saved. Nothing was changed.',
          code: 'submission_failed',
          isFallback: false,
        });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-sm text-[color:var(--text-muted)]">
        {t('noLines')}
      </div>
    );
  }

  const canSave = enteredCount > 0 && !isPending;
  const failedBatches = new Set(failures.map((f) => f.batchId));

  const reasonOptions = [
    { value: '', label: '—' },
    ...ADJUSTMENT_REASONS.map((code) => ({
      value: code as string,
      label: REASON_CODES[code][locale],
    })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[color:var(--text-muted)]">{t('blankMeansUncounted')}</p>

      {formError ? <ErrorBanner error={formError} /> : null}

      {summary ? (
        <NoticeBanner tone={failures.length > 0 ? 'info' : 'ok'}>{summary}</NoticeBanner>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="px-3 py-2.5 text-start font-medium text-[color:var(--text-muted)]">
                {tInv('batch')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium text-[color:var(--text-muted)]">
                {t('systemQty')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium text-[color:var(--text-muted)]">
                {t('variance')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium text-[color:var(--text-muted)]">
                {t('counted')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium text-[color:var(--text-muted)]">
                {t('reason')}
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const raw = counts[row.batchId] ?? '';
              const blank = raw.trim() === '';
              const typed = blank ? null : Number(raw);
              const variance =
                typed === null || Number.isNaN(typed) ? null : typed - row.qtyOnHand;
              const band = expiryBand(daysToExpiry(row.expiryDate));
              const name = `${row.productName}, ${row.lotNumber}`;
              const failed = failedBatches.has(row.batchId);

              return (
                <tr
                  key={row.batchId}
                  className={`border-b last:border-0 ${
                    failed ? 'bg-[var(--color-stock-critical)]/5' : ''
                  }`}
                >
                  <th scope="row" className="px-3 py-3 text-start font-normal">
                    <span className="block font-medium">{row.productName}</span>
                    {/* dir="ltr": a lot number reordering inside an RTL table
                        reads as a typo, and the counter is transcribing it off a
                        carton rather than generating it. */}
                    <span dir="ltr" className="block text-xs text-[color:var(--text-muted)]">
                      {row.lotNumber} · {row.expiryDate}
                    </span>
                    {band !== 'OK' ? (
                      <span
                        className={`mt-0.5 block text-xs ${
                          band === 'EXPIRED'
                            ? 'text-[var(--color-stock-expired)]'
                            : 'text-[var(--color-stock-warning)]'
                        }`}
                      >
                        {band === 'EXPIRED' ? t('expired') : t('expiringSoon')}
                      </span>
                    ) : null}
                  </th>

                  <td className="px-3 py-3 text-end tabular-nums text-[color:var(--text-muted)]">
                    {formatQuantity(row.qtyOnHand, { locale })}
                  </td>

                  <td
                    className={`px-3 py-3 text-end tabular-nums ${
                      variance === null || variance === 0
                        ? 'text-[color:var(--text-muted)]'
                        : 'font-medium text-[var(--color-stock-warning)]'
                    }`}
                  >
                    {/* aria-live: a screen-reader user learns the variance as they
                        type, rather than only after saving. */}
                    <span aria-live="polite">
                      {variance === null
                        ? '—'
                        : variance > 0
                          ? `+${variance}`
                          : String(variance)}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <input
                      // Named by the row it sits in, which is how a table cell
                      // carries an accessible name.
                      aria-label={`${t('counted')}: ${name}`}
                      aria-invalid={failed || undefined}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      dir="ltr"
                      value={raw}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9]/g, '');
                        if (cleaned !== e.target.value) e.target.value = cleaned;
                        setCount(row.batchId, cleaned);
                      }}
                      className={`w-24 rounded-lg border bg-transparent px-2 py-1.5 text-end text-sm tabular-nums outline-none focus-visible:ring-2 ${
                        failed ? 'border-[var(--color-stock-critical)]' : ''
                      }`}
                    />
                  </td>

                  <td className="px-3 py-3">
                    <select
                      aria-label={`${t('reason')}: ${name}`}
                      dir="ltr"
                      value={reasons[row.batchId] ?? ''}
                      onChange={(e) => {
                        setReasons((prev) => ({ ...prev, [row.batchId]: e.target.value }));
                        reset();
                      }}
                      className="rounded-lg border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
                    >
                      {reasonOptions.map((o) => (
                        <option key={o.value || 'none'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[color:var(--text-muted)]">
          {/* Announced on change: how many lines are in is the number a counter
              wants before pressing save. */}
          <span aria-live="polite">
            {enteredCount} / {rows.length}
          </span>{' '}
          {t('entered')}
        </p>

        <Button onClick={onSave} disabled={!canSave} pending={isPending}>
          {isPending ? t('saving') : t('saveSheet')}
        </Button>
      </div>

      {failures.length > 0 ? (
        <section
          aria-labelledby="refused-heading"
          className="rounded-xl border border-[var(--color-stock-critical)]/40 p-4"
        >
          <h2 id="refused-heading" className="text-sm font-semibold">
            {t('refusedLines')}
          </h2>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            {t('fixAndResubmit')}
          </p>

          <ul className="mt-3 space-y-2 text-sm">
            {failures.map((failure, i) => {
              const row = rows.find((r) => r.batchId === failure.batchId);
              return (
                <li key={`${failure.batchId}-${i}`} className="flex flex-col">
                  <span className="font-medium">
                    <span dir="ltr">{row?.lotNumber ?? failure.batchId}</span>
                  </span>
                  <span className="text-xs text-[var(--color-stock-critical)]">
                    {failure.message}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
