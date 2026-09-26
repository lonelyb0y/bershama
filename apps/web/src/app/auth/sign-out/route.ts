// Sign-out.
//
// A POST route, not a link. A GET sign-out can be triggered by any page simply
// loading an <img src="/auth/sign-out">, which makes logging someone out a
// trivial cross-site attack.
//
// Supabase invalidates the refresh token server-side, so the session is genuinely
// revoked rather than just cleared in the browser.
//
// Note the missing request parameter: Next.js fixes the handler signature, and a
// declared-but-unused parameter only exists to satisfy the linter. signOut()
// works from the cookie alone.

import { redirect } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';

export async function POST() {
  const supabase = await getSupabase();
  await supabase.auth.signOut();

  // Relative redirect to the default locale's login. Never derive this from a
  // user-supplied parameter, which would be an open redirect.
  const locale = routing.defaultLocale;
  return redirect(`/${locale}/login`);
}
