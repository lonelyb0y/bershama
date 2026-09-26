import { describe, expect, it } from 'vitest';

import {
  daysToExpiry,
  expiryBand,
  expiryDateUtc,
  formatMoney,
  formatQuantity,
  toMajor,
  toMinor,
  timeAgo,
} from './format';

describe('money', () => {
  it('converts minor units without losing precision', () => {
    // 12_345_678_901 piastres is the value that loses its last digit as a
    // float. If this round-trips, the ledger is safe.
    expect(toMinor(toMajor(12_345_678_901, 'EGP'), 'EGP')).toBe(12_345_678_901);
  });

  it('round-trips every piastre value through major units', () => {
    // A float accumulates error. Sweeping the realistic range catches the class
    // of bug that a single sample value would miss.
    for (let piastres = 0; piastres < 100_000; piastres += 1) {
      expect(toMinor(toMajor(piastres, 'EGP'), 'EGP')).toBe(piastres);
    }
  });

  it('rounds to the nearest piastre on input', () => {
    // A price entered as 19.995 EGP has no exact representation; it must land
    // on a definite piastre value rather than drifting.
    expect(toMinor(19.995, 'EGP')).toBe(2000);
    expect(toMinor(19.994, 'EGP')).toBe(1999);
  });

  it('treats 100 piastres as 1 EGP', () => {
    expect(toMajor(100, 'EGP')).toBe(1);
    expect(toMajor(150, 'EGP')).toBe(1.5);
  });

  it('formats with the currency symbol and Latin digits in both locales', () => {
    // Arabic-Indic digits on an expiry date or a price is a transcription risk
    // for warehouse staff, so Latin digits are forced in both.
    expect(formatMoney(150_000, { locale: 'en' })).toContain('1,500.00');
    expect(formatMoney(150_000, { locale: 'ar' })).toContain('1,500.00');
  });
});

describe('quantities', () => {
  it('omits decimals for whole counts', () => {
    expect(formatQuantity(12, { uom: 'box' })).toBe('12 box');
  });

  it('keeps decimals for broken packs', () => {
    // A warehouse can count a partial pack; a pharmacy cannot dispense one.
    expect(formatQuantity(12.5, { uom: 'box' })).toBe('12.5 box');
  });
});

describe('expiry', () => {
  it('parses a bare date as UTC midnight', () => {
    // Without an explicit UTC anchor this parses as local midnight, which shifts
    // the day for anyone west of Greenwich and breaks the day count.
    expect(expiryDateUtc('2026-03-15').toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it('counts days inclusively of the expiry date itself', () => {
    // A batch expiring 2026-03-15 is usable ON 2026-03-15. Reading it as
    // expiring at the start of that day writes off usable stock a day early.
    const reference = new Date(Date.UTC(2026, 2, 1));
    expect(daysToExpiry('2026-03-15', reference)).toBe(14);
    expect(daysToExpiry('2026-03-01', reference)).toBe(0);
  });

  it('reports a negative count once expired', () => {
    const reference = new Date(Date.UTC(2026, 2, 1));
    expect(daysToExpiry('2026-02-28', reference)).toBe(-1);
  });

  it('handles a leap day without drifting', () => {
    const reference = new Date(Date.UTC(2028, 1, 28));
    expect(daysToExpiry('2028-02-29', reference)).toBe(1);
  });

  it('crosses a month boundary correctly', () => {
    const reference = new Date(Date.UTC(2026, 0, 30));
    expect(daysToExpiry('2026-02-02', reference)).toBe(3);
  });

  it('rejects an unparseable date loudly', () => {
    // Silently treating a bad date as "expires in 0 days" would write off a
    // perfectly good batch.
    expect(() => expiryDateUtc('not-a-date')).toThrow();
  });
});

describe('expiryBand', () => {
  it.each([
    [-1, 'EXPIRED'],
    [0, 'CRITICAL'],
    [30, 'CRITICAL'],
    [31, 'WARNING'],
    [90, 'WARNING'],
    [91, 'OK'],
    [365, 'OK'],
  ])('maps %i days to %s', (days, expected) => {
    expect(expiryBand(days)).toBe(expected);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-03-15T12:00:00Z');

  it('describes recent activity in minutes', () => {
    expect(timeAgo('2026-03-15T11:30:00Z', now)).toContain('30');
  });

  it('describes older activity in days', () => {
    expect(timeAgo('2026-03-12T12:00:00Z', now)).toContain('3');
  });

  it('never throws on a past or future timestamp', () => {
    expect(() => timeAgo('2027-01-01T00:00:00Z', now)).not.toThrow();
  });
});
