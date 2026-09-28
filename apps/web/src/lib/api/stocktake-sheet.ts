// The stocktake count sheet, as a pure function.
//
// The counting UI is a long list of lines, and the interesting behaviour is what
// happens when a user submits 200 of them and 3 are wrong. This module is that
// logic with no Next.js, no Supabase and no React in it, so it can be tested
// directly -- which matters because the alternative is testing it through a
// server action, where every failure looks like "500 Internal Server Error" and
// the interesting assertions are impossible to write.
//
// ── why a submission is partial and not atomic ──────────────────────────────
//
// A count sheet is one physical activity over many lines. If line 140 is refused
// because someone typed a negative quantity, discarding the other 199 correct
// counts would be indefensible: the counter walked the whole warehouse, the
// other 199 numbers are right, and the fix is to correct one cell and submit
// again.
//
// So the lines are independent. Each one is its own database transaction, and a
// refusal rolls back only its own line. Nothing is atomic here on purpose.
//
// That is only acceptable if the outcome is reported honestly, which is what most
// of this module is: a count of 200 with 3 failures must say 197 saved, 3
// refused, and say WHY for each -- not "saved successfully" and not a bare
// failure that leaves the user re-walking the warehouse to find out which lines
// went missing.

import { stocktakeSchema, validationErrors, type StocktakeInput } from '@/lib/validation';
import type { Locale } from '@/i18n/routing';
import type { ApiResult } from '@/lib/api/result';
import type { StocktakeOutcome } from '@/lib/api/inventory';

/** One line of a count sheet, as typed by the counter. */
export interface SheetLine {
  productId: string;
  batchId: string;
  /**
   * The counted quantity, as the string in the input.
   *
   * A string, because an empty string is a real state here: a blank line means
   * "not counted", and it is different from a count of zero, which means "counted,
   * and the shelf is empty". Collapsing the two would either force a count where
   * the counter could not reach, or turn a genuinely empty shelf into a skip.
   */
  countedQty: string;
  reasonCode: string;
}

export interface SheetFailure {
  batchId: string;
  productId: string;
  /** Already localised. The same sentence a database refusal would produce. */
  message: string;
  code: string;
}

export interface SheetResult {
  /** Lines whose count differed from the books and were booked as a variance. */
  adjusted: number;
  /** Lines whose count agreed with the books. A success, and usually most of them. */
  matched: number;
  /** Lines left blank, or not entered at all. Never submitted, never an error. */
  skipped: number;
  /** Lines refused, individually. Empty on a clean run. */
  failures: SheetFailure[];
}

/**
 * What the poster is handed.
 *
 * StocktakeInput alone is not enough: the schema's countedQty is `number |
 * undefined`, because a blank line transforms to undefined. The sheet skips
 * blank lines before validating, so a line that reaches the poster always has a
 * count -- but the type said otherwise, which meant the compiler could not stop a
 * line with no count from being posted to the database. This type makes the
 * narrowing part of the contract.
 */
export interface PosterInput extends Omit<StocktakeInput, 'countedQty'> {
  countedQty: number;
}

/** The minimum the poster has to do, so a test can supply its own. */
export type Poster = (input: PosterInput) => Promise<ApiResult<StocktakeOutcome>>;

export interface SubmitOptions {
  locale: Locale;
  poster: Poster;
  /**
   * Hard cap on lines submitted in one go.
   *
   * Each line is a separate round trip, so a sheet with thousands of lines would
   * hold the request open for a very long time and could time out halfway --
   * leaving the user with no way to tell which lines landed. A cap makes the
   * limit explicit; the real fix is a database-side function that posts a whole
   * sheet in one transaction, which is worth doing before this is used at a
   * warehouse large enough to hit the cap.
   */
  maxLines?: number;
}

export const DEFAULT_MAX_SHEET_LINES = 500;

/**
 * Post a count sheet.
 *
 * Lines are processed in order and never in parallel: a user watching a list
 * tick over is better served by a predictable sequence than by 200 concurrent
 * requests against one warehouse's balances, which would also make the ledger
 * ordering depend on network timing.
 */
export async function submitStocktake(
  locationId: string,
  lines: readonly SheetLine[],
  options: SubmitOptions,
): Promise<SheetResult> {
  const { locale, poster } = options;
  const maxLines = options.maxLines ?? DEFAULT_MAX_SHEET_LINES;

  const result: SheetResult = { adjusted: 0, matched: 0, skipped: 0, failures: [] };

  let submitted = 0;

  for (const line of lines) {
    const blank = line.countedQty.trim() === '';

    if (blank) {
      result.skipped += 1;
      continue;
    }

    if (submitted >= maxLines) {
      // Refuse rather than silently drop, and say which. A silently truncated
      // count is the one outcome a warehouse cannot detect, because the visible
      // part of the sheet looks complete.
      result.skipped += 1;
      result.failures.push({
        batchId: line.batchId,
        productId: line.productId,
        code: 'sheet_too_long',
        message:
          locale === 'ar'
            ? `ورقة الجرد أطول من الحد المسموح (${maxLines} سطراً). احفظ ما تم، ثم تابع الباقي.`
            : `The count sheet is longer than the ${maxLines}-line limit. Save what is done, then continue with the rest.`,
      });
      continue;
    }

    const parsed = stocktakeSchema.safeParse({
      locationId,
      productId: line.productId,
      batchId: line.batchId,
      countedQty: line.countedQty.trim(),
      reasonCode: line.reasonCode,
    });

    if (!parsed.success) {
      // A client-side refusal. Reported per line, with the same catalogue the
      // database uses, and counted as a failure rather than a skip: the counter
      // DID enter something, and it is wrong, so it must be corrected rather than
      // quietly passed over.
      const issues = validationErrors(parsed.error, locale);
      for (const issue of issues) {
        result.failures.push({
          batchId: line.batchId,
          productId: line.productId,
          code: issue.code,
          message: issue.message,
        });
      }
      continue;
    }

    const counted = parsed.data.countedQty;

    if (counted === undefined) {
      // Unreachable: blank lines are skipped above, so the schema's
      // ''-transforms-to-undefined branch cannot fire. Guarded rather than
      // asserted, because a future change to the skip order would otherwise post
      // `undefined` as the counted quantity and the database would coerce it to
      // null. A skip is at worst a wrong display; a null count is a wrong ledger.
      result.skipped += 1;
      continue;
    }

    const posted = await poster({ ...parsed.data, countedQty: counted });
    submitted += 1;

    if (!posted.ok) {
      result.failures.push({
        batchId: line.batchId,
        productId: line.productId,
        code: posted.error.code,
        message: posted.error.message,
      });
      continue;
    }

    if (posted.data.kind === 'matched') {
      result.matched += 1;
    } else {
      result.adjusted += 1;
    }
  }

  return result;
}

/**
 * Whether the sheet can be left as it is.
 *
 * True when every line is either skipped or booked as a match, i.e. there is
 * nothing left for the counter to do. A run with any failure is not clean, and
 * saying so is what stops a counter from walking away believing the whole sheet
 * was recorded when three lines were refused.
 */
export function isSheetClean(result: SheetResult): boolean {
  return result.failures.length === 0;
}

/**
 * A one-line summary of a submission, for the confirmation.
 *
 * Skipped lines are named whenever there are any. A sheet of 200 where 5 had
 * counts and 195 were left blank is not "5 saved" -- the user needs to know 195
 * lines were not counted, or they will believe they counted the warehouse when
 * they counted one shelf. Silence about what was NOT done is the specific way a
 * stocktake tool loses the trust of the person using it.
 */
export function summariseSheet(result: SheetResult, locale: Locale): string {
  const { adjusted, matched, skipped, failures } = result;
  const saved = adjusted + matched;

  // Built as whole sentences per locale rather than assembled from shared
  // fragments. The first version interpolated a hardcoded Arabic "و" between the
  // two counts, which meant the English string read
  //
  //     Saved 1 variance و0 matching lines.
  //
  // -- a mixture that no reviewer reads, because nobody reads the English output
  // of an Arabic string. Concatenation across a language boundary is the defect;
  // the fix is to let each language own its sentence.
  if (locale === 'ar') {
    const skippedPart =
      skipped > 0 ? `، وتُرك ${skipped} سطراً دون عد` : '';
    const savedPart = saved > 0 ? `تم حفظ ${saved} سطراً` : 'لم يُحفظ شيء';

    if (failures.length > 0) {
      return `${savedPart}، ورُفض ${failures.length}${skippedPart}.`;
    }
    if (saved === 0) {
      return `لم يتم إدخال أي عدد${skippedPart}.`;
    }
    return `${savedPart}: ${adjusted} فرق و${matched} سطراً مطابق${skippedPart}.`;
  }

  const skippedPart =
    skipped > 0 ? `, ${skipped} line${skipped === 1 ? '' : 's'} left uncounted` : '';

  if (failures.length > 0) {
    const savedPart =
      saved > 0
        ? `Saved ${saved} line${saved === 1 ? '' : 's'}`
        : 'Nothing was saved';
    return `${savedPart}, ${failures.length} refused${skippedPart}.`;
  }

  if (saved === 0) {
    return `No counts were entered${skippedPart}.`;
  }

  return (
    `Saved ${adjusted} variance${adjusted === 1 ? '' : 's'} and ` +
    `${matched} matching line${matched === 1 ? '' : 's'}${skippedPart}.`
  );
}
