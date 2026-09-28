'use server';

// Server actions for the stocktake screen.
//
// Thin by design. Every decision worth testing lives in lib/api/stocktake-sheet.ts
// as a pure function, and this file only supplies the two things a server action
// can supply: the locale, and a client that is already bound to the caller's
// session.
//
// That split is the reason the sheet's partial-success behaviour can be tested
// at all. Through a server action, a refused line and a crashed action are both
// "500 Internal Server Error" from the caller's point of view, and there is no
// way to assert which line failed or why.

import { getSupabase } from '@/lib/supabase/server';
import { stockTake } from '@/lib/api/inventory';
import {
  submitStocktake,
  summariseSheet,
  type Poster,
  type SheetLine,
  type SheetResult,
} from '@/lib/api/stocktake-sheet';
import { getLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export interface StocktakeSubmission extends SheetResult {
  /** The locale the messages were rendered in, so the client need not guess. */
  locale: Locale;
  /** The summary, already localised. */
  summary: string;
}

/**
 * Post a count sheet for one location.
 *
 * The location is a separate argument rather than a field on each line, on
 * purpose. A count sheet is one location walked once, and taking the location per
 * line would mean a client bug -- or a crafted request -- could scatter one
 * sheet's counts across several locations while the screen still shows a single
 * location's heading.
 *
 * The per-line ids are still whatever the client sends, and they are not trusted:
 * every one of them goes through api.stock_take, which resolves it inside the
 * database under the caller's tenant. A batch belonging to another tenant is not
 * found, and a location that is not this one is not found either.
 */
export async function submitStocktakeAction(
  locationId: string,
  lines: SheetLine[],
): Promise<StocktakeSubmission> {
  const locale = (await getLocale()) as Locale;
  const supabase = await getSupabase();

  // Typed as the sheet's Poster rather than as stockTake's own input type, so
  // the narrowing the sheet promises is preserved through to the call. Passing
  // the wider StocktakeInput here is what the compiler rejected: it allows
  // countedQty to be undefined, which the sheet has already ruled out.
  const poster: Poster = (input) => stockTake(supabase, locale, input);

  const result = await submitStocktake(locationId, lines, { locale, poster });

  return { ...result, locale, summary: summariseSheet(result, locale) };
}
