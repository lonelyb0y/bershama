import { describe, expect, it } from 'vitest';

import {
  createBatch,
  getBatchStock,
  issueStock,
  quarantineBatch,
  releaseBatch,
  receiveStock,
  recallBatch,
  searchProducts,
  stockTake,
  transferStock,
  writeOffStock,
  adjustStock,
} from './inventory';

/**
 * A stub client that records what it was called with.
 *
 * These tests need no database on purpose. What they verify is the wrapper's own
 * logic -- the `p_` prefixes, the `Math.abs` on a write-off, the null-means-
 * matched rule for a stocktake, and that an unmapped code never reaches the
 * caller. None of that needs Postgres, and a suite that needs a database is a
 * suite that only runs in CI.
 *
 * What they deliberately do NOT verify is that the database accepts these
 * arguments. That is what the pgTAP suites are for. This is the half of the
 * contract that lives in TypeScript, so it is tested in TypeScript.
 */
function stub(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  // `schemas` records every .schema() call, which is the point of this stub
  // having grown a recorder at all.
  const schemas: string[] = [];

  const client = {
    schema(name: string) {
      schemas.push(name);
      return client;
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };

  return { client, calls, schemas };
}

const IDS = {
  locationId: 'loc-1',
  productId: 'prod-1',
  batchId: 'batch-1',
};

describe('schema addressing', () => {
  // Every function in this module lives in the `api` schema. A bare `rpc()` call
  // routes to `public`, where none of them exist, and PostgREST answers PGRST202
  // -- "function public.stock_take not found", which reads like a missing
  // migration rather than a missing .schema() call. That shipped once: the whole
  // inventory client called rpc() bare, and nothing caught it, because every test
  // used a stub that answered whatever it was asked.
  it('addresses every function in the api schema', async () => {
    const { client, schemas } = stub({ data: 1 });

    await receiveStock(client, 'en', { ...IDS, qty: 1 });
    await issueStock(client, 'en', { ...IDS, qty: 1 });
    await adjustStock(client, 'en', { ...IDS, qtyDelta: 1, reasonCode: 'DAMAGE' });
    await writeOffStock(client, 'en', { ...IDS, qty: 1, reasonCode: 'DAMAGE_WRITE_OFF' });
    await stockTake(client, 'en', { ...IDS, countedQty: 1, reasonCode: 'MISCOUNT' });
    await transferStock(client, 'en', {
      fromLocationId: 'a',
      toLocationId: 'b',
      productId: 'p',
      batchId: 'x',
      qty: 1,
    });
    await createBatch(client, 'en', {
      productId: 'p',
      lotNumber: 'L',
      mfgDate: '2026-01-01',
      expiryDate: '2028-01-01',
    });
    await releaseBatch(client, 'en', { batchId: 'x' });
    await quarantineBatch(client, 'en', { batchId: 'x', reason: 'r' });
    await recallBatch(client, 'en', { batchId: 'x', reason: 'r' });
    await getBatchStock(client, 'en', 'x');
    await searchProducts(client, 'en', {});

    // One per call. A count of zero here is the bug this test exists for.
    expect(schemas).toHaveLength(12);
    expect(new Set(schemas)).toEqual(new Set(['api']));
  });
});

describe('argument mapping', () => {
  it('prefixes every argument with p_, as PostgREST requires', async () => {
    const { client, calls } = stub({ data: 42 });
    await receiveStock(client, 'en', { ...IDS, qty: 10 });

    // A server action that forgets the prefix gets a PostgREST error about a
    // missing argument -- at runtime, on a stock movement.
    expect(calls[0].fn).toBe('receive_stock');
    expect(calls[0].args).toMatchObject({
      p_location_id: 'loc-1',
      p_product_id: 'prod-1',
      p_batch_id: 'batch-1',
      p_qty: 10,
    });
  });

  it('sends optional arguments as null rather than omitting them', async () => {
    const { client, calls } = stub({ data: 1 });
    await receiveStock(client, 'en', { ...IDS, qty: 1 });

    // PostgREST treats a missing key and an explicit null the same way, but
    // sending them keeps the payload shape uniform, which is what makes the
    // ledger's column defaults predictable.
    expect(calls[0].args).toHaveProperty('p_notes', null);
    expect(calls[0].args).toHaveProperty('p_unit_cost_minor', null);
  });

  it('takes the write-off magnitude, so a negative qty cannot invert it', async () => {
    const { client, calls } = stub({ data: 1 });
    await writeOffStock(client, 'en', { ...IDS, qty: -5, reasonCode: 'DAMAGE_WRITE_OFF' });

    // write_off_stock applies the sign itself and negates. Passing the raw
    // negative through would post a WRITE_OFF with a positive delta, which the
    // sign constraint would reject -- and, for a different reason, would be a
    // bug worth making impossible rather than documenting.
    expect(calls[0].args.p_qty).toBe(5);
  });

  it('maps a transfer to from/to, not to a direction flag', async () => {
    const { client, calls } = stub({ data: 1 });
    await transferStock(client, 'en', {
      fromLocationId: 'a',
      toLocationId: 'b',
      productId: 'prod-1',
      batchId: 'batch-1',
      qty: 5,
    });

    // p_from_location / p_to_location is the real signature. Inventing a
    // "direction" argument here would type-check against my own wrapper and fail
    // against the database -- exactly the drift check-api-types.py exists for.
    expect(calls[0].fn).toBe('transfer_stock');
    expect(calls[0].args).toMatchObject({ p_from_location: 'a', p_to_location: 'b' });
  });

  it('sends the counted quantity, not a computed variance', async () => {
    const { client, calls } = stub({ data: 7 });
    await stockTake(client, 'en', { ...IDS, countedQty: 97, reasonCode: 'MISCOUNT' });

    // The client must not do the subtraction. The database reads the balance
    // inside the same transaction as the insert, so a variance computed here
    // would be computed against a balance that may already have moved.
    expect(calls[0].args.p_counted_qty).toBe(97);
    expect(calls[0].args).not.toHaveProperty('p_qty_delta');
  });
});

describe('stocktake outcomes', () => {
  it('reports a posted variance with its ledger id', async () => {
    const { client } = stub({ data: 512 });
    const result = await stockTake(client, 'en', {
      ...IDS,
      countedQty: 97,
      reasonCode: 'MISCOUNT',
    });

    expect(result).toEqual({ ok: true, data: { kind: 'adjusted', ledgerId: 512 } });
  });

  it('reports a matching count as a success, not a failure', async () => {
    // The database returns NULL when the count agrees with the books. Most
    // lines on a real count sheet are accurate, so this is the common path, and
    // turning it into an error message would train counters to ignore the
    // result.
    const { client } = stub({ data: null });
    const result = await stockTake(client, 'en', {
      ...IDS,
      countedQty: 100,
      reasonCode: 'MISCOUNT',
    });

    expect(result).toEqual({ ok: true, data: { kind: 'matched' } });
  });
});

describe('PostgREST null is not an error', () => {
  it('treats a null scalar as a failure with a plain message', async () => {
    // A ledger id that is null means the movement did not happen. Nothing
    // throws, so a caller checking only `error` would report success.
    const { client } = stub({ data: null });
    const result = await issueStock(client, 'en', { ...IDS, qty: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('null_result');
      expect(result.error.message).toContain('issue');
    }
  });

  it('treats a null row as a failure, not as an empty result', async () => {
    const { client } = stub({ data: null });
    const result = await createBatch(client, 'en', {
      productId: 'prod-1',
      lotNumber: 'LOT-1',
      mfgDate: '2026-01-01',
      expiryDate: '2028-01-01',
    });

    // RLS refusing a row makes it ABSENT, not denied. "Nothing was saved" is the
    // only honest thing to tell someone who just filled in a batch form.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Nothing was saved');
  });

  it('accepts an empty row set as a success', async () => {
    // Zero rows is a real answer: this batch is in no locations. It is not a
    // failure and must not be reported as one.
    const { client } = stub({ data: [] });
    const result = await getBatchStock(client, 'en', 'batch-1');

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('accepts a zero total from search as a success', async () => {
    const { client } = stub({ data: [] });
    const result = await searchProducts(client, 'en', { query: 'zzz' });

    expect(result).toEqual({ ok: true, data: { hits: [], totalCount: 0 } });
  });
});

describe('search results', () => {
  it('reads the total from the first row, so a pager needs one round trip', async () => {
    const { client } = stub({
      data: [
        { id: 'p1', name_en: 'Panadol', total_count: 312 },
        { id: 'p2', name_en: 'Amoxil', total_count: 312 },
      ],
    });
    const result = await searchProducts(client, 'en', { query: 'pa' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalCount).toBe(312);
      expect(result.data.hits).toHaveLength(2);
    }
  });

  it('passes a default page size and offset', async () => {
    const { client, calls } = stub({ data: [] });
    await searchProducts(client, 'en');

    expect(calls[0].args).toMatchObject({ p_limit: 50, p_offset: 0 });
  });
});

describe('error localisation reaches the caller', () => {
  const dbError = {
    message: 'insufficient_stock',
    code: 'insufficient_stock',
    details: JSON.stringify({ available: 12, requested: 40 }),
    hint: null,
  };

  it('localises a known code into both locales', async () => {
    const en = await issueStock(stub({ error: dbError }).client, 'en', {
      ...IDS,
      qty: 40,
    });
    const ar = await issueStock(stub({ error: dbError }).client, 'ar', {
      ...IDS,
      qty: 40,
    });

    expect(en.ok).toBe(false);
    expect(ar.ok).toBe(false);
    if (!en.ok && !ar.ok) {
      expect(en.error.message).toContain('12');
      expect(ar.error.message).toContain('12');
      expect(en.error.message).not.toBe(ar.error.message);
    }
  });

  it('never surfaces a raw error code to the user', async () => {
    const result = await issueStock(
      stub({ error: { message: 'brand_new_code', code: 'brand_new_code' } }).client,
      'en',
      { ...IDS, qty: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.isFallback).toBe(true);
      expect(result.error.message).not.toContain('brand_new_code');
    }
  });
});

describe('reason codes are required, not merely recommended', () => {
  // The wrapper does not validate this -- the database does, and the pgTAP suite
  // proves it. What matters here is that the reason is actually transmitted, so
  // a caller cannot get a variance recorded with an unexplained difference.
  it('sends the reason code through to the database', async () => {
    const { client, calls } = stub({ data: 1 });

    await adjustStock(client, 'en', { ...IDS, qtyDelta: -3, reasonCode: 'DAMAGE' });
    await writeOffStock(client, 'en', { ...IDS, qty: 3, reasonCode: 'EXPIRED_WRITE_OFF' });
    await stockTake(client, 'en', { ...IDS, countedQty: 10, reasonCode: 'MISCOUNT' });
    await quarantineBatch(client, 'en', { batchId: 'batch-1', reason: 'damaged carton' });
    await recallBatch(client, 'en', { batchId: 'batch-1', reason: 'MHRA recall 2026-114' });

    const reasons = calls.map((c) => c.args.p_reason_code ?? c.args.p_reason);
    expect(reasons).toEqual([
      'DAMAGE',
      'EXPIRED_WRITE_OFF',
      'MISCOUNT',
      'damaged carton',
      'MHRA recall 2026-114',
    ]);
  });
});
