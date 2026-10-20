'use client';

// Sign-in form.
//
// Sign-in goes through supabase.auth.signInWithPassword, not a custom endpoint.
// Supabase Auth owns the credential store, the token rotation and the refresh
// flow; reimplementing any of that would mean handling passwords ourselves, which
// is exactly the kind of decision that goes wrong in ways nobody notices until an
// incident.
//
// RLS is what limits what this session can reach. A valid password grants a
// session, and the session's authority is decided entirely by policies in the
// database — not by anything in this file.
//
// This uses the BROWSER client. Sign-in is an interactive client-side operation,
// and the server client cannot be imported here: it depends on next/headers and
// pulling that into a client component fails the build.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';

import { getSupabaseApiClient, getSupabaseBrowserClient } from '@/lib/supabase/client';
import { asWhoAmI } from '@/lib/mappers';
import { useRouter } from '@/i18n/routing';
import { homeRouteForRole } from '@/lib/roles';
import { getRecaptchaToken } from '@/lib/recaptcha';
import { verifyRecaptchaTokenViaRoute } from '@/lib/recaptcha-verify';
import type { AppRole } from '@/lib/types';

export function LoginForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // A token per submission, before the password is sent anywhere. v3 scores the
    // interaction rather than the credentials, so this has to run on the real submit
    // and not on a timer -- a token minted while the user was still typing has
    // expired by the time they finish, and an expired token scores as missing.
    //
    // The verdict is checked *before* supabase.auth.signInWithPassword rather than
    // after: verifying afterwards would mean the credential check had already run,
    // so a bot would still have burned a real sign-in attempt against the rate
    // limiter, and the people whose attempts get limited would be the staff sharing
    // an office IP.
    const token = await getRecaptchaToken('login');

    // The verdict comes from the server, over a route -- never from this bundle.
    // The secret cannot be read here, so verifying here approved everything while
    // looking, in review, exactly like a working check.
    //
    // This always asks the server, rather than only when a token came back. The earlier
    // `if (token)` guard meant a submission carrying no token skipped the check
    // entirely without ever reaching a decision -- so the server saw nothing and could
    // not weigh it.
    //
    // What the server then does with a missing token is its own call, and the answer is
    // to allow: see lib/recaptcha-server.ts, where that decision cost a production
    // lockout before it was measured. This line is here because an unreachable *server*
    // is a different thing and does refuse -- failing to reach the check is not the
    // same as passing it.
    const verdict = await verifyRecaptchaTokenViaRoute(token);
    if (!verdict.ok) {
      setError(verdict.reason === 'hard_floor' ? t('recaptchaBlocked') : t('recaptchaChallenge'));
      return;
    }

    const supabase = getSupabaseBrowserClient();

    const { data: signIn, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !signIn?.user) {
      // Deliberately vague. Distinguishing "no such user" from "wrong password"
      // turns the form into an account-enumeration oracle.
      setError(t('invalidCredentials'));
      return;
    }

    // The role decides the destination, and it is read from the database rather
    // than from anything the client sent. Asking the server for the role after
    // sign-in means a tampered client cannot route itself somewhere privileged;
    // the route guard re-checks it anyway.
      const { data: sessionData } = await getSupabaseApiClient()
        .rpc('whoami')
        .maybeSingle();

    const role = (asWhoAmI(sessionData)?.role ?? 'ANALYST') as AppRole;

    startTransition(() => {
      // NO locale prefix here, deliberately.
      //
      // `useRouter` comes from '@/i18n/routing', which is next-intl's
      // locale-aware router: it expects a locale-less path and prefixes the active
      // locale itself. Passing `/${locale}${...}` made it produce /en/en/admin --
      // a 404 on every single sign-in, which is the bug reported as "after login
      // it throws me to the same URL". next-intl's router and a locale-prefixed
      // path are two different conventions, and mixing them doubles the segment.
      router.replace(homeRouteForRole(role));
      router.refresh();
    });
  }

  return (
    // method="post", and deliberately NO action attribute.
    //
    // A form with neither is a GET to the current URL, and a GET puts every field in
    // the query string. That put the password in the address bar, in the browser
    // history, in the Referer of anything the page loaded next and in every server
    // log on the way -- and it happened on a slow connection or a cold cache, which is
    // precisely when a person is not looking.
    //
    // method="post" puts the credentials in a request body instead. There is no
    // action, so a submit that happens before React has hydrated POSTs to the page
    // itself and is answered with a 405 -- a page route only answers GET. That is a
    // confusing answer and it is the right one: the alternative is the password in a
    // URL, and a confusing answer is cheaper than a leaked credential.
    //
    // An action attribute was tried and had to be taken back out. React 19 treats a
    // form with a string action as a form action and submits it natively, and it does
    // so *after* the submit handler has run: the password grant succeeded, and then
    // the native POST navigated the browser to the action and cancelled the
    // client-side navigation that was about to land on the dashboard. Every sign-in
    // ended at /login with a valid session and no error anywhere.
    <form onSubmit={onSubmit} method="post" className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium"
        >
          {t('email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          // dir="ltr" on the field itself: an email address is always
          // left-to-right, and letting it inherit an RTL container reorders the
          // @ and the domain in a way that looks like a typo.
          dir="ltr"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        // role="alert" so a screen reader announces the failure immediately
        // rather than leaving the user wondering why nothing happened.
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/10 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:opacity-60"
      >
        {isPending ? '…' : t('signIn')}
      </button>

      <p className="text-[color:var(--text-muted)] text-center text-xs">
        {t('noAccount')}{' '}
        <Link
          href={`/${locale}/signup`}
          className="font-medium underline underline-offset-2 hover:text-[color:var(--text)]"
        >
          {t('createOrganisation')}
        </Link>
      </p>
    </form>
  );
}
