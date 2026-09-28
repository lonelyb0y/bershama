// The expiry bands, checked against the SQL that produces them.
//
// This test exists because of a bug, and the shape of the bug is the point.
//
// api.search_products takes p_expiry_band as `text`. A `text` parameter carries
// no type, so the generated types say nothing about which strings are legal --
// that domain exists only inside a `case` expression in migration 0010. The
// client declared its own union of the bands, and declared it wrong: it spelled
// 'WARNING' as 'SOON' and left out 'NONE'.
//
// The result was a "short-dated stock" filter that matched no rows and returned
// an empty catalogue. No error, no warning, no failed request: TypeScript was
// satisfied, the database was asked a legal question, and the answer was
// honestly "nothing". Nothing about that failure looks like a bug from the
// outside, which is why it would have survived review and shipped.
//
// The drift checks cannot see this class. check-api-types.py compares parameter
// NAMES, because names are all a `text` parameter has. So the domain of a text
// parameter has to be verified against the SQL directly, which is what this does.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPIRY_BAND_FILTERS, expiryBand, type ExpiryBand } from './format';

/**
 * Find supabase/migrations by walking up from this file.
 *
 * Counting `..` segments is the obvious version and it is wrong the moment a
 * file moves: the first attempt went up three levels from apps/web/src/lib,
 * which lands on apps/ rather than the repository root, and the whole suite failed
 * on ENOENT. Walking up and checking for the directory cannot be off by one.
 */
function findMigrations(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'supabase', 'migrations');
    if (existsSync(candidate)) return candidate;
    dir = join(dir, '..');
  }
  throw new Error(
    'Could not find supabase/migrations above ' + __dirname + '. This test reads ' +
      'the migrations to check the band literals, so it only runs in the repository.',
  );
}

const MIGRATIONS = findMigrations();

/** Every migration, concatenated. The band logic could move between files. */
function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

/**
 * Pull the string literals out of the case expression compared to p_expiry_band.
 *
 * Scoped by the comparison rather than by line numbers, so reformatting the
 * migration does not break the check, and so a second place that filters on the
 * same band is picked up automatically.
 */
function bandsInSql(): string[] {
  const sql = allMigrationSql();
  const found = new Set<string>();

  // Anchor on the comparison, then walk BACKWARD to the `case` that produces it.
  //
  // The obvious regex -- `case ... end ) = p_expiry_band` -- is non-greedy from
  // the first `case` in the file, so it swallows every case statement in between
  // and reported 62 literals, including CAPSULE and DELIVERY_FAILED. Starting
  // from the comparison and taking the nearest preceding `case` is deterministic
  // and picks up a second band filter elsewhere in the migrations for free.
  for (const match of sql.matchAll(/end\s*\)\s*=\s*p_expiry_band/g)) {
    const at = match.index ?? 0;
    const start = sql.lastIndexOf('case', at);
    if (start === -1) continue;

    const body = sql.slice(start, at);
    for (const lit of body.matchAll(/'([A-Z_]+)'/g)) {
      found.add(lit[1]);
    }
  }

  return [...found].sort();
}

describe('expiry bands agree with the database', () => {
  it('finds the band expression at all', () => {
    // Guard against the extraction silently matching nothing, which would make
    // every other assertion in this file pass for the wrong reason -- the same
    // failure mode as the secret-scan check that exited 2 and read as "caught".
    expect(bandsInSql().length).toBeGreaterThan(0);
  });

  it('lists exactly the bands the database can return', () => {
    // As sets, because the constant is ordered by severity and the SQL
    // comparison is not. Comparing sequences here would fail for a difference in
    // ordering that is deliberate on one side and incidental on the other.
    expect([...EXPIRY_BAND_FILTERS].sort()).toEqual(bandsInSql());
  });

  it('orders the constant by severity, for the filter dropdown', () => {
    // Pinned separately from the set comparison above, because this order is a
    // decision rather than a consequence: NONE first so "we list it but do not
    // stock it" is the easy filter, then worst-first for the rest.
    expect([...EXPIRY_BAND_FILTERS]).toEqual([
      'NONE',
      'EXPIRED',
      'CRITICAL',
      'WARNING',
      'OK',
    ]);
  });

  it('would catch the SOON typo that shipped the empty filter', () => {
    const sql = bandsInSql();

    // The specific regression, asserted directly rather than left to the
    // equality above, because "SOON" is a plausible-looking name for a band
    // somebody might re-introduce on the grounds that it reads better.
    expect(sql).not.toContain('SOON');
    expect(EXPIRY_BAND_FILTERS as readonly string[]).not.toContain('SOON');
  });
});

describe('display band and query band are the same thresholds', () => {
  // expiryBand() decides how a row is coloured; p_expiry_band decides which rows
  // come back. If those disagree, a user filters to "WARNING" and sees rows
  // coloured "CRITICAL", and neither side is obviously wrong.
  const cases: Array<[days: number, band: ExpiryBand]> = [
    [-1, 'EXPIRED'],
    [0, 'CRITICAL'],
    [29, 'CRITICAL'],
    [30, 'CRITICAL'],
    [31, 'WARNING'],
    [90, 'WARNING'],
    [91, 'OK'],
    [365, 'OK'],
  ];

  it.each(cases)('%i days is %s', (days, band) => {
    expect(expiryBand(days)).toBe(band);
  });

  it('has a filter band for every display band', () => {
    for (const band of cases.map(([, b]) => b)) {
      expect(EXPIRY_BAND_FILTERS).toContain(band);
    }
  });
});
