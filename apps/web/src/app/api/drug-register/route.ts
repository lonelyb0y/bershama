import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';

/**
 * Look a medicine up in the Egyptian drug register without writing anything.
 *
 * ── why this is a search and not an import ────────────────────────────────────────
 *
 * The bulk importer puts ~16,000 rows into `products`. That makes every product list in
 * the application read a table it did not need to read, commits one tenant's catalogue
 * decision into everyone's schema, and turns "add the Egyptian drug register" into a
 * sixteen-thousand-row insert that is slow to run and slow to undo.
 *
 * The register is ~25,000 products and one pharmacy orders a few hundred. So the register
 * stays outside the database entirely: `scripts/build-drug-register.py` flattens it to a
 * static JSON file at build time, this route filters that in memory, and the only rows
 * that reach the database are the ones somebody actually picks -- one at a time, through
 * the same `api.create_product` the form already calls.
 *
 * Nothing here writes. That is deliberate and is what makes the feature safe to offer
 * without thinking about it: the worst a search can do is return a wrong suggestion.
 *
 * ── the file is read once per instance ─────────────────────────────────────────────
 *
 * 3.9 MB of JSON parsed on every keystroke would be absurd, and a debounce on the client
 * would still pay it several times per search. Module scope is the right place for the
 * cache: it survives across requests within a warm instance, which is exactly the
 * lifetime a parsed register wants. Cold starts pay the parse once.
 *
 * ── requiring a session ────────────────────────────────────────────────────────────
 *
 * Not because the data is secret -- it is CC0 and public. Because parsing 3.9 MB is real
 * CPU work, and an unauthenticated endpoint that anyone on the internet can hammer is a
 * way to spend the project's function quota for nothing. A signed-in staff member is the
 * only caller this has.
 */

/** Columns, in the positional order `build-drug-register.py` writes them. */
interface RegisterShape {
  columns: string[];
  provenance: string;
  entries: unknown[][];
}

// Module-scope, so it is parsed once per instance rather than once per request.
let cached: { columns: string[]; provenance: string; rows: Record<string, unknown>[] } | null =
  null;

const FILE = path.join(process.cwd(), 'data', 'drug-register.json');

/** Results returned. Enough to scan, few enough that the response stays small. */
const LIMIT = 20;

/**
 * Search normalisation.
 *
 * Latin text is lowercased. Arabic is *not* case-folded -- it has no case -- but it does
 * need the orthographic variants collapsed, because Egyptians write the same drug name
 * with and without hamza, and with the two forms of ya, and a search that cannot find
 * "البروفين" because the register spells it "البروفين" with a hamza is a search that looks
 * broken. The *stored* name is never modified; only the compared form is.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا') // أ إ آ -> ا
    .replace(/[ىي]/g, 'ي') // ى -> ي
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/[ً-ْـ]/g, '') // harakat and tatweel carry no search meaning
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How well a row matches, higher is better. Returned rather than filtered so the caller
 * can rank, because "Panadol" and "Panadol Extra" are both wanted and which one is first
 * is a question of how exactly the query matched.
 */
function score(haystack: string, needle: string): number {
  if (!haystack) return 0;
  const at = haystack.indexOf(needle);
  if (at === -1) return 0;
  // A hit at a word boundary beats one buried mid-word, and a prefix beats both.
  if (at === 0) return haystack === needle ? 100 : 60;
  return haystack[at - 1] === ' ' ? 40 : 15;
}

async function load() {
  if (cached) return cached;

  let payload: RegisterShape;
  try {
    payload = JSON.parse(await readFile(FILE, 'utf8')) as RegisterShape;
  } catch (error) {
    // A missing asset is a build problem, not a runtime condition to swallow. Saying so
    // plainly beats a stack trace in the browser.
    throw new Error(
      `drug register asset missing at ${FILE}. Run scripts/build-drug-register.py ` +
        `(npm run build:register). Cause: ${error instanceof Error ? error.message : error}`,
    );
  }

  const index = new Map(payload.columns.map((name, i) => [name, i]));
  const rows = payload.entries.map((entry) => {
    const row: Record<string, unknown> = {};
    for (const [name, i] of index) row[name] = entry[i];
    // Precomputed once here rather than per query: normalising 25,000 rows inside the
    // request handler is the difference between a few milliseconds and a timeout.
    row._ar = normalise(String(row.nameAr ?? ''));
    row._en = normalise(String(row.nameEn ?? ''));
    row._generic = normalise(String(row.generic ?? ''));
    return row;
  });

  cached = { columns: payload.columns, provenance: payload.provenance, rows };
  return cached;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = normalise(url.searchParams.get('q') ?? '');
  const take = Math.min(Number(url.searchParams.get('limit') ?? LIMIT) || LIMIT, 50);

  if (query.length < 2) {
    // One character matches a quarter of the register and tells the user nothing.
    return NextResponse.json({ results: [], total: 0 });
  }

  try {
    const { rows, columns } = await load();

    const scored: Array<{ row: Record<string, unknown>; score: number }> = [];
    for (const row of rows) {
      // Arabic first, then English, then generic composition -- someone searching
      // "amoxicillin" wants the drug, not only the product whose brand happens to
      // contain the letters.
      const best = Math.max(
        score(row._ar as string, query) * 1.1,
        score(row._en as string, query),
        score(row._generic as string, query) * 0.8,
      );
      if (best > 0) scored.push({ row, score: best });
    }

    scored.sort((a, b) => b.score - a.score);

    // Same commercial name and manufacturer is the same product listed twice. Collapsing
    // it keeps eight rows of one medicine out of a twenty-row list.
    const seen = new Set<string>();
    const results: Array<Record<string, unknown>> = [];
    for (const { row } of scored) {
      const key = `${row.nameEn}|${row.manufacturer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const shaped: Record<string, unknown> = {};
      for (const name of columns) shaped[name] = row[name];
      results.push(shaped);
      if (results.length >= take) break;
    }

    return NextResponse.json(
      { results, total: scored.length, provenance: 'third-party CC0 compilation, not an EDA export' },
      { headers: { 'cache-control': 'private, max-age=60' } },
    );
  } catch (error) {
    console.error('[drug-register] search failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'search unavailable' },
      { status: 500 },
    );
  }
}