import { describe, expect, it } from 'vitest';

import {
  ADJUSTMENT_REASONS,
  REASON_CODES,
  WRITE_OFF_REASONS,
  localiseDbError,
  knownCodes,
} from './errors';

/**
 * A raised error as it actually arrives from supabase-js.
 *
 * `detail` is the field that matters and the one most likely to be mis-handled:
 * PostgREST delivers it as a string containing JSON, nested inside the JSON error
 * body, so it reaches the client as a JSON-encoded string rather than an object.
 * Every test builds it that way, because building it as an object would test a
 * shape the production path does not produce.
 */
function dbError(
  code: string,
  detail: Record<string, string | number> = {},
  message?: string,
) {
  return {
    code,
    message: message ?? code,
    details: JSON.stringify(detail),
    hint: null,
  };
}

describe('localiseDbError', () => {
  it('returns null for no error', () => {
    expect(localiseDbError(null, 'en')).toBeNull();
    expect(localiseDbError(undefined, 'en')).toBeNull();
  });

  it('interpolates the numbers the user needs to act', () => {
    // The whole point of the detail field. "Not enough stock" alone leaves the
    // user guessing; "only 12 here, you asked for 40" tells them what to do.
    const result = localiseDbError(
      dbError('insufficient_stock', { available: 12, requested: 40 }),
      'en',
    );

    expect(result?.message).toContain('12');
    expect(result?.message).toContain('40');
    expect(result?.isFallback).toBe(false);
  });

  it('gives the same meaning in both locales', () => {
    const detail = { available: 12, requested: 40 };
    const en = localiseDbError(dbError('insufficient_stock', detail), 'en');
    const ar = localiseDbError(dbError('insufficient_stock', detail), 'ar');

    expect(en?.code).toBe(ar?.code);
    expect(en?.message).not.toBe(ar?.message);

    // Both must carry the numbers, or the Arabic UI sends someone to the wrong
    // shelf. This is the failure the whole error-code convention exists to prevent.
    for (const label of ['12', '40']) {
      expect(en?.message).toContain(label);
      expect(ar?.message).toContain(label);
    }
  });

  it('keeps Latin digits in the Arabic message', () => {
    // A pharmacist transcribes quantities from a delivery note. Arabic-Indic digits
    // on a quantity they are about to type are a transcription risk for no gain.
    const ar = localiseDbError(
      dbError('insufficient_stock', { available: 12, requested: 40 }),
      'ar',
    );

    expect(ar?.message).not.toMatch(/[٠-٩]/);
  });

  it('never leaks a raw code to the user', () => {
    // An unmapped code means the mapper has fallen behind the migrations. Showing
    // "insufficient_stok" to a user looks like a bug in the product and tells
    // them nothing; the generic message is strictly better, and the code is
    // returned separately for logging.
    const result = localiseDbError(dbError('some_new_code_we_forgot'), 'en');

    expect(result?.isFallback).toBe(true);
    expect(result?.code).toBe('some_new_code_we_forgot');
    expect(result?.message).not.toContain('some_new_code_we_forgot');
  });

  it('tolerates a missing or empty detail', () => {
    for (const details of [null, undefined, '', 'not json at all']) {
      const result = localiseDbError(
        { code: 'duplicate_lot_number', message: 'x', details, hint: null },
        'en',
      );
      // Renders the message with no interpolation rather than throwing. A
      // translation lookup that crashes on an unparseable detail turns a
      // validation error into a blank screen.
      expect(result?.message).toBeTruthy();
      expect(result?.isFallback).toBe(false);
    }
  });

  it('accepts a detail that is already an object', () => {
    // Not the current PostgREST shape, but a future version might change it and
    // this should not be a silent break.
    const result = localiseDbError(
      {
        code: 'insufficient_stock',
        message: 'x',
        details: { available: 5, requested: 9 } as unknown as string,
        hint: null,
      },
      'en',
    );

    expect(result?.message).toContain('5');
  });

  it('handles an error with no code at all', () => {
    const result = localiseDbError({ message: 'something odd' }, 'en');

    expect(result?.isFallback).toBe(true);
    expect(result?.code).toBe('unknown');
  });
});

describe('the mapper and the migrations agree', () => {
  it('maps every code the database can raise', () => {
    // This is the assertion that keeps the two halves together. A code added to a
    // migration without a message here shows an Arabic user a generic fallback,
    // and nothing else in the build would notice.
    const raised = [
      'insufficient_stock',
      'location_not_found',
      'batch_not_found',
      'batch_product_mismatch',
      'batch_not_released',
      'batch_expired',
      'quantity_must_be_positive',
      'zero_quantity_movement',
      'same_location_transfer',
      'duplicate_lot_number',
      'invalid_expiry_date',
      'shelf_life_implausible',
      'lot_number_required',
      'illegal_batch_transition',
      'cannot_release_expired_batch',
      'recall_reason_required',
      'quarantine_reason_required',
      'no_quarantine_location',
      'reason_code_required',
      'insufficient_role',
      'not_authenticated',
      'audit_context_missing',
    ];

    const missing = raised.filter((code) => !knownCodes.includes(code));
    expect(missing).toEqual([]);

    // And the reverse: a mapped code the database no longer raises is dead weight
    // that will eventually be wrong.
    const stale = knownCodes.filter((code) => !raised.includes(code));
    expect(stale).toEqual([]);
  });

  it('produces a non-empty message in both locales for every code', () => {
    for (const code of knownCodes) {
      for (const locale of ['en', 'ar'] as const) {
        const result = localiseDbError(dbError(code), locale);
        expect(result, `${code}/${locale}`).not.toBeNull();
        expect(result?.isFallback, `${code} should be mapped`).toBe(false);
        expect(result?.message.trim().length, `${code}/${locale}`).toBeGreaterThan(
          0,
        );
        expect(result?.message, `${code}/${locale}`).not.toBe(code);
      }
    }
  });
});

describe('reason codes', () => {
  it('offers only codes that exist in the label table', () => {
    for (const code of [...ADJUSTMENT_REASONS, ...WRITE_OFF_REASONS]) {
      expect(REASON_CODES[code]).toBeDefined();
    }
  });

  it('is translated in both locales', () => {
    for (const code of Object.keys(REASON_CODES) as Array<
      keyof typeof REASON_CODES
    >) {
      expect(REASON_CODES[code].en.length).toBeGreaterThan(0);
      expect(REASON_CODES[code].ar.length).toBeGreaterThan(0);
      expect(REASON_CODES[code].en).not.toBe(REASON_CODES[code].ar);
    }
  });

  it('separates adjustment reasons from write-off reasons', () => {
    // An adjustment corrects a number; a write-off removes stock permanently. A
    // shared list would let a reversible correction be filed as a write-off,
    // which is a different accounting event with a different audit meaning.
    for (const code of ADJUSTMENT_REASONS) {
      expect(WRITE_OFF_REASONS).not.toContain(code);
    }
  });

  it('is upper snake case, because they are stored values', () => {
    for (const code of [...ADJUSTMENT_REASONS, ...WRITE_OFF_REASONS]) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
