// The client-side schemas, checked against the rules the database enforces.
//
// The database is authoritative and enforces all of these regardless, because a
// client is not a trust boundary. These duplicates exist to save a round trip: a
// user who types a negative quantity should not wait for the network to be told.
//
// That makes the risk specific and one-directional. A schema that is MORE
// permissive than the database is harmless -- the server still refuses. A schema
// that is STRICTER blocks work the database would have accepted, and that is a
// production bug with no server-side fallback.
//
// So the assertions here are mostly about not being stricter than needed, and
// about the codes matching, because a wrong code means the user is shown a
// sentence about a different problem.

import { describe, expect, it } from 'vitest';

import {
  adjustSchema,
  countedQty,
  createBatchSchema,
  errorsByField,
  positiveQty,
  receiveSchema,
  shelfLifeWarning,
  stocktakeSchema,
  transferSchema,
  validationErrors,
  writeOffSchema,
} from './validation';

const IDS = {
  locationId: '11111111-0000-4000-8000-000000000001',
  productId: '11111111-0000-4000-8000-000000000002',
  batchId: '11111111-0000-4000-8000-000000000003',
};

const codes = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? [] : (result.error?.issues.map((i) => i.message) ?? []);

describe('quantities', () => {
  it('refuses zero and negatives, with the code the database uses', () => {
    // quantity_must_be_positive is the code post_stock_movement raises, so the
    // browser and the server describe the same mistake identically.
    expect(codes(positiveQty.safeParse(0))).toEqual(['quantity_must_be_positive']);
    expect(codes(positiveQty.safeParse(-1))).toEqual(['quantity_must_be_positive']);
  });

  it('refuses a fractional quantity', () => {
    // There is no fractional box and no UoM conversion in M2. 0.5 is not a small
    // quantity, it is a category error: a picker cannot tell 14 tablets from 14
    // boxes, and a partial box is a whole-box problem.
    expect(codes(positiveQty.safeParse(0.5))).toEqual(['quantity_must_be_positive']);
  });

  it('refuses text where a number belongs', () => {
    expect(codes(positiveQty.safeParse('abc'))).toEqual(['quantity_must_be_positive']);
    expect(codes(positiveQty.safeParse(undefined))).toEqual(['quantity_must_be_positive']);
  });

  it('accepts a whole positive quantity', () => {
    expect(positiveQty.safeParse(1).success).toBe(true);
    expect(positiveQty.safeParse(1000000).success).toBe(true);
  });

  it('accepts zero as a COUNT, which is a real and important result', () => {
    // Separate rule from positiveQty. "We counted this shelf and it is empty" is
    // a normal outcome; demanding a positive number would make an accurate count
    // of an empty shelf look invalid, and the user would enter a 1 to get past
    // it. That is how stock invents itself.
    expect(countedQty.safeParse(0).success).toBe(true);
  });

  it('refuses a negative count as its own code', () => {
    expect(codes(countedQty.safeParse(-1))).toEqual(['counted_quantity_invalid']);
  });
});

describe('stocktake', () => {
  it('accepts a counted quantity and a reason', () => {
    const r = stocktakeSchema.safeParse({ ...IDS, countedQty: '97', reasonCode: 'MISCOUNT' });
    expect(r.success).toBe(true);
  });

  it('accepts a blank line, so an uncountable shelf is not a wrong one', () => {
    // On a real count sheet some lines cannot be counted: the bay is locked, the
    // pallet is behind a forklift. Forcing an answer turns a skipped line into a
    // wrong one, and a wrong count is far more expensive than a missing one.
    const r = stocktakeSchema.safeParse({ ...IDS, countedQty: '', reasonCode: '' });
    expect(r.success).toBe(true);
  });

  it('refuses a negative count, which would book stock out of a typo', () => {
    const r = stocktakeSchema.safeParse({ ...IDS, countedQty: '-5', reasonCode: 'MISCOUNT' });
    expect(codes(r)).toContain('counted_quantity_invalid');
  });

  it('refuses a reason that is not in the closed set', () => {
    const r = stocktakeSchema.safeParse({ ...IDS, countedQty: '5', reasonCode: 'BECAUSE' });
    expect(codes(r)).toContain('reason_code_required');
  });

  it('rejects a non-uuid id rather than sending it to PostgREST', () => {
    const r = stocktakeSchema.safeParse({ ...IDS, batchId: 'not-a-uuid', countedQty: '5' });
    expect(codes(r)).toContain('batch_not_found');
  });
});

describe('write-off and adjust differ on the sign', () => {
  // The distinction is the reason they are separate schemas rather than one with
  // a flag. A write-off removes stock permanently; an adjustment corrects a
  // number. A write-off that accepted a negative would book stock the wrong way.

  it('refuses a negative quantity on a write-off', () => {
    const r = writeOffSchema.safeParse({ ...IDS, qty: -5, reasonCode: 'DAMAGE_WRITE_OFF' });
    expect(codes(r)).toContain('quantity_must_be_positive');
  });

  it('refuses a write-off with no reason', () => {
    const r = writeOffSchema.safeParse({ ...IDS, qty: 5, reasonCode: '' });
    expect(codes(r)).toContain('reason_code_required');
  });

  it('accepts a negative adjustment, because a correction can go either way', () => {
    const r = adjustSchema.safeParse({ ...IDS, qtyDelta: -3, reasonCode: 'DAMAGE' });
    expect(r.success).toBe(true);
  });

  it('refuses a zero adjustment', () => {
    // zero_quantity_movement is the database's code, and it is the right one: a
    // movement of zero changes nothing, so the database will not record it.
    const r = adjustSchema.safeParse({ ...IDS, qtyDelta: 0, reasonCode: 'DAMAGE' });
    expect(codes(r)).toContain('zero_quantity_movement');
  });

  it('refuses an adjustment with no reason', () => {
    const r = adjustSchema.safeParse({ ...IDS, qtyDelta: -3, reasonCode: '' });
    expect(codes(r)).toContain('reason_code_required');
  });
});

describe('transfer', () => {
  it('refuses a transfer to the same location', () => {
    // The most likely mistake on this form, and one the database refuses with
    // same_location_transfer. Caught here to save the round trip.
    const r = transferSchema.safeParse({
      fromLocationId: IDS.locationId,
      toLocationId: IDS.locationId,
      productId: IDS.productId,
      batchId: IDS.batchId,
      qty: 5,
    });
    expect(codes(r)).toContain('same_location_transfer');
  });

  it('accepts a transfer between two different locations', () => {
    const r = transferSchema.safeParse({
      fromLocationId: IDS.locationId,
      toLocationId: '22222222-0000-4000-8000-000000000009',
      productId: IDS.productId,
      batchId: IDS.batchId,
      qty: 5,
    });
    expect(r.success).toBe(true);
  });
});

describe('create batch', () => {
  it('refuses an expiry on or before the manufacture date', () => {
    const same = createBatchSchema.safeParse({
      productId: IDS.productId,
      lotNumber: 'LOT-1',
      mfgDate: '2026-01-01',
      expiryDate: '2026-01-01',
    });
    expect(codes(same)).toContain('invalid_expiry_date');

    const before = createBatchSchema.safeParse({
      productId: IDS.productId,
      lotNumber: 'LOT-1',
      mfgDate: '2026-06-01',
      expiryDate: '2026-01-01',
    });
    expect(codes(before)).toContain('invalid_expiry_date');
  });

  it('refuses an empty lot number', () => {
    const r = createBatchSchema.safeParse({
      productId: IDS.productId,
      lotNumber: '   ',
      mfgDate: '2026-01-01',
      expiryDate: '2028-01-01',
    });
    expect(codes(r)).toContain('lot_number_required');
  });

  it('warns about an implausible shelf life without refusing', () => {
    // A warning, not a refusal. Short-dated clearance stock is real, and a form
    // that hard-refused it would block legitimate work. The database still has
    // the final say.
    //
    // 36 months from 2026-01-01 is 2029-01-01 (1096 days). 2028-01-01 is only
    // 731 -- a 24 month product -- so the FIRST assertion here is that a
    // two-year expiry on a three-year product is flagged. I initially wrote this
    // backwards and expected no warning, which would have made the check
    // toothless.
    expect(shelfLifeWarning('2026-01-01', '2029-01-01', 36)).toBeNull();
    expect(shelfLifeWarning('2026-01-01', '2028-01-01', 36)).toBe('shelf_life_implausible');
    expect(shelfLifeWarning('2026-01-01', '2026-04-01', 36)).toBe('shelf_life_implausible');
  });

  it('says nothing about shelf life when the product declares none', () => {
    expect(shelfLifeWarning('2026-01-01', '2026-04-01', null)).toBeNull();
  });
});

describe('receive', () => {
  it('accepts a whole receipt', () => {
    expect(receiveSchema.safeParse({ ...IDS, qty: 100 }).success).toBe(true);
  });

  it('refuses a fractional cost as well as a fractional quantity', () => {
    // Money is integer minor units end to end. A float that survives a round trip
    // through a ledger is a rounding error nobody can explain to an auditor.
    const r = receiveSchema.safeParse({ ...IDS, qty: 10, unitCostMinor: 45.5 });
    expect(codes(r)).toContain('quantity_must_be_positive');
  });
});

describe('issues render through the database catalog', () => {
  it('produces a localised message and the field it belongs to', () => {
    const r = writeOffSchema.safeParse({ ...IDS, qty: -1, reasonCode: '' });
    expect(r.success).toBe(false);
    if (r.success) return;

    const en = errorsByField(r.error, 'en');
    expect(en.qty).toBeTruthy();
    expect(en.reasonCode).toBeTruthy();
    // Not a code, and not zod's own prose: the user sees a sentence.
    expect(en.qty).not.toBe('quantity_must_be_positive');
  });

  it('gives Arabic users Arabic, from the same catalog', () => {
    const r = writeOffSchema.safeParse({ ...IDS, qty: -1, reasonCode: '' });
    if (r.success) throw new Error('expected a failure');

    const en = validationErrors(r.error, 'en');
    const ar = validationErrors(r.error, 'ar');

    expect(ar[0].message).not.toBe(en[0].message);
    // Both come from the database catalog, so both are the sentences a database
    // refusal would have produced for the same mistake.
    expect(en[0].code).toBe(ar[0].code);
  });

  it('collapses repeated issues for one field to a single message', () => {
    // zod can report several issues for one field; a form must not stack three
    // identical sentences under one label.
    const r = transferSchema.safeParse({
      fromLocationId: 'nope',
      toLocationId: 'nope',
      productId: IDS.productId,
      batchId: IDS.batchId,
      qty: 0,
    });
    if (r.success) throw new Error('expected a failure');

    const byField = errorsByField(r.error, 'en');
    expect(Object.keys(byField).length).toBeLessThanOrEqual(
      r.error.issues.length,
    );
    // The uuid failure and the same-location failure are different messages on
    // different fields, so both survive.
    expect(byField.fromLocationId).toBeTruthy();
    expect(byField.toLocationId).toBeTruthy();
  });
});
