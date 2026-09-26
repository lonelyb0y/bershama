// Formatting helpers.
//
// The one invariant here: money is an integer count of minor units from the
// database all the way to the rendered string. Division happens exactly once, at
// display time, and the result is rounded for the user's benefit — never
// rounded back into a stored value.
//
// A stock ledger that has been through a float will eventually disagree with
// physical stock by one piastre, and "the system says we are 0.01 short" is not
// an acceptable answer in a pharmacy.

import type { CurrencyCode, Minor } from './types';

const CURRENCY_DECIMALS: Record<string, number> = {
  EGP: 2,
  SAR: 2,
  AED: 2,
  USD: 2,
};

const LOCALE_TAGS: Record<'en' | 'ar', string> = {
  en: 'en-EG',
  ar: 'ar-EG',
};

/**
 * Convert minor units to a major-unit number.
 *
 * Returns a Number, so only use this for display, chart axes, and calculations
 * that are then rounded back for display. Never store the result.
 */
export function toMajor(amount: Minor, currency: CurrencyCode = 'EGP'): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return amount / 10 ** decimals;
}

/** Convert a major-unit input (a form field) to minor units for storage. */
export function toMinor(amount: number, currency: CurrencyCode = 'EGP'): Minor {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return Math.round(amount * 10 ** decimals);
}

/**
 * Format minor units for display.
 *
 * Latin digits are forced in both locales. Arabic-Indic digits (٠١٢٣) are
 * correct in an essay and wrong on an expiry date a pharmacist has to read off
 * a carton and type into a search box, so the choice is made per-value rather
 * than per-locale.
 */
export function formatMoney(
  amount: Minor,
  options: { currency?: CurrencyCode; locale?: 'en' | 'ar' } = {},
): string {
  const { currency = 'EGP', locale = 'en' } = options;

  return new Intl.NumberFormat(`${LOCALE_TAGS[locale]}-u-nu-latn`, {
    style: 'currency',
    currency,
    minimumFractionDigits: CURRENCY_DECIMALS[currency] ?? 2,
    maximumFractionDigits: CURRENCY_DECIMALS[currency] ?? 2,
  }).format(toMajor(amount, currency));
}

/**
 * Format a quantity. Medicine counts are whole units — a pharmacy does not
 * dispense 0.5 of a box — so fractions are never shown even though the column
 * allows them, to accommodate broken packs counted at the warehouse.
 */
export function formatQuantity(
  qty: number,
  options: { locale?: 'en' | 'ar'; uom?: string } = {},
): string {
  const { locale = 'en', uom } = options;

  const formatted = new Intl.NumberFormat(`${LOCALE_TAGS[locale]}-u-nu-latn`, {
    maximumFractionDigits: Number.isInteger(qty) ? 0 : 2,
  }).format(qty);

  return uom ? `${formatted} ${uom}` : formatted;
}

// ── dates and expiry ────────────────────────────────────────────────────────

/**
 * A batch's expiry is stored as a DATE and represents the last day the product
 * is usable — not the first day it is not. Off-by-one errors here cause real
 * stock to be written off a day early, so the comparison is date-based rather
 * than timestamp-based and uses UTC midnight on both sides.
 */
export function expiryDateUtc(expiry: string): Date {
  const date = new Date(`${expiry}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid expiry date: ${expiry}`);
  }
  return date;
}

/** Whole days from today until the batch expires. Negative once expired. */
export function daysToExpiry(expiry: string, from: Date = new Date()): number {
  const today = new Date(
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()),
  );
  const target = expiryDateUtc(expiry);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Expiry severity, used for row highlighting and the alerting jobs.
 *
 * 30 days is the WHO GDP alert window for most products; 90 days is the
 * early-warning tier used for planning returns to supplier.
 */
export type ExpiryBand = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';

export function expiryBand(days: number): ExpiryBand {
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'CRITICAL';
  if (days <= 90) return 'WARNING';
  return 'OK';
}

export function formatDate(
  value: string,
  options: { locale?: 'en' | 'ar'; timeZone?: string; withTime?: boolean } = {},
): string {
  const { locale = 'en', timeZone = 'Africa/Cairo', withTime = false } = options;

  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);

  return new Intl.DateTimeFormat(`${LOCALE_TAGS[locale]}-u-nu-latn-ca-gregory`, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone,
  }).format(date);
}

/**
 * A signed, human-readable age for the audit log.
 * Timestamps are stored and rendered in the tenant's timezone, but the elapsed
 * time itself is timezone-independent, so this is safe to compute anywhere.
 */
export function timeAgo(iso: string, from: Date = new Date()): string {
  const seconds = Math.round((from.getTime() - new Date(iso).getTime()) / 1000);

  const thresholds: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];

  let value = -seconds;
  for (const [amount, unit] of thresholds) {
    if (Math.abs(value) < amount) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        Math.round(value),
        unit,
      );
    }
    value /= amount;
  }

  return '';
}
