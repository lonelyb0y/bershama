import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json';

/**
 * The translation files are checked rather than trusted.
 *
 * Two real defects were found by looking at a screenshot of a rendered page, and
 * neither was visible in a test:
 *
 *   ar.products.badge.rx      = "统计局"   (Chinese: a statistics bureau)
 *   ar.products.badge.controlled = "مcontrolled"  (Latin text in an Arabic value)
 *
 * Both were produced by string handling in a throwaway script, both rendered as
 * visible nonsense on a page, and both passed every other check -- the keys
 * existed, so nothing complained. A missing key is loud; a *wrong* one is silent,
 * which is why nothing caught them until somebody looked.
 *
 * So: every Arabic value must be free of scripts that have no business being
 * there, and the two files must have the same shape, so a key added to one and
 * forgotten in the other is caught here rather than at runtime.
 */

type Tree = { [key: string]: string | Tree };

const CJK = /[　-鿿豈-﫿]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/** Every leaf string, with its dotted path. */
function leaves(node: Tree, path = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) => {
    const here = path ? `${path}.${key}` : key;
    return typeof value === 'string' ? [[here, value]] : leaves(value, here);
  });
}

const enLeaves = new Map(leaves(en as Tree));
const arLeaves = new Map(leaves(ar as Tree));

describe('translation files', () => {
  it('have the same keys in both locales', () => {
    const missingInAr = [...enLeaves.keys()].filter((k) => !arLeaves.has(k));
    const missingInEn = [...arLeaves.keys()].filter((k) => !enLeaves.has(k));

    expect(
      { missingInAr, missingInEn },
      'a key present in one locale and not the other renders as a raw key at runtime',
    ).toEqual({ missingInAr: [], missingInEn: [] });
  });

  it('has no Chinese characters in the Arabic file', () => {
    // Not because Chinese cannot be legitimate in an Egyptian pharmacy -- it can
    // appear on imported packaging -- but because a *translation* value in
    // Chinese means a copy-paste went sideways, and that is exactly what happened
    // to ar.products.badge.rx.
    const offenders = [...arLeaves].filter(([, v]) => CJK.test(v)).map(([k]) => k);
    expect(offenders, 'CJK characters in the Arabic file').toEqual([]);
  });

  it('has no Cyrillic characters in either file', () => {
    const offenders = [...enLeaves, ...arLeaves]
      .filter(([, v]) => CYRILLIC.test(v))
      .map(([k]) => k);
    expect(offenders, 'Cyrillic characters in a translation value').toEqual([]);
  });

  it('has no Arabic values with Latin words left in them', () => {
    /*
     * Narrow on purpose. Product names, SKUs, batch numbers and company names are
     * legitimately Latin inside an Arabic sentence, so this cannot forbid Latin
     * characters.
     *
     * What it forbids is a Latin *word* longer than two characters glued
     * directly to Arabic with no space. "مcontrolled" is that; "أموكسيل 500" is
     * not, because there is a space. The threshold is two rather than three so
     * a stray "kg" or "ml" in a unit string does not fail the build.
     */
    const stuck = [...arLeaves]
      .filter(([, v]) => /[؀-ۿ][A-Za-z]{2,}|[A-Za-z]{2,}[؀-ۿ]/.test(v))
      .map(([k, v]) => `${k} = ${v}`);

    expect(stuck, 'Latin words with no space from Arabic text').toEqual([]);
  });

  it('has no empty translation values', () => {
    // An empty string renders as a blank label, which is worse than a missing
    // key because nothing complains.
    const empty = [...enLeaves, ...arLeaves]
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    expect(empty, 'empty translation values').toEqual([]);
  });

  it('has no unresolved next-intl interpolation braces', () => {
    // `{count}` is a placeholder and must survive. A lone `{` is a typo, and
    // next-intl renders it literally into the page.
    const broken = [...enLeaves, ...arLeaves]
      .filter(([, v]) => /(^|[^\\])[{](?!\w+\})/.test(v))
      .map(([k, v]) => `${k} = ${v}`);

    expect(broken, 'unbalanced interpolation braces').toEqual([]);
  });
});

// A sanity check on the loader itself: if this file ever imports the wrong thing
// the rest of the suite would quietly assert against an empty object.
describe('the message loader', () => {
  it('actually loaded both files', () => {
    expect(enLeaves.size).toBeGreaterThan(100);
    expect(arLeaves.size).toBe(enLeaves.size);
  });

  it('can read the same files from disk, so the import is not a transform artifact', () => {
    for (const name of ['en', 'ar']) {
      const raw = readFileSync(join(process.cwd(), 'src/i18n/messages', `${name}.json`), 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});
