// The count-sheet submission, which is pure logic over a poster function.
//
// No database and no Next.js. That is deliberate: the behaviour worth testing
// here is what happens when 200 lines go in and 3 are wrong, and testing that
// through a server action would give every failure the same face -- 500 Internal
// Server Error -- with no way to assert which line failed or why.
//
// The database's own behaviour for a single line is already covered by
// supabase/tests/stocktake.test.sql. This is the part above it.

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_SHEET_LINES,
  isSheetClean,
  submitStocktake,
  summariseSheet,
  type SheetLine,
} from './stocktake-sheet';
import type { PosterInput } from './stocktake-sheet';
import type { ApiResult } from './result';
import type { StocktakeOutcome } from './inventory';

const LOCATION = '11111111-0000-4000-8000-000000000001';

let seq = 0;
const ids = () => {
  seq += 1;
  const n = String(seq).padStart(12, '0');
  return {
    productId: `22222222-0000-4000-8000-${n}`,
    batchId: `33333333-0000-4000-8000-${n}`,
  };
};

function line(over: Partial<SheetLine> = {}): SheetLine {
  return { ...ids(), countedQty: '10', reasonCode: 'MISCOUNT', ...over };
}

const posted = (ledgerId: number): ApiResult<StocktakeOutcome> => ({
  ok: true,
  data: { kind: 'adjusted', ledgerId },
});

const matched: ApiResult<StocktakeOutcome> = {
  ok: true,
  data: { kind: 'matched' },
};

const refused = (code: string, message = 'nope'): ApiResult<StocktakeOutcome> => ({
  ok: false,
  error: { code, message, isFallback: false },
});

describe('a clean sheet', () => {
  it('separates variances from matches and skips nothing silently', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const lines = [line({ countedQty: '9' }), line({ countedQty: '11' })];

    const result = await submitStocktake(LOCATION, lines, { locale: 'en', poster });

    expect(result).toEqual({ adjusted: 2, matched: 0, skipped: 0, failures: [] });
    expect(isSheetClean(result)).toBe(true);
  });

  it('counts a matching line as matched, not as an adjustment', async () => {
    // The database returns NULL for a count that agrees with the books, and that
    // is the common case on a real count sheet. Reporting it as a variance would
    // put a "variance" on screen for a shelf that was perfectly correct.
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => matched);
    const result = await submitStocktake(LOCATION, [line()], { locale: 'en', poster });

    expect(result).toEqual({ adjusted: 0, matched: 1, skipped: 0, failures: [] });
  });

  it('passes the location once, for the whole sheet', async () => {
    // The location is one argument for the whole sheet rather than a field on
    // each line, so a client bug cannot scatter one sheet's counts across several
    // locations while the screen still shows a single location's heading.
    const seen: PosterInput[] = [];
    const poster = vi.fn(async (input: PosterInput) => {
      seen.push(input);
      return posted(1);
    });

    await submitStocktake(LOCATION, [line(), line()], { locale: 'en', poster });

    expect(seen).toHaveLength(2);
    expect(seen.every((i) => i.locationId === LOCATION)).toBe(true);
  });

  it('posts lines in order, not in parallel', async () => {
    // A user watching a list tick over is better served by a predictable
    // sequence than by 200 concurrent requests against one warehouse's balances,
    // which would also make the ledger ordering depend on network timing.
    const order: string[] = [];
    const poster = vi.fn(async (input: PosterInput) => {
      order.push(input.batchId);
      return posted(1);
    });

    const lines = [line(), line(), line()];
    await submitStocktake(LOCATION, lines, { locale: 'en', poster });

    expect(order).toEqual(lines.map((l) => l.batchId));
  });
});

describe('skipped lines', () => {
  it('treats a blank line as uncounted rather than as a count of zero', async () => {
    // These are different facts. Blank means the bay was locked or the pallet was
    // behind a forklift; zero means counted, and the shelf is empty. Collapsing
    // them either forces a count the counter could not make, or turns a genuinely
    // empty shelf into a skip -- and an empty shelf is exactly the discrepancy a
    // stocktake exists to find.
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => matched);
    const result = await submitStocktake(
      LOCATION,
      [line({ countedQty: '' }), line({ countedQty: '0' })],
      { locale: 'en', poster },
    );

    expect(result).toEqual({ adjusted: 0, matched: 1, skipped: 1, failures: [] });
    expect(poster).toHaveBeenCalledTimes(1);
  });

  it('treats whitespace as blank', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => matched);
    const result = await submitStocktake(LOCATION, [line({ countedQty: '   ' })], {
      locale: 'en',
      poster,
    });

    expect(result.skipped).toBe(1);
    expect(poster).not.toHaveBeenCalled();
  });

  it('does not require a reason for a line that was never counted', async () => {
    // Demanding a reason for a skip would mean inventing one for every line the
    // counter could not reach, which is a small lie told 180 times on a long sheet.
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => matched);
    const result = await submitStocktake(
      LOCATION,
      [line({ countedQty: '', reasonCode: '' })],
      { locale: 'en', poster },
    );

    expect(result.failures).toEqual([]);
  });
});

describe('a partly-refused sheet', () => {
  it('books the good lines and reports the bad ones individually', async () => {
    // The core case. A counter walked the warehouse and typed 200 numbers. Line
    // 140 is refused. Discarding the other 199 would be indefensible: they walked
    // the whole place, the other 199 are right, and the fix is one cell.
    const good = line({ countedQty: '10' });
    // A count that passes validation and is refused by the DATABASE. A negative
    // quantity would be caught by the schema and never reach the poster, which is
    // the right behaviour but a different thing to be testing here.
    const bad = line({ countedQty: '999' });

    const poster = vi.fn(async (input): Promise<ApiResult<StocktakeOutcome>> =>
      input.batchId === bad.batchId
        ? refused('insufficient_stock', 'Only 12 in stock here; you asked for 999.')
        : posted(7),
    );

    const result = await submitStocktake(LOCATION, [good, bad], { locale: 'en', poster });

    expect(result.adjusted).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].batchId).toBe(bad.batchId);
    expect(result.failures[0].code).toBe('insufficient_stock');
    // The good line still went through.
    expect(poster).toHaveBeenCalledTimes(2);
  });

  it('keeps posting after a refusal', async () => {
    // A loop that returned on the first error would silently drop every line
    // after it, and the user would have no way to know which ones those were.
    const poster = vi.fn(async (input): Promise<ApiResult<StocktakeOutcome>> =>
      input.countedQty === 0 ? refused('insufficient_stock') : posted(1),
    );

    const lines = [
      line({ countedQty: '5' }),
      line({ countedQty: '5' }),
      line({ countedQty: '5' }),
    ];
    const result = await submitStocktake(LOCATION, lines, { locale: 'en', poster });

    expect(result.adjusted).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it('reports a client-side rejection with the database catalog message', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const result = await submitStocktake(
      LOCATION,
      [line({ countedQty: 'abc' })],
      { locale: 'en', poster },
    );

    expect(result.failures).toHaveLength(1);
    // Not a code, and not zod's prose: the user sees the same sentence a database
    // refusal would have produced.
    expect(result.failures[0].code).toBe('counted_quantity_invalid');
    expect(result.failures[0].message).not.toBe('counted_quantity_invalid');
    expect(poster).not.toHaveBeenCalled();
  });

  it('counts a client-side rejection as a failure, not as a skip', async () => {
    // The counter DID enter something and it is wrong, so it must be corrected.
    // Filing it as a skip would make the sheet look clean while holding a typo.
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const result = await submitStocktake(
      LOCATION,
      [line({ countedQty: 'abc' })],
      { locale: 'en', poster },
    );

    expect(result.failures).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(isSheetClean(result)).toBe(false);
  });

  it('localises a client-side rejection', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const lines = [line({ countedQty: 'abc' })];

    const en = await submitStocktake(LOCATION, lines, { locale: 'en', poster });
    const ar = await submitStocktake(LOCATION, lines, { locale: 'ar', poster });

    expect(en.failures[0].code).toBe(ar.failures[0].code);
    expect(en.failures[0].message).not.toBe(ar.failures[0].message);
  });

  it('names the batch on every failure, so the row can be found', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> =>
      refused('insufficient_stock', 'Only 12 in stock here; you asked for 40.'),
    );
    const lines = [line(), line(), line()];

    const result = await submitStocktake(LOCATION, lines, { locale: 'en', poster });

    expect(result.failures.map((f) => f.batchId)).toEqual(lines.map((l) => l.batchId));
  });
});

describe('the line cap', () => {
  it('refuses rather than silently truncating', async () => {
    // A silently truncated count sheet is the one outcome a warehouse cannot
    // detect: the visible part of the sheet looks complete, and the missing
    // lines leave no trace anywhere.
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const lines = Array.from({ length: 5 }, () => line());

    const result = await submitStocktake(LOCATION, lines, {
      locale: 'en',
      poster,
      maxLines: 2,
    });

    expect(result.adjusted).toBe(2);
    expect(result.skipped).toBe(3);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0].code).toBe('sheet_too_long');
    expect(poster).toHaveBeenCalledTimes(2);
  });

  it('says which limit it hit, in the active locale', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const lines = Array.from({ length: 2 }, () => line());

    const en = await submitStocktake(LOCATION, lines, { locale: 'en', poster, maxLines: 1 });
    const ar = await submitStocktake(LOCATION, lines, { locale: 'ar', poster, maxLines: 1 });

    expect(en.failures[0].message).toContain('1');
    expect(ar.failures[0].message).toContain('1');
    expect(en.failures[0].message).not.toBe(ar.failures[0].message);
  });

  it('has a default, and it is a real number', () => {
    expect(DEFAULT_MAX_SHEET_LINES).toBeGreaterThan(0);
  });
});

describe('the summary line', () => {
  it('never hides a failure', () => {
    const summary = summariseSheet(
      { adjusted: 5, matched: 10, skipped: 2, failures: [{ batchId: 'b', productId: 'p', code: 'x', message: 'm' }] },
      'en',
    );

    expect(summary).toContain('1 refused');
    expect(isSheetClean({ adjusted: 5, matched: 10, skipped: 2, failures: [] })).toBe(true);
  });

  it('names the uncounted lines, because they were not done', () => {
    // 5 saved out of 200 is not "5 saved". A user who is not told 195 lines were
    // left blank will believe they counted the warehouse when they counted a shelf.
    const summary = summariseSheet(
      { adjusted: 5, matched: 0, skipped: 195, failures: [] },
      'en',
    );

    expect(summary).toContain('195');
    expect(summary).toContain('uncounted');
  });

  it('says so when nothing was entered at all', () => {
    expect(
      summariseSheet({ adjusted: 0, matched: 0, skipped: 10, failures: [] }, 'en'),
    ).toContain('No counts');
  });

  it('is grammatical about a single line', () => {
    const one = summariseSheet({ adjusted: 1, matched: 0, skipped: 0, failures: [] }, 'en');
    const many = summariseSheet({ adjusted: 3, matched: 0, skipped: 0, failures: [] }, 'en');

    expect(one).toContain('1 variance and');
    expect(one).not.toContain('variances');
    expect(many).toContain('3 variances');
  });

  it('translates', () => {
    const result = { adjusted: 3, matched: 4, skipped: 2, failures: [] };
    expect(summariseSheet(result, 'ar')).not.toBe(summariseSheet(result, 'en'));
  });
});

describe('an empty sheet', () => {
  it('does nothing and says so', async () => {
    const poster = vi.fn(async (): Promise<ApiResult<StocktakeOutcome>> => posted(1));
    const result = await submitStocktake(LOCATION, [], { locale: 'en', poster });

    expect(result).toEqual({ adjusted: 0, matched: 0, skipped: 0, failures: [] });
    expect(poster).not.toHaveBeenCalled();
  });
});
