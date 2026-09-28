// Client-side validation, sharing the database's error codes.
//
// Every issue raised here carries a `code` drawn from the SAME catalog the
// database raises through -- `reason_code_required`, `invalid_expiry_date` and
// the rest. So a validation failure in the browser and a refusal from Postgres
// render through one component, in one language, with one set of sentences. Two
// catalogs would mean the same mistake described two different ways depending on
// whether the client or the server happened to catch it.
//
// The point of validating here at all is not to avoid the database. The database
// is authoritative and these rules exist there regardless, because a client is
// not a trust boundary and a hand-written curl must be refused too. Validating
// here is about the round trip: a user who types a negative quantity should not
// wait for a network request to be told so.
//
// A schema that is more permissive than the database is a documentation bug. One
// that is stricter is a bug that blocks legitimate work, and it is the worse of
// the two, so each rule below states the condition it mirrors.
//
// Only reachable rules are duplicated. `insufficient_stock`, `batch_expired` and
// `insufficient_role` are NOT here: they need a balance, a clock or a session,
// none of which the client has authoritatively. Guessing at them in the browser
// would produce an error that is sometimes wrong in front of the user.

import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { messageForCode, REASON_CODES, type ReasonCode } from './errors';

export type ValidationError = {
  code: string;
  message: string;
  field: string;
};

/**
 * Turn zod issues into the same shape localiseDbError produces.
 *
 * The code comes from the schema -- zod is used here only as a rule engine, and
 * its own messages are discarded because they are English prose in a file that
 * must not contain any. The message is then rendered from the database catalog by
 * `messageForCode`, so a field error and a form-level error are the same object
 * and the UI has exactly one renderer.
 */
export function validationErrors(issues: z.ZodError, locale: Locale): ValidationError[] {
  return issues.issues.map((issue) => {
    const code = issue.message;
    return {
      code,
      message: messageForCode(code, locale).message,
      field: issue.path.join('.') || '_form',
    };
  });
}

/**
 * The first issue per field, which is what a form shows next to an input.
 *
 * Collapsed by field because zod can report several issues for one field -- an
 * empty string fails both `.min(1)` and `.uuid()` -- and rendering all of them
 * stacks three identical sentences under one label.
 */
export function errorsByField(
  issues: z.ZodError,
  locale: Locale,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { field, message } of validationErrors(issues, locale)) {
    if (!(field in out)) out[field] = message;
  }
  return out;
}

/** The codes a stocktake or adjustment can fail with, for the dropdown. */
export const REASON_CODE_VALUES = Object.keys(REASON_CODES) as ReasonCode[];

/* ── shared field schemas ────────────────────────────────────────────────── */

/**
 * A whole number of stock units, greater than zero.
 *
 * Quantity is an integer by design: there is no fractional box and no UoM
 * conversion in M2, so `0.5` is not a small quantity, it is a category error.
 * A picker cannot tell the difference between a lot offered in 14 tablets and one
 * offered in 14 boxes, and a partial box is a whole-box problem.
 */
export const positiveQty = z
  // Zod 4's single `error` param replaces the old `invalid_type_error`, so one
  // call covers "not a number at all" as well as every check below it.
  .number({ error: 'quantity_must_be_positive' })
  .int('quantity_must_be_positive')
  .positive('quantity_must_be_positive');

/**
 * A count, which may legitimately be zero.
 *
 * Separate from positiveQty because "we counted this shelf and it is empty" is a
 * normal and important result, and demanding a positive number would make an
 * accurate count of an empty shelf look invalid. Only a NEGATIVE count is
 * refused, and that is refused as its own code: a negative count is a
 * mis-transcription, and booking it would create stock out of a typo.
 */
export const countedQty = z
  .number({ error: 'counted_quantity_invalid' })
  .int('counted_quantity_invalid')
  .min(0, 'counted_quantity_invalid');

/**
 * A counted quantity, or a blank meaning "I did not count this line".
 *
 * On a real count sheet some lines cannot be counted -- the bay is locked, the
 * pallet is behind a forklift. Forcing an answer turns a skipped line into a
 * wrong one, and a wrong count is far more expensive than a missing one.
 */
export const optionalCountedQty = z
  .string()
  // A refine rather than a union of literal('') and a regex. The union version
  // reported zod's own "Invalid input" when both branches failed, so a negative
  // count produced a message about nothing in particular instead of
  // counted_quantity_invalid -- and the whole point of these codes is that they
  // render through the database catalog.
  .refine((v) => v === '' || /^\d+$/.test(v), 'counted_quantity_invalid')
  .transform((v) => (v === '' ? undefined : Number(v)));

const requiredText = (code: string) =>
  z
    .string()
    .trim()
    .min(1, code)
    .max(2000, code);

/** A reason code from the closed set the database stores. */
export const reasonCode = z
  .string()
  .refine((v) => (REASON_CODE_VALUES as string[]).includes(v), 'reason_code_required');

/* ── per-screen schemas ──────────────────────────────────────────────────── */

export const stocktakeSchema = z.object({
  locationId: z.string().uuid('location_not_found'),
  productId: z.string().uuid('batch_not_found'),
  batchId: z.string().uuid('batch_not_found'),
  /** Empty means the line was not counted and is skipped, not submitted as 0. */
  countedQty: optionalCountedQty,
  reasonCode: z
    .string()
    // Only required when a number was actually entered, so skipping a line does
    // not also demand a reason for the skip.
    .refine((v) => v === '' || v.length > 0, 'reason_code_required')
    .refine(
      (v) => v === '' || (REASON_CODE_VALUES as string[]).includes(v),
      'reason_code_required',
    ),
  notes: z.string().max(500, 'reason_code_required').optional(),
});

export type StocktakeInput = z.infer<typeof stocktakeSchema>;

export const receiveSchema = z.object({
  locationId: z.string().uuid('location_not_found'),
  productId: z.string().uuid('batch_not_found'),
  batchId: z.string().uuid('batch_not_found'),
  qty: positiveQty,
  unitCostMinor: z
    .number()
    .int('quantity_must_be_positive')
    .min(0, 'quantity_must_be_positive')
    .optional(),
  supplierRef: requiredText('lot_number_required').max(64, 'lot_number_required').optional(),
  notes: z.string().max(500).optional(),
});

export type ReceiveInput = z.infer<typeof receiveSchema>;

export const writeOffSchema = z.object({
  locationId: z.string().uuid('location_not_found'),
  productId: z.string().uuid('batch_not_found'),
  batchId: z.string().uuid('batch_not_found'),
  qty: positiveQty,
  reasonCode,
  notes: z.string().max(500).optional(),
});

export type WriteOffInput = z.infer<typeof writeOffSchema>;

export const adjustSchema = z.object({
  locationId: z.string().uuid('location_not_found'),
  productId: z.string().uuid('batch_not_found'),
  batchId: z.string().uuid('batch_not_found'),
  // Signed: a correction can go either way, unlike a write-off.
  qtyDelta: z
    .number({ error: 'quantity_must_be_positive' })
    .int('quantity_must_be_positive')
    .refine((v) => v !== 0, 'zero_quantity_movement'),
  reasonCode,
  notes: z.string().max(500).optional(),
});

export type AdjustInput = z.infer<typeof adjustSchema>;

export const transferSchema = z
  .object({
    fromLocationId: z.string().uuid('location_not_found'),
    toLocationId: z.string().uuid('location_not_found'),
    productId: z.string().uuid('batch_not_found'),
    batchId: z.string().uuid('batch_not_found'),
    qty: positiveQty,
    reasonCode: z.string().optional(),
    notes: z.string().max(500).optional(),
  })
  // The database raises same_location_transfer, and checking it here saves a
  // pointless round trip for the single most likely mistake on this form.
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: 'same_location_transfer',
    path: ['toLocationId'],
  });

export type TransferInput = z.infer<typeof transferSchema>;

export const createBatchSchema = z
  .object({
    productId: z.string().uuid('batch_not_found'),
    lotNumber: requiredText('lot_number_required'),
    mfgDate: z.string().min(1, 'invalid_expiry_date'),
    expiryDate: z.string().min(1, 'invalid_expiry_date'),
    unitCostMinor: z.number().int().min(0).optional(),
    supplierName: z.string().max(120).optional(),
    supplierRef: z.string().max(64).optional(),
    releaseNow: z.boolean().optional(),
  })
  .refine((v) => v.expiryDate > v.mfgDate, {
    message: 'invalid_expiry_date',
    path: ['expiryDate'],
  });

export type CreateBatchInput = z.infer<typeof createBatchSchema>;

/**
 * A warning, not a refusal, for an implausible shelf life.
 *
 * The database refuses this only when the product declares a shelf life, and
 * refuses with a range in the message. A form that hard-refused a date the user
 * genuinely has -- a short-dated clearance lot is a real thing -- would block
 * legitimate work, so this returns a message to show and the form still submits.
 * The database has the final say either way.
 */
export function shelfLifeWarning(
  mfgDate: string,
  expiryDate: string,
  shelfLifeMonths: number | null,
): string | null {
  if (!shelfLifeMonths || !mfgDate || !expiryDate) return null;

  const mfg = new Date(`${mfgDate}T00:00:00Z`);
  const exp = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(mfg.getTime()) || Number.isNaN(exp.getTime())) return null;

  const days = Math.round((exp.getTime() - mfg.getTime()) / 86_400_000);
  const expected = shelfLifeMonths * 30.44;

  // 25% either side, matching the tenant's min_shelf_life_pct default of 75.
  if (days < expected * 0.75 || days > expected * 1.25) {
    return 'shelf_life_implausible';
  }

  return null;
}
