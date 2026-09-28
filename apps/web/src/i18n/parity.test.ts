// English and Arabic must stay in step.
//
// An Arabic-only user is not an edge case here; the application is specified
// bilingual for an Egyptian distributor, and the interface is Arabic half the
// time. So a missing Arabic key is not a cosmetic gap -- it renders as a raw
// identifier, or next-intl throws, or the fallback silently shows the English
// string inside an RTL page with the punctuation pointing the wrong way.
//
// None of that is visible to an English-reading developer running the app in
// English, which is the only way these tests are usually run. So the parity is
// asserted in CI instead.
//
// Deliberately NOT asserted: that the two are translations of each other. That is
// a judgement about language, and it belongs to whoever wrote the Arabic, not to
// a string comparison. What is asserted is structural: the same keys, and no key
// left as an empty string, because an empty Arabic string renders as nothing at
// all and looks worse than the English it was meant to replace.

import { describe, expect, it } from 'vitest';

import ar from '@/i18n/messages/ar.json';
import en from '@/i18n/messages/en.json';

// An interface rather than `type Node = string | Record<string, Node>`, which
// TypeScript rejects as a circular type alias.
interface NodeObject {
  [key: string]: Node;
}
type Node = string | NodeObject;
type Catalogue = Record<string, Record<string, Node>>;

const EN = en as unknown as Catalogue;
const AR = ar as unknown as Catalogue;

/**
 * Every leaf path, however deeply nested.
 *
 * Recursive because the catalogues are not flat. `requisitions.status` is an
 * object mapping each status enum value to its label, and the first version of
 * this test walked exactly one level -- so all ten of those keys, in both
 * languages, were outside its reach and a missing one there would have been
 * invisible. A parity check that skips a namespace is worse than no parity check,
 * because the file's existence reads as coverage.
 */
function leafPaths(catalogue: Catalogue): Map<string, string> {
  const out = new Map<string, string>();

  const walk = (node: Node, path: string) => {
    if (typeof node === 'string') {
      out.set(path, node);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  for (const [namespace, values] of Object.entries(catalogue)) {
    walk(values, namespace);
  }

  return out;
}

describe('locale catalogues', () => {
  it('have the same namespaces', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('have the same keys in every namespace', () => {
    // The failure this catches: a key added to en.json for a new screen, with the
    // Arabic left for later. The English screen works, the Arabic one throws or
    // falls back, and neither is visible in an English test run.
    const enLeaves = leafPaths(EN);
    const arLeaves = leafPaths(AR);

    const missingInAr = [...enLeaves.keys()].filter((k) => !arLeaves.has(k)).sort();
    const missingInEn = [...arLeaves.keys()].filter((k) => !enLeaves.has(k)).sort();

    expect({ missingInAr, missingInEn }).toEqual({ missingInAr: [], missingInEn: [] });
  });

  it('have no empty values', () => {
    // An empty string renders as nothing, which is harder to notice than a wrong
    // translation and easier to ship: the key exists, so a parity check passes.
    const empty: string[] = [];
    for (const [name, catalogue] of [
      ['en', EN],
      ['ar', AR],
    ] as const) {
      for (const [path, value] of leafPaths(catalogue)) {
        if (value.trim() === '') empty.push(`${name}.${path}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('keeps the same interpolation placeholders in both languages', () => {
    // A message with {days} in English and nothing in Arabic renders as
    // "30 days" with the number replaced by nothing, or throws -- depending on
    // next-intl's configuration, which is not something to find out in Arabic.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    const mismatched: string[] = [];
    const enLeaves = leafPaths(EN);
    const arLeaves = leafPaths(AR);

    for (const [path, value] of enLeaves) {
      const arValue = arLeaves.get(path);
      if (arValue === undefined) continue;
      if (placeholders(value).join(',') !== placeholders(arValue).join(',')) {
        mismatched.push(path);
      }
    }

    expect(mismatched).toEqual([]);
  });
});

describe('the stocktake namespace specifically', () => {
  it('exists in both languages', () => {
    expect(EN.stocktake).toBeDefined();
    expect(AR.stocktake).toBeDefined();
  });

  it('is actually Arabic, not a copy of the English', () => {
    // leafPaths rather than Object.values: the namespace may gain a nested
    // object, and this assertion should keep covering all of it.
    const arValues = [...leafPaths(AR)]
      .filter(([path]) => path.startsWith('stocktake.'))
      .map(([, value]) => value);

    // Arabic script. A namespace copied from en.json passes every structural check
    // above and is completely useless, which is the most likely way this goes
    // wrong: someone adds keys by duplicating the English file.
    const withArabic = arValues.filter((v) => /[؀-ۿ]/.test(v));
    expect(withArabic.length).toBe(arValues.length);
  });

  it('tells the user that blank means uncounted, not zero', () => {
    // The single most consequential sentence on this screen. A user who reads a
    // blank line as "zero" will enter 0 for every line they could not count, and
    // write off the whole warehouse.
    expect(EN.stocktake.blankMeansUncounted).toBeTruthy();
    expect(AR.stocktake.blankMeansUncounted).toBeTruthy();
  });
});
