'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * "Continue with Google".
 *
 * The redirect is built by hand rather than passed through supabase-js's
 * `signInWithOAuth`, because the callback has to come back to *this* app's
 * `/auth/callback` route with a `next` of where the user was heading, and the
 * locale segment has to survive the round trip.
 */
export function GoogleSignInButton({
  label,
  next,
  disabled = false,
}: {
  label: string;
  /** Optional deep link the user was heading to; restored after sign-in. */
  next?: string;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? `/${locale}`)}`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { access_type: 'offline', prompt: 'consent' },
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        setBusy(false);
        return;
      }

      // With skipBrowserRedirect set, supabase-js returns the provider's URL in
      // `data.url` instead of navigating. Using that URL is what carries the
      // PKCE verifier and PKCE state through to the callback -- building an
      // equivalent URL by hand would lose both and the exchange would fail.
      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-[color:var(--border)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.29 9.14 5.38 12 5.38Z"
        />
      </svg>
      {busy ? '…' : label}
    </button>
  );
}