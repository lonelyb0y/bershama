import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { buildIndex, search } from '@/lib/drugs/register-search';
import type { RegisterIndex, RegisterRow } from '@/lib/drugs/register-search';

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
 * The register is ~25,000 products and a pharmacy orders a few hundred. So the register
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
 * lifetime a parsed register wants. Cold starts pay the parse and the index build once.
 *
 * The *index* -- not just the parsed rows -- is what is cached. Building the token index
 * takes about a quarter second over 24,686 rows; doing that per request would be the
 * single most expensive thing in the application.
 *
 * ── requiring a session ────────────────────────────────────────────────────────────
 *
 * Not because the data is secret -- it is CC0 and public. Because parsing and indexing
 * 3.9 MB is real CPU work, and an unauthenticated endpoint that anyone on the internet
 * can hammer is a way to spend the project's function quota for nothing. A signed-in
 * staff member is the only caller this has.
 */

const FILE = path.join(process.cwd(), 'data', 'drug-register.json');

let cached: RegisterIndex | null = null;

async function load(): Promise<RegisterIndex> {
  if (cached) return cached;

  let payload: { columns: string[]; entries: unknown[][] };
  try {
    payload = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (error) {
    // A missing asset is a build problem, not a runtime condition to swallow. Saying so
    // plainly beats a stack trace in the browser.
    throw new Error(
      `drug register asset missing at ${FILE}. Run scripts/build-drug-register.py ` +
        `(npm run build:register). Cause: ${error instanceof Error ? error.message : error}`,
    );
  }

  const index = Object.fromEntries(payload.columns.map((name, i) => [name, i]));
  const rows: RegisterRow[] = payload.entries.map((entry) => ({
    nameEn: String(entry[index.nameEn] ?? ''),
    nameAr: String(entry[index.nameAr] ?? ''),
    generic: String(entry[index.generic] ?? ''),
    manufacturer: String(entry[index.manufacturer] ?? ''),
    drugClass: String(entry[index.drugClass] ?? ''),
    route: String(entry[index.route] ?? ''),
    priceEgp: (entry[index.priceEgp] as number | null) ?? null,
  }));

  cached = buildIndex(rows);
  return cached;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 50);

  if (query.length < 2) {
    // One character matches a quarter of the register and tells the user nothing.
    return NextResponse.json({ results: [], total: 0 });
  }

  try {
    const index = await load();
    const hits = search(index, query, { limit });

    return NextResponse.json(
      {
        results: hits.map((hit) => hit.row),
        total: hits.length,
        // Stated where the suggestion came from, because a name copied out of an unofficial
        // compilation is not the same claim as one from the authority.
        provenance:
          'Third-party CC0 compilation of the Egyptian register, not an EDA export',
      },
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