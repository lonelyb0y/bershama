import { expect, test } from '@playwright/test';

/**
 * Colour contrast, measured rather than assumed.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * A palette change is the easiest way to ship an unreadable interface: every
 * value still "looks fine" in isolation and the failure only appears as a whole.
 * Getting here took three wrong harnesses, all of which reported confident
 * numbers about a page that was fine:
 *
 * 1. Parsing `getComputedStyle(...).color` as RGB. This palette serialises as
 *    `lab(...)`, whose three numbers are not 0-255, so every pair measured about
 *    1.47:1 — symmetric in light and dark, which is the tell that the instrument
 *    was broken rather than the colours.
 * 2. Painting onto a cleared canvas, so an element with `rgba(0,0,0,0)` — which
 *    is most inputs here, they carry `bg-transparent` — resolved to black and
 *    dark text on it measured 1.28:1.
 * 3. Collecting the whole ancestor background chain and painting it outermost
 *    first, so the outermost won and a white label on a brand button measured
 *    1.03:1 in light mode: white on a white page.
 *
 * The lesson: a measurement you have not checked against something you know is
 * true is worse than none, because it is believed.
 *
 * ── what is measured ────────────────────────────────────────────────────────
 *
 * Token pairs only: a foreground token against a background token, both
 * resolved from the document. That is deliberately not the same as reading a
 * computed style off a particular element — element pairs were where all three
 * bugs above lived, because they depend on what an element happens to inherit,
 * and the tokens are what a palette edit actually changes.
 *
 * Every pair is also asserted against a known answer first, so a future change to
 * this file cannot quietly stop measuring anything.
 */

/** Runs in the page: resolves `var(--x)` to bytes and returns the ratios. */
const RATIO_FN = `(tokens) => {
  const root = getComputedStyle(document.documentElement);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');

  const paint = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#ff00ff';           // sentinel, so a rejected colour is visible
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };

  const luminance = (c) => {
    const [r, g, b] = paint(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const resolve = (v) => (v.startsWith('var(') ? root.getPropertyValue(v.slice(4, -1)).trim() : v);

  const out = {};
  for (const [name, [fg, bg, minimum]] of Object.entries(tokens)) {
    const a = luminance(resolve(fg));
    const b = luminance(resolve(bg));
    const [hi, lo] = [a, b].sort((x, y) => y - x);
    out[name] = { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, minimum };
  }
  return out;
}`;

/**
 * The pairs a palette edit can break, with the WCAG threshold for each.
 *
 * `minimum` is per pair rather than global because the thresholds are not
 * uniform: 4.5:1 for text, 3:1 for a border or a focus ring, which are non-text
 * UI and have a different bar.
 */
/**
 * The pairs a palette edit can break, with the WCAG threshold for each.
 *
 * `minimum` is per pair rather than global because the thresholds are not
 * uniform: 4.5:1 for text, 3:1 for a border or a focus ring, which are non-text
 * UI and have a different bar.
 *
 * Theme-aware, and that is not tidiness. brand-600 is a BUTTON FILL on a light
 * page -- white sits on it -- and a TEXT COLOUR on a dark page, where the
 * constraint is brand-600 against the dark surface instead. Asserting "white on
 * brand-600" in both modes measures the light-mode relationship in dark mode,
 * which is meaningless and reports a failure for a pair that never occurs.
 */
/** One pair: a foreground, a background, and the WCAG threshold for it. */
type Pair = [string, string, number];

function pairs(scheme: 'light' | 'dark'): Record<string, Pair> {
  const brand: Record<string, Pair> = scheme === 'light'
    ? {
        'white on brand-600 (a button label)': ['#ffffff', 'var(--color-brand-600)', 4.5] as Pair,
        'brand-700 as a link on the surface': ['var(--color-brand-700)', 'var(--surface)', 4.5] as Pair,
      }
    : {
        'brand-600 as a link on the surface': ['var(--color-brand-600)', 'var(--surface)', 4.5] as Pair,
        'brand-700 as a link on the surface': ['var(--color-brand-700)', 'var(--surface)', 4.5] as Pair,
      };

  return {
    ...brand,
    'text on the surface': ['var(--text)', 'var(--surface)', 4.5] as Pair,
    'text on a raised card': ['var(--text)', 'var(--surface-raised)', 4.5] as Pair,
    'muted text on the surface': ['var(--text-muted)', 'var(--surface)', 4.5] as Pair,
    'muted text on a card': ['var(--text-muted)', 'var(--surface-raised)', 4.5] as Pair,
    // Non-text UI, so 3:1.
    'border on the surface': ['var(--border)', 'var(--surface)', 3] as Pair,
  };
}

test('the measurement is sound', async ({ page }) => {
  /*
   * Known answers, so a change to the harness cannot silently stop measuring
   * anything — which is the one failure all three broken versions shared.
   */
  await page.goto('/en/login');

  const known = await page.evaluate((fn) => {
    const ratio = eval(fn);
    return ratio({
      blackOnWhite: ['rgb(0,0,0)', 'rgb(255,255,255)', 4.5] as Pair,
      whiteOnBlack: ['rgb(255,255,255)', 'rgb(0,0,0)', 4.5] as Pair,
      sameColour: ['rgb(120,120,120)', 'rgb(120,120,120)', 4.5] as Pair,
      midGrey: ['rgb(118,118,118)', 'rgb(255,255,255)', 4.5] as Pair,
    });
  }, RATIO_FN);

  expect(known.blackOnWhite.ratio, 'black on white is the WCAG maximum, 21:1').toBeCloseTo(21, 0);
  expect(known.whiteOnBlack.ratio, 'and the ratio is symmetric').toBeCloseTo(21, 0);
  expect(known.sameColour.ratio, 'a colour against itself is 1:1').toBeCloseTo(1, 1);
  // 118 is the classic boundary case: 4.54:1, the last integer that passes AA.
  expect(known.midGrey.ratio, 'the 118 grey boundary case measures ~4.54').toBeGreaterThanOrEqual(4.5);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every token pair meets its threshold in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/en/login');
    await page.evaluate((s) => localStorage.setItem('pharmaflow:theme', s), scheme);
    await page.goto('/en/login');
    await page.waitForLoadState('networkidle').catch(() => {});

    // The tuple annotation matters: without it TypeScript widens the pair to
    // (string | Record<string, Pair>)[] and `eval(fn)` stops typechecking,
    // because the two elements are genuinely different types.
    const results = await page.evaluate(([fn, p]: [string, Record<string, Pair>]) => {
      return eval(fn)(p);
    }, [RATIO_FN, pairs(scheme)] as [string, Record<string, Pair>]);

    const failures = Object.entries(results as Record<string, { ratio: number; minimum: number }>)
      .filter(([, v]) => v.ratio < v.minimum)
      .map(([k, v]) => `${k}: ${v.ratio}:1, needs ${v.minimum}:1`);

    expect(failures, `contrast failures in ${scheme} mode`).toEqual([]);
  });
}