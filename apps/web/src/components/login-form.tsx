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

  // The two fields are NOT React state.
  //
  // They were, and the form worked only when the bundle had loaded before the person
  // started typing. A controlled input whose value lives in state is empty until React
  // has hydrated: type into it first and the keystrokes go into the DOM, React's state
  // never sees them, and the submit sends nothing. GoTrue's answer was literally
  // "missing email or phone" -- the request had no email in it at all.
  //
  // It is worse than a failed sign-in, because hydration then re-renders the field and
  // erases what was typed. On a slow connection or a cold cache, the email a person
  // carefully typed could be deleted from under them as they reached for the button.
  //
  // So the fields are uncontrolled, and the submit handler reads them from the form
  // itself. What the person typed is what gets sent, whenever they typed it.
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Whether the password is visible. The state is here and not on the server
  // because it is a viewing preference and it has to change on the same frame
  // as the click.
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // From the form, not from state. See the note on the fields above.
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    /*
     * "Remember this device", before the credentials go anywhere.
     *
     * It is a real preference and it is honoured by the server: the Supabase
     * session cookie is written with a thirty-day lifetime when this is ticked,
     * and as a session cookie -- which dies when the browser closes -- when it
     * is not. See lib/supabase/server.ts, where the cookie's maxAge is read
     * from this one.
     *
     * It is set BEFORE the sign-in, not after, because the cookie is written by
     * the sign-in response. A preference recorded afterwards would be one
     * response too late, and the first sign-in on a new device would always be
     * the short-lived one.
     */
    const remember = form.get('remember') === 'on';
    try {
      document.cookie = `bershama:remember=${remember ? '1' : '0'}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // A browser that refuses cookies refuses them for the session too, and
      // the sign-in still works.
    }

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

      const whoamiRole = asWhoAmI(sessionData)?.role;
      let role: AppRole;
      if (whoamiRole) {
        // Profile exists in the database; use the database role (source of truth).
        role = whoamiRole;
      } else {
        // No profile yet (e.g. demo accounts created via the Admin API before
        // the seed ran). Fall back to the signed JWT's user_metadata, which
        // Supabase issued and cannot be forged by the client.
        const { data: { user } } = await getSupabaseBrowserClient().auth.getUser();
        role = (user?.user_metadata?.role as AppRole) ?? 'ANALYST';
      }

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
      {/*
        The label lives inside the field and rises out of it, like every other
        form in the product. It is still a real <label for>, so the accessible
        name is unchanged; only the position moved.
      */}
      <div className="pf-field">
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
          // Uncontrolled, and read at submit time from the form. See the note on
          // the fields in the component body: a controlled field is empty until
          // React has hydrated, and hydration then erases what was typed.
          defaultValue=""
          // A single space, so that `:placeholder-shown` can tell an empty
          // field from a filled one. The label is what the person reads.
          placeholder=" "
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
        <label htmlFor="email" className="pf-field__label">
          {t('email')}
        </label>
      </div>

      <div className="pf-field">
        <input
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          dir="ltr"
          autoComplete="current-password"
          required
          minLength={12}
          defaultValue=""
          placeholder=" "
          className="w-full rounded-2xl border bg-transparent px-3 pe-16 text-sm"
        />
        <label htmlFor="password" className="pf-field__label">
          {t('password')}
        </label>
        {/*
          The toggle sits at the END of the field, on the value band's line, and
          it is a real button so it can be reached by keyboard and announced.
          It is not a label: a label would move the focus to the input, which is
          the opposite of what a person pressing "Show" wants.
        */}
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-pressed={showPassword}
          className="pf-field__toggle text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          {showPassword ? t('hidePassword') : t('showPassword')}
        </button>
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

      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="size-4 rounded border-[var(--border-control)] accent-[var(--primary)]"
          />
          {t('rememberDevice')}
        </label>
        <a
          href="#forgot"
          className="text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
        >
          {t('forgotPassword')}
        </a>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-[filter,transform] hover:brightness-110 active:translate-y-px disabled:opacity-60"
      >
        {isPending ? '…' : t('signIn')}
      </button>

      <p className="text-center text-sm text-[var(--text-muted)]">
        {t('noAccount')}{' '}
        <Link
          href={`/${locale}/signup`}
          className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
        >
          {t('createOrganisation')}
        </Link>
      </p>
    </form>
  );
}
