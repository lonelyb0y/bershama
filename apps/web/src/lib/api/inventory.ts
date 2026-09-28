// Typed wrappers for the api.* schema.
//
// Everything the application does to stock goes through here, and the reason is
// not tidiness. Three things would otherwise be duplicated across a dozen server
// actions, and each duplication is a place for one of them to go wrong:
//
//   1. Argument naming. PostgREST takes `p_`-prefixed names. A server action
//      that writes `{ qty: 10 }` gets a PostgREST error about a missing
//      argument, at runtime, on a stock movement. Here the prefix is added once
//      and the caller writes `{ qty }`.
//
//   2. Localised errors. Each action would otherwise call localiseDbError itself,
//      and the one that forgets shows a raw code to an Arabic user. The wrappers
//      take a locale and return an already-localised failure.
//
//   3. PostgREST's null-is-not-an-error. A row RLS refuses is ABSENT, not
//      denied, so it comes back as data: null with no error. Treating that as
//      success is how a read silently becomes "nothing here".
//
// Amounts are `Minor` integers (piastres) end to end. Quantities are whole units
// -- there is no fractional stock and no UoM conversion in M2, deliberately: a
// partial box is a whole-box problem, not a floating point one.

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';
import type { Minor } from '@/lib/types';
import type { ExpiryBandFilter } from '@/lib/format';
import type { ApiResult } from '@/lib/api/result';
import { ok, toApiError } from '@/lib/api/result';

export type Batch = Database['public']['Tables']['batches']['Row'];
export type Product = Database['public']['Tables']['products']['Row'];
export type LedgerEntry = Database['public']['Tables']['stock_ledger']['Row'];

/**
 * The row shape api.get_batch_stock returns, taken from the generated types
 * rather than written out.
 *
 * Sourcing the batch status from here rather than from
 * `Database['public']['Enums']` matters: the enums live in the `private` schema,
 * which is deliberately not exposed, so the public Enums block is empty. Deriving
 * from the function's return type keeps the union in step with the database
 * automatically, and it is the shape the application actually receives.
 */
type BatchStockRow = Database['api']['Functions']['get_batch_stock']['Returns'][number];

export type BatchStatus = BatchStockRow['status'];
export type BatchStock = BatchStockRow;

type SearchRow = NonNullable<
  Database['api']['Functions']['search_products']['Returns']
>[number];

export type ProductSearchHit = SearchRow;

// ── the three call shapes ────────────────────────────────────────────────────
//
// Every api function returns one of: a scalar, a row, or a set of rows. Three
// helpers, so the null-is-not-an-error rule is written once instead of copied
// into a dozen functions. The first draft of this file copied it a dozen times,
// which is how two of the copies drifted and stopped type-checking.

/**
 * The bit of a Supabase client these wrappers need.
 *
 * `PromiseLike`, not `Promise`: supabase-js's `rpc()` returns a
 * `PostgrestFilterBuilder`, which is a thenable query builder rather than a
 * Promise. Typing this as `Promise` made the interface structurally
 * incompatible with the real client, so every caller had to cast.
 */
interface Client {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

type Raw = { data: unknown; error: { message: string; code?: string; details?: string | null } | null };

/** A function returning a scalar, where 0 is a legitimate value. */
async function callScalar(
  supabase: Client,
  locale: Locale,
  fn: string,
  args: Record<string, unknown>,
  missingMessage: string,
): Promise<ApiResult<number>> {
  const { data, error } = (await supabase.rpc(fn, args)) as Raw;

  if (error) return toApiError(error, locale);

  if (data === null || data === undefined) {
    return {
      ok: false,
      error: { message: missingMessage, code: 'null_result', isFallback: false },
    };
  }

  return ok(Number(data));
}

/** A function returning exactly one row. null means it did not happen. */
async function callRow<T>(
  supabase: Client,
  locale: Locale,
  fn: string,
  args: Record<string, unknown>,
  missingMessage: string,
): Promise<ApiResult<T>> {
  const { data, error } = (await supabase.rpc(fn, args)) as {
    data: T | null;
    error: Raw['error'];
  };

  if (error) return toApiError(error, locale);

  if (data === null || data === undefined) {
    return {
      ok: false,
      error: { message: missingMessage, code: 'null_result', isFallback: false },
    };
  }

  return ok(data);
}

/** A function returning a set of rows. An empty set is a success, not a failure. */
async function callRows<T>(
  supabase: Client,
  locale: Locale,
  fn: string,
  args: Record<string, unknown>,
  missingMessage: string,
): Promise<ApiResult<T[]>> {
  const { data, error } = (await supabase.rpc(fn, args)) as {
    data: T[] | null;
    error: Raw['error'];
  };

  if (error) return toApiError(error, locale);

  if (data === null || data === undefined) {
    return {
      ok: false,
      error: { message: missingMessage, code: 'null_result', isFallback: false },
    };
  }

  return ok(data);
}

const NOT_SAVED = (what: string) => `The ${what} did not complete. Nothing was saved.`;
const NOT_CHANGED = (what: string) => `The ${what} did not complete. Nothing was changed.`;

// ── receiving ────────────────────────────────────────────────────────────────

export function receiveStock(
  supabase: Client,
  locale: Locale,
  input: {
    locationId: string;
    productId: string;
    batchId: string;
    qty: number;
    unitCostMinor?: Minor;
    supplierRef?: string;
    notes?: string;
  },
): Promise<ApiResult<number>> {
  return callScalar(supabase, locale, 'receive_stock', {
    p_location_id: input.locationId,
    p_product_id: input.productId,
    p_batch_id: input.batchId,
    p_qty: input.qty,
    p_unit_cost_minor: input.unitCostMinor ?? null,
    p_supplier_ref: input.supplierRef ?? null,
    p_notes: input.notes ?? null,
  }, NOT_SAVED('receipt'));
}

// ── issuing ──────────────────────────────────────────────────────────────────

export function issueStock(
  supabase: Client,
  locale: Locale,
  input: {
    locationId: string;
    productId: string;
    batchId: string;
    qty: number;
    referenceType?: string;
    referenceId?: string;
    notes?: string;
  },
): Promise<ApiResult<number>> {
  return callScalar(supabase, locale, 'issue_stock', {
    p_location_id: input.locationId,
    p_product_id: input.productId,
    p_batch_id: input.batchId,
    p_qty: input.qty,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_notes: input.notes ?? null,
  }, NOT_SAVED('issue'));
}

// ── corrections ──────────────────────────────────────────────────────────────

export function adjustStock(
  supabase: Client,
  locale: Locale,
  input: {
    locationId: string;
    productId: string;
    batchId: string;
    qtyDelta: number;
    reasonCode: string;
    notes?: string;
  },
): Promise<ApiResult<number>> {
  return callScalar(supabase, locale, 'adjust_stock', {
    p_location_id: input.locationId,
    p_product_id: input.productId,
    p_batch_id: input.batchId,
    p_qty_delta: input.qtyDelta,
    p_reason_code: input.reasonCode,
    p_notes: input.notes ?? null,
  }, NOT_SAVED('adjustment'));
}

export function writeOffStock(
  supabase: Client,
  locale: Locale,
  input: {
    locationId: string;
    productId: string;
    batchId: string;
    qty: number;
    reasonCode: string;
    notes?: string;
  },
): Promise<ApiResult<number>> {
  return callScalar(
    supabase,
    locale,
    'write_off_stock',
    {
      p_location_id: input.locationId,
      p_product_id: input.productId,
      p_batch_id: input.batchId,
      // The database takes the magnitude and applies the sign, so a caller
      // cannot write off negative stock by passing a negative qty. Abs here as
      // well: -0 and 0 are the same number, and abs(-0) is 0, but being explicit
      // costs nothing and reads as deliberate.
      p_qty: Math.abs(input.qty),
      p_reason_code: input.reasonCode,
      p_notes: input.notes ?? null,
    },
    NOT_SAVED('write-off'),
  );
}

export type StocktakeOutcome =
  /** A variance was posted; this is the new ledger row's id. */
  | { kind: 'adjusted'; ledgerId: number }
  /** The count matched the books. A success, and the common case on a count sheet. */
  | { kind: 'matched' };

/**
 * Record a physical count.
 *
 * Takes the counted quantity rather than a variance, because the person at the
 * shelf knows how many cartons are in front of them and should not have to
 * subtract anything. The database computes the difference and books it as
 * COUNT_GAIN or COUNT_LOSS.
 *
 * A count that matches returns NULL from the database, which is a success, and
 * is reported as `matched` rather than as a failure or a fabricated ledger id.
 * Most lines on a real count sheet are accurate, so this is the common path.
 */
export async function stockTake(
  supabase: Client,
  locale: Locale,
  input: {
    locationId: string;
    productId: string;
    batchId: string;
    countedQty: number;
    reasonCode: string;
    notes?: string;
  },
): Promise<ApiResult<StocktakeOutcome>> {
  const { data, error } = (await supabase.rpc('stock_take', {
    p_location_id: input.locationId,
    p_product_id: input.productId,
    p_batch_id: input.batchId,
    p_counted_qty: input.countedQty,
    p_reason_code: input.reasonCode,
    p_notes: input.notes ?? null,
  })) as { data: number | null; error: Raw['error'] };

  if (error) return toApiError(error, locale);

  if (data === null || data === undefined) {
    return ok({ kind: 'matched' });
  }

  return ok({ kind: 'adjusted', ledgerId: Number(data) });
}

// ── transfers ────────────────────────────────────────────────────────────────

export function transferStock(
  supabase: Client,
  locale: Locale,
  input: {
    fromLocationId: string;
    toLocationId: string;
    productId: string;
    batchId: string;
    qty: number;
    reasonCode?: string;
    notes?: string;
  },
): Promise<ApiResult<number>> {
  return callScalar(supabase, locale, 'transfer_stock', {
    p_from_location: input.fromLocationId,
    p_to_location: input.toLocationId,
    p_product_id: input.productId,
    p_batch_id: input.batchId,
    p_qty: input.qty,
    p_reason_code: input.reasonCode ?? null,
    p_notes: input.notes ?? null,
  }, NOT_SAVED('transfer'));
}

// ── batches ──────────────────────────────────────────────────────────────────

export function createBatch(
  supabase: Client,
  locale: Locale,
  input: {
    productId: string;
    lotNumber: string;
    mfgDate: string;
    expiryDate: string;
    unitCostMinor?: Minor;
    supplierName?: string;
    supplierRef?: string;
    releaseNow?: boolean;
  },
): Promise<ApiResult<Batch>> {
  return callRow(
    supabase,
    locale,
    'create_batch',
    {
      p_product_id: input.productId,
      p_lot_number: input.lotNumber,
      p_mfg_date: input.mfgDate,
      p_expiry_date: input.expiryDate,
      p_unit_cost_minor: input.unitCostMinor ?? null,
      p_supplier_name: input.supplierName ?? null,
      p_supplier_ref: input.supplierRef ?? null,
      p_release_now: input.releaseNow ?? false,
    },
    NOT_SAVED('batch'),
  );
}

export function releaseBatch(
  supabase: Client,
  locale: Locale,
  input: { batchId: string; reason?: string },
): Promise<ApiResult<Batch>> {
  return callRow(
    supabase,
    locale,
    'release_batch',
    { p_batch_id: input.batchId, p_reason: input.reason ?? null },
    NOT_CHANGED('release'),
  );
}

export function quarantineBatch(
  supabase: Client,
  locale: Locale,
  input: { batchId: string; reason: string },
): Promise<ApiResult<Batch>> {
  return callRow(
    supabase,
    locale,
    'quarantine_batch',
    { p_batch_id: input.batchId, p_reason: input.reason },
    NOT_CHANGED('quarantine'),
  );
}

export function recallBatch(
  supabase: Client,
  locale: Locale,
  input: { batchId: string; reason: string },
): Promise<ApiResult<Batch>> {
  return callRow(
    supabase,
    locale,
    'recall_batch',
    { p_batch_id: input.batchId, p_reason: input.reason },
    // A recall either moves the stock or it does not, in one transaction. So a
    // null here means nothing was moved, and saying so plainly is the whole
    // message -- there is no partial outcome to explain.
    NOT_CHANGED('recall'),
  );
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * Stock for one batch, per location.
 *
 * `get_batch_stock` is an INVOKER read, so RLS applies and the caller's tenant is
 * the only tenant visible. That is why there is no tenant argument and why
 * passing one would be a mistake.
 */
export function getBatchStock(
  supabase: Client,
  locale: Locale,
  batchId: string,
): Promise<ApiResult<BatchStock[]>> {
  return callRows(
    supabase,
    locale,
    'get_batch_stock',
    { p_batch_id: batchId },
    'That batch could not be read. It may have been removed.',
  );
}

/**
 * Bilingual catalogue search.
 *
 * `totalCount` is repeated on every row by the database precisely so a pager can
 * render "showing 1-50 of 312" from a single round trip. It is read from the
 * first row; with no rows at all there is no row to read it from, so an empty
 * result is 0, not undefined.
 */
export async function searchProducts(
  supabase: Client,
  locale: Locale,
  input: {
    query?: string;
    expiryBand?: ExpiryBandFilter;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ApiResult<{ hits: ProductSearchHit[]; totalCount: number }>> {
  const rows = await callRows<ProductSearchHit>(
    supabase,
    locale,
    'search_products',
    {
      p_query: input.query ?? null,
      p_expiry_band: input.expiryBand ?? null,
      p_limit: input.limit ?? 50,
      p_offset: input.offset ?? 0,
    },
    'The catalogue could not be searched.',
  );

  if (!rows.ok) return rows;

  return {
    ok: true,
    data: {
      hits: rows.data,
      totalCount: rows.data[0]?.total_count ?? 0,
    },
  };
}
