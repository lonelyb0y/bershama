'use server';

/**
 * Alert centre writes, as server actions.
 *
 * Thin for the same reason the delivery actions are: every rule worth testing --
 * only a warehouse manager may acknowledge or resolve, an alert must belong to the
 * caller's tenant, a resolved alert cannot be acknowledged again -- lives in the
 * database as `api.ack_alert` / `api.resolve_alert` (0063), where it is one
 * transaction and cannot be bypassed by a client that decides to skip the form.
 *
 * The alternative is a client UPDATE on `alert_events`, and that table is exactly the
 * one where a partial write is meaningless: `acknowledged_by` without `acknowledged_at`,
 * or a status moved to RESOLVED while `occurrences` still counts the old run.
 */

import { revalidatePath } from 'next/cache';

import { getSupabaseApi } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/routing';
import { toApiError, ok, type ApiResult } from '@/lib/api/result';

/** Revalidate the alert list and the dashboard's open-alert count together. */
function revalidateAlerts(locale: string) {
  revalidatePath(`/${locale}/admin/alerts`);
  // The dashboard counts open alerts, so acknowledging one changes it.
  revalidatePath(`/${locale}/admin`, 'layout');
}

/** The locale the form was rendered in. See the note on coercion in `localeOf`. */
function localeOf(formData: FormData): Locale {
  // A server action has no request path to read a locale from, so the form carries it.
  // Coerced rather than cast: `as Locale` on an arbitrary string produces a value the
  // type system believes and `getTranslations` then rejects, which is worse than the
  // check.
  return String(formData.get('locale') ?? 'en') === 'ar' ? 'ar' : 'en';
}

export async function acknowledgeAlertAction(
  _prev: ApiResult<null>,
  formData: FormData,
): Promise<ApiResult<null>> {
  const locale = localeOf(formData);
  const alertId = String(formData.get('alertId') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('ack_alert', {
    p_alert_id: alertId,
    p_note: String(formData.get('note') ?? ''),
  });

  if (error) {
    // 42501 is a role failure and P0002 is "no open alert with that id" -- which
    // covers both "another tenant's alert" and "already acknowledged". Neither is
    // distinguished for the caller, and that is deliberate: saying which would tell
    // someone that an id exists in a tenant they cannot see.
    return toApiError(error, locale);
  }

  revalidateAlerts(locale);
  return ok(null);
}

export async function resolveAlertAction(
  _prev: ApiResult<null>,
  formData: FormData,
): Promise<ApiResult<null>> {
  const locale = localeOf(formData);
  const alertId = String(formData.get('alertId') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('resolve_alert', {
    p_alert_id: alertId,
    p_note: String(formData.get('note') ?? ''),
  });

  if (error) return toApiError(error, locale);

  revalidateAlerts(locale);
  return ok(null);
}

export async function runAlertScanAction(
  _prev: ApiResult<null>,
  formData: FormData,
): Promise<ApiResult<null>> {
  const locale = localeOf(formData);

  const api = await getSupabaseApi();
  const { error } = await api.rpc('run_alert_scan');

  if (error) return toApiError(error, locale);

  revalidateAlerts(locale);
  return ok(null);
}