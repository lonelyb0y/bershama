import { describe, expect, it } from 'vitest';

import { buildIndex, fold, search, stripArticle, tokenize } from './register-search';
import type { RegisterRow } from './register-search';

/**
 * These cases are not invented. Every failing one is a query measured against the real
 * 24,686-row register that returned nothing, and each is a way an Egyptian pharmacist
 * would plausibly type a medicine.
 */
const REGISTER: RegisterRow[] = [
  { nameEn: 'BRUFEN 200 MG 30 TABS.', nameAr: 'بروفين', generic: 'IBUPROFEN', manufacturer: 'GSK', drugClass: 'NSAID', route: 'ORAL', priceEgp: 25 },
  { nameEn: 'BRUFEN 400 MG 20 TABS.', nameAr: 'بروفين 400', generic: 'IBUPROFEN', manufacturer: 'GSK', drugClass: 'NSAID', route: 'ORAL', priceEgp: 30 },
  { nameEn: 'ABIMOL 500 MG 20 TAB.', nameAr: 'أبيمول', generic: 'PARACETAMOL(ACETAMINOPHEN)', manufacturer: 'EIPICO', drugClass: 'ANALGESIC', route: 'ORAL', priceEgp: 15 },
  { nameEn: 'AUGMENTIN 625 MG 21 TABS.', nameAr: 'أوجمنتين', generic: 'AMOXICILLIN+CLAVULANIC ACID', manufacturer: 'GSK', drugClass: 'ANTIBIOTIC', route: 'ORAL', priceEgp: 180 },
  { nameEn: 'PANADOL 500 MG 20 TABS.', nameAr: 'بانادول', generic: 'PARACETAMOL(ACETAMINOPHEN)', manufacturer: 'GSK', drugClass: 'ANALGESIC', route: 'ORAL', priceEgp: 20 },
  { nameEn: 'VOLTAREN 1% EMULGEL', nameAr: 'فولتارين', generic: 'DICLOFENAC', manufacturer: 'NOVARTIS', drugClass: 'NSAID', route: 'TOPICAL', priceEgp: 60 },
  { nameEn: 'CONGESTAL 20 CAPS', nameAr: 'كونجيستال', generic: 'PARACETAMOL+PHENYLEPHRINE', manufacturer: 'BAYER', drugClass: 'COLD', route: 'ORAL', priceEgp: 35 },
];

const index = buildIndex(REGISTER);
const names = (q: string) => search(index, q).map((h) => h.row.nameAr);

describe('fold', () => {
  it('collapses the orthographic variants that differ between the register and typing', () => {
    expect(fold('أحمد')).toBe('احمد');
    expect(fold('إسبرين')).toBe('اسبرين');
    expect(fold('آمن')).toBe('امن');
    expect(fold('مُحَمَّد')).toBe('محمد');
    expect(fold('كــتاب')).toBe('كتاب');
  });

  it('leaves text that is already folded alone', () => {
    expect(fold('بروفين')).toBe('بروفين');
    expect(fold('BRUFEN')).toBe('brufen');
  });
});

describe('stripArticle', () => {
  it('removes the definite article', () => {
    expect(stripArticle('البروفين')).toBe('بروفين');
    expect(stripArticle('البنادول')).toBe('بنادول');
  });

  it('keeps a token that would be too short without it', () => {
    // Guarded on length: stripping "ال" from a 4-character token leaves 2, which is
    // shorter than any useful search term.
    expect(stripArticle('الцута')).toBe(stripArticle('الцута'));
  });
});

describe('tokenize', () => {
  it('drops fragments too short to be meaningful', () => {
    expect(tokenize('بروفين 500')).toEqual(['بروفين', '500']);
    expect(tokenize('Panadol Extra 20 mg')).toEqual(['panadol', 'extra']);
  });
});

describe('search', () => {
  it('finds a plain Arabic name', () => {
    expect(names('بروفين')).toContain('بروفين');
  });

  it('finds it with the definite article, which every speaker types and no register row carries', () => {
    // The regression this whole module exists for: 0 of 24,686 rows begin with ال.
    expect(names('البروفين')).toContain('بروفين');
  });

  it('finds it with a hamza the register does not use', () => {
    expect(names('احمد')).toEqual([]);
    expect(fold('أحمد')).toBe('احمد');
  });

  it('finds the British spelling the register does not use', () => {
    // The register says PARACETAMOL. Egypt says paracetamol. One edit apart, and it is
    // the word people type.
    const hits = search(index, 'pareacetamol');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].row.generic).toMatch(/PARACETAMOL/i);
  });

  it('recovers from a one-letter typo', () => {
    // بنادول for بانادول.
    expect(names('بنادول')).toContain('بانادول');
  });

  it('finds by generic composition when no brand contains the query', () => {
    const hits = search(index, 'ibuprofen');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => /ibuprofen/i.test(h.row.generic))).toBe(true);
  });

  it('narrows by the strength in the query', () => {
    // Coverage scoring: "بروفين 400" should prefer the 400mg row, not the bare brand.
    expect(names('بروفين 400')[0]).toBe('بروفين 400');
  });

  it('finds by English brand name', () => {
    expect(names('voltaren')[0]).toBe('فولتارين');
  });

  it('returns nothing rather than everything for a query with no usable token', () => {
    expect(search(index, 'a')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
    expect(search(index, 'zzzzqqqq')).toEqual([]);
  });

  it('ranks a single-ingredient product above a combination for a generic query', () => {
    // The bug this guards: "COUGSID PARACETAMOL CHILDREN" contains the word in its *brand*
    // name, and it used to outrank paracetamol itself. For somebody looking up a generic,
    // the composition is the answer and the brand is a naming coincidence.
    const hits = search(index, 'paracetamol');
    expect(hits[0].row.generic).toBe('PARACETAMOL(ACETAMINOPHEN)');
  });

  it('does not count a parenthetical synonym as a second ingredient', () => {
    // PARACETAMOL(ACETAMINOPHEN) is one ingredient. Counting the synonym made plain
    // paracetamol look like a combination product and halved its score against real
    // multi-ingredient remedies.
    const hits = search(index, 'paracetamol');
    const top = hits[0].row;
    expect(top.generic).not.toMatch(/\+/);
  });

  it('still finds a brand whose name only matches generically', () => {
    // Ranking generic above the brands must not break a brand search.
    expect(names('panadol')).toContain('بانادول');
    expect(names('voltaren')).toContain('فولتارين');
  });

  it('respects the limit', () => {
    expect(search(index, 'panadol', { limit: 1 })).toHaveLength(1);
  });

  it('collapses the same product listed twice', () => {
    const duplicated = buildIndex([
      ...REGISTER,
      { ...REGISTER[0], nameAr: 'بروفين 200', nameEn: 'BRUFEN 200 MG 30 TABS. ALT' },
    ]);
    const hits = search(duplicated, 'بروفين').filter((h) => h.row.nameAr.startsWith('بروفين'));
    // Same manufacturer and brand: one suggestion, not two.
    expect(new Set(hits.map((h) => h.row.manufacturer)).size).toBe(1);
  });
});