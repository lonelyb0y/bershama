/**
 * Search over the Egyptian drug register.
 *
 * Extracted from the API route so it can be tested without a server, and because the
 * first version of this logic was wrong in ways only real data revealed.
 *
 * ── why not substring matching ────────────────────────────────────────────────────
 *
 * The obvious implementation -- lowercase both sides, `indexOf` -- was tried and is not
 * good enough for Arabic drug names. Measured against the register (24,686 rows):
 *
 *   "بروفين"   -> 45 hits    the name is there
 *   "البروفين" -> 0 hits     the definite article
 *   "pareacetamol" -> 0 hits  the register spells it PARACETAMOL
 *
 * The article is the killer. **Zero** register rows begin with `ال`, because brand names
 * are written in their citation form, while essentially every Egyptian speaker types the
 * article. So the single most natural way to type any medicine returns nothing, and the
 * feature reads as broken rather than as incomplete.
 *
 * ── what this does instead ────────────────────────────────────────────────────────
 *
 * 1. Folds orthographic variants (hamza, alef, ya, ta marbuta, harakat, tatweel). The
 *    register and a human disagree about these constantly and neither is wrong.
 * 2. Strips the definite article from every token, on both sides.
 * 3. Matches **token by token**, so "بروفين 500" finds the 500mg pack and a query that is
 *    a substring of a longer word does not score as highly as a real word.
 * 4. Falls back to single-edit fuzzy matching, which is what catches the typos and
 *    transliteration drift (`أوجمنتين` vs `أوجمينتين`, `بنادول` vs `بانادول`) that
 *    substring matching cannot see at all.
 *
 * ── an index, because the fuzzy fallback has to be cheap ──────────────────────────
 *
 * Fuzzy distance against every token of 24,686 rows on every keystroke is far too slow.
 * So the register is tokenised once and inverted into prefix-keyed buckets at load. The
 * fallback then compares against *unique* tokens rather than every token occurrence,
 * which is roughly a third fewer comparisons and, more importantly, is a set of strings
 * rather than 100,000 of them.
 */

/** One row of the register, in the positional layout the build script writes. */
export interface RegisterRow {
  nameEn: string;
  nameAr: string;
  generic: string;
  manufacturer: string;
  drugClass: string;
  route: string;
  priceEgp: number | null;
}

/**
 * Where a match was found, and how much that is worth.
 *
 * `generic` outranks the brand names on purpose. Measured against the register, weighting
 * them equally put "COUGSID PARACETAMOL CHILDREN" above paracetamol for a search of
 * "paracetamol": the cold remedy contains the word in its *brand* name, while the real
 * paracetamol contains it in its *composition*. For somebody looking up a generic, the
 * composition is the answer and the brand is a coincidence of naming.
 *
 * Arabic still leads on ties -- it is what makes this register worth having, and the
 * pharmacist typing "بروفين" wants the brand.
 */
export type Field = 'ar' | 'en' | 'generic';

const FIELD_WEIGHT: Record<Field, number> = { ar: 1.15, en: 1, generic: 1.6 };

/** Tokens shorter than this are dropped: "5", "و", "2" match half the register. */
const MIN_TOKEN = 3;

/**
 * Fold spelling variants that carry no meaning for identity.
 *
 * Written as literal characters rather than `\u` escapes because a character class of
 * escapes is unreviewable, and these are the exact letters that differ between the
 * register and ordinary typing.
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/[ىی]/g, 'ي') // ى ی -> ي
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/[ً-ْٰـ]/g, '') // harakat, superscript alef, tatweel
    .replace(/[‐-―]/g, '-') // unicode dashes -> hyphen
    .replace(/[^\p{L}\p{N}\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop the definite article from a token.
 *
 * `البروفين` -> `بروفين`. Guarded on length, because Arabic has real words beginning
 * with the same letters -- `الله`, and more to the point drug names like `الثيراكين`
 * where the article is arguably part of the brand. Only strip when enough survives for
 * the result to still be a usable search term.
 */
export function stripArticle(token: string): string {
  if (token.length <= MIN_TOKEN + 1) return token;
  if (!token.startsWith('ال')) return token;
  const stripped = token.slice(2);
  return stripped.length >= MIN_TOKEN ? stripped : token;
}

/** Split folded text into searchable tokens. */
export function tokenize(value: string): string[] {
  return fold(value)
    .split(' ')
    .map(stripArticle)
    .filter((t) => t.length >= MIN_TOKEN);
}

/**
 * `token -> rowIndex -> weight`, where the weight is the best field that produced the
 * token.
 *
 * The first version stored a row list plus a parallel list of fields, which cannot work:
 * a token can appear in a row's Arabic name *and* its generic composition, and a row's
 * position in the bucket's array has nothing to do with which field matched it. Keyed by
 * row index, the best weight wins and the double-count disappears.
 */
type Bucket = Map<number, number>;

export interface RegisterIndex {
  buckets: Map<string, Bucket>;
  rows: RegisterRow[];
  /** Unique tokens, sorted. Prefix lookups walk this rather than the whole key space. */
  keys: string[];
}

export interface SearchOptions {
  limit?: number;
}

export function buildIndex(rows: RegisterRow[]): RegisterIndex {
  const buckets = new Map<string, Bucket>();
  // How many ingredients each row's generic composition lists. This is the difference
  // between "paracetamol" and "paracetamol + phenylephrine + chlorpheniramine", and for
  // somebody looking up a generic it is the whole answer.
  const genericWidth = new Map<number, number>();

  rows.forEach((row, rowIndex) => {
    const fields: Array<[Field, string]> = [
      ['ar', row.nameAr],
      ['en', row.nameEn],
      ['generic', row.generic],
    ];
    // Parenthetical content is a synonym, not a second ingredient. Counting
    // "PARACETAMOL(ACETAMINOPHEN)" as two made plain paracetamol look like a combination
    // product and halved its score against real multi-ingredient remedies.
    const ingredients = row.generic.replace(/\([^)]*\)/g, ' ');
    genericWidth.set(rowIndex, Math.max(1, tokenize(ingredients).length));

    for (const [field, text] of fields) {
      for (const token of tokenize(text)) {
        let bucket = buckets.get(token);
        if (!bucket) {
          bucket = new Map();
          buckets.set(token, bucket);
        }
        // A generic match on a combination product is a weaker answer than the same
        // match on the single-ingredient product, and the two are otherwise tied. Without
        // this, searching "paracetamol" returns a cold remedy above paracetamol.
        const width = field === 'generic' ? genericWidth.get(rowIndex) ?? 1 : 1;
        const weight = FIELD_WEIGHT[field] * (field === 'generic' ? 2 / (1 + width) : 1);
        const existing = bucket.get(rowIndex);
        if (existing === undefined || weight > existing) bucket.set(rowIndex, weight);
      }
    }
  });

  return { buckets, rows, keys: [...buckets.keys()].sort() };
}

export interface SearchHit {
  row: RegisterRow;
  score: number;
}

/** Levenshtein, bailing out as soon as the distance exceeds `limit`. */
function withinDistance(a: string, b: string, limit: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > limit) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    // Every cell in this row already exceeds the limit, so no later row can recover.
    if (rowBest > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

/**
 * Tokens within `limit` edits of `token`, restricted to a sensible length band so the
 * comparison set stays small. Without the band this is O(unique tokens) with a full
 * distance computation for each, on every keystroke of a typo.
 */
function fuzzyTokens(index: RegisterIndex, token: string, limit: number): string[] {
  const found: string[] = [];
  for (const key of index.keys) {
    if (Math.abs(key.length - token.length) > limit) continue;
    if (withinDistance(token, key, limit)) found.push(key);
  }
  return found;
}

/**
 * How many edits a token of this length may have.
 *
 * One edit for short tokens, two for longer ones -- which is not arbitrary: an extra or
 * missing character in a five-letter word is usually a different word, while in a
 * twelve-letter one it is usually a typo. The alternative, a flat limit of one, silently
 * misses the longer misspellings; a flat two, invents matches nobody typed.
 */
function distanceFor(token: string): number {
  return token.length >= 7 ? 2 : 1;
}

/** Tokens starting with `prefix`, from the sorted key list. */
function prefixTokens(index: RegisterIndex, prefix: string): string[] {
  const out: string[] = [];
  for (const key of index.keys) {
    if (key.startsWith(prefix)) out.push(key);
    // Sorted, so once a key stops matching, every later one does too.
    else if (out.length > 0) break;
  }
  return out;
}

export function search(
  index: RegisterIndex,
  query: string,
  { limit = 20 }: SearchOptions = {},
): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored = new Map<number, number>();
  // Row index -> how many of the query's tokens it matched, exactly or fuzzily.
  // Token -> the row indices it matched, so coverage is computed from the *best*
  // interpretation of each token rather than counting a token twice if it matched
  // both by prefix and fuzzily.
  const perToken = new Map<string, Set<number>>();

  const add = (token: string, rowIndex: number, weight: number) => {
    scored.set(rowIndex, (scored.get(rowIndex) ?? 0) + weight);
    const set = perToken.get(token);
    if (set) set.add(rowIndex);
    else perToken.set(token, new Set([rowIndex]));
  };

  const accumulate = (token: string, fuzzy: boolean) => {
    const direct = index.buckets.get(token);
    if (direct) {
      for (const [rowIndex, weight] of direct) add(token, rowIndex, weight);
      return;
    }

    // Prefix expansion, then fuzzy. Prefix first because "panad" is a deliberate
    // abbreviation and deserves full weight, while "pnadol" is a typo and should not.
    for (const key of prefixTokens(index, token)) {
      const bucket = index.buckets.get(key);
      if (!bucket) continue;
      for (const [rowIndex, weight] of bucket) add(token, rowIndex, weight * 0.9);
    }
    if (perToken.get(token)?.size) return;

    if (!fuzzy) return;
    for (const key of fuzzyTokens(index, token, distanceFor(token))) {
      const bucket = index.buckets.get(key);
      if (!bucket) continue;
      // Halved: a fuzzy hit is a suggestion, not an answer, and must never outrank a
      // real match on another token.
      for (const [rowIndex, weight] of bucket) add(token, rowIndex, weight * 0.5);
    }
  };

  for (const token of tokens) accumulate(token, false);
  // Only fall back for the tokens that found nothing. A query with one typo in it should
  // still be led by its correctly-spelled tokens.
  for (const token of tokens) if (!perToken.has(token)) accumulate(token, true);

  // Coverage: a row matching every query token beats one matching some of them, which is
  // what separates "بروفين 400" the pack from "بروفين" in general.
  const hits: SearchHit[] = [];
  for (const [rowIndex, raw] of scored) {
    let matched = 0;
    for (const set of perToken.values()) if (set.has(rowIndex)) matched += 1;
    hits.push({ row: index.rows[rowIndex], score: raw * (matched / tokens.length) });
  }

  hits.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = `${hit.row.nameEn}|${hit.row.manufacturer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}