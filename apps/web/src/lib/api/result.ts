// A result type every database call returns.
//
// The alternative is the one this project has been avoiding all along: a caller
// checks `.error` and remembers to map it. That is fine on the first call and
// wrong on the eleventh, because the eleventh one is the movement form at 23:00
// that nobody reread. `ApiResult` makes the failure case impossible to forget --
// there is no `.error` to miss, only a discriminant.
//
// The error is already localised. `localiseDbError` runs inside the wrapper, so a
// server action can render `result.error.message` directly and an Arabic user
// gets an Arabic sentence without the action knowing a locale is a thing.

import type { Locale } from '@/i18n/routing';
import { localiseDbError, type DbError } from '@/lib/errors';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code: string; isFallback: boolean } };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  error: { message: string; code: string; isFallback: boolean },
): ApiResult<T> {
  return { ok: false, error };
}

/**
 * Turn a supabase-js PostgREST result into an ApiResult.
 *
 * The two failure shapes are handled differently on purpose:
 *
 *   `{ error }`   the database refused. Expected, localisable, shown to the user.
 *   `data === null` on a call that must return a row. A silent failure, which is
 *                 the dangerous one: nothing threw, so a caller that only checks
 *                 `error` would treat it as success. RLS refusing a row looks
 *                 exactly like this -- a row the caller may not see is absent,
 *                 not denied -- so it is mapped to a real error rather than null.
 */
export function fromPostgrest<T>(
  result: { data: T | null; error: DbError | null },
  locale: Locale,
  opts: { missingMessage?: string } = {},
): ApiResult<T> {
  if (result.error) {
    const localised = localiseDbError(result.error, locale);
    return fail<T>({
      message: localised?.message ?? 'Unexpected error',
      code: localised?.code ?? 'unknown',
      isFallback: localised?.isFallback ?? true,
    });
  }

  if (result.data === null) {
    return fail<T>({
      message:
        opts.missingMessage ??
        'The record could not be read. It may have been removed, or you may not have access.',
      code: 'not_found',
      isFallback: false,
    });
  }

  return ok(result.data);
}

/**
 * Map a raised error to a localised failure.
 *
 * The single place error codes become sentences. Exported because the api
 * wrappers need it directly: `fromPostgrest` and `fromScalar` each assume a
 * particular result shape, and the stocktake and search calls return shapes
 * neither of them models.
 */
export function toApiError(error: DbError, locale: Locale): ApiResult<never> {
  const localised = localiseDbError(error, locale);
  return fail({
    message: localised?.message ?? 'Unexpected error',
    code: localised?.code ?? 'unknown',
    isFallback: localised?.isFallback ?? true,
  });
}

/**
 * A count, a total, or any scalar a PostgREST call returns where null is a
 * legitimate value.
 *
 * Separate from `fromPostgrest` because `qty_on_hand` can honestly be 0 and
 * `total_count` can be 0, and mapping those to "not found" would be nonsense.
 * Only `error` is a failure here.
 */
export function fromScalar<T>(
  result: { data: T | null; error: DbError | null },
  locale: Locale,
): ApiResult<T> {
  if (result.error) {
    const localised = localiseDbError(result.error, locale);
    return fail<T>({
      message: localised?.message ?? 'Unexpected error',
      code: localised?.code ?? 'unknown',
      isFallback: localised?.isFallback ?? true,
    });
  }

  // A null where a scalar was expected is still a failure, even though 0 is not.
  if (result.data === null) {
    return fail<T>({
      message: 'The database returned no value where one was expected.',
      code: 'null_result',
      isFallback: false,
    });
  }

  return ok(result.data);
}
