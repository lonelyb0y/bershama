'use server';

/**
 * The account settings actions.
 *
 * ── why the language lives here and not in the header ────────────────────────
 *
 * A language switcher in the header is a control for something most people set
 * once and never touch again. It also costs a permanent slot in the busiest
 * part of every screen, and it puts the most fragile part of the layout -- two
 * words in two scripts -- exactly where it is most likely to wrap and break.
 *
 * So the header does not carry it. The browser's language decides for a
 * first-time visitor, and the account decides for everyone else, and this
 * action is where that decision is written down.
 *
 * Two places hold it, and both are needed:
 *
 *   1. The `NEXT_LOCALE` cookie. next-intl's middleware reads it BEFORE the
 *      `Accept-Language` header, so it wins over the browser -- which is the
 *      whole point of choosing. The cookie is what makes the choice survive a
 *      hard reload and a different device being out of scope.
 *
 *   2. The profile. `api.update_my_profile` already takes a locale, so the
 *      preference is stored where the rest of the account lives, and it can be
 *      restored onto a new device by signing in.
 */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { getSupabase, getSupabaseApi } from '@/lib/supabase/server';
import { isLocale } from '@/i18n/routing';

const COOKIE = 'NEXT_LOCALE';
const YEAR = 60 * 60 * 24 * 365;

export async function setLocalePreference(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  const jar = await cookies();
  jar.set(COOKIE, locale, {
    path: '/',
    maxAge: YEAR,
    sameSite: 'lax',
  });

  // Best effort. The cookie is what makes the choice stick on this device; the
  // profile is what carries it to another one. A profile write must not be
  // able to fail the choice.
  try {
    const api = await getSupabaseApi();
    await api.rpc('update_my_profile', { p_locale: locale });
  } catch {
    // The cookie is already set, and it is the one that decides.
  }

  revalidatePath('/', 'layout');
}

/**
 * The display name, in both scripts.
 *
 * Both are kept because the header shows the Arabic name on the Arabic page
 * and the Latin one on the English page, and a member of staff who only ever
 * has one of them recorded was previously shown a blank.
 */
export async function updateProfile(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const fullNameAr = String(formData.get('fullNameAr') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  const api = await getSupabaseApi();
  await api.rpc('update_my_profile', {
    p_full_name: fullName || undefined,
    p_full_name_ar: fullNameAr || undefined,
    p_phone: phone || undefined,
  });

  revalidatePath('/', 'layout');
}

/**
 * Sign out everywhere else.
 *
 * `scope: 'others'` invalidates every other session and leaves this one alone,
 * which is the difference between "sign out of my other devices" and "sign me
 * out of the machine I am sitting at".
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut({ scope: 'others' });
}

/**
 * The notification preferences.
 *
 * A partial update: a null means "leave this one alone". That is what makes
 * one switch saveable without rewriting the other two, which is the whole
 * point of saving on change.
 */
export async function updateNotifications(values: {
  expiry?: boolean;
  deliveries?: boolean;
  requisitions?: boolean;
}): Promise<void> {
  const api = await getSupabaseApi();
  await api.rpc('update_my_notifications', {
    p_expiry: values.expiry,
    p_deliveries: values.deliveries,
    p_requisitions: values.requisitions,
  });
}
