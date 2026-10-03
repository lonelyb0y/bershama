'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getRecaptchaToken } from '@/lib/recaptcha';
import { verifyRecaptchaTokenViaRoute } from '@/lib/recaptcha-verify';

/**
 * Self-serve signup: create the account, then create the organisation.
 *
 * ## Why this is one form and not two pages
 *
 * The obvious build is a signup page and then an onboarding wizard. It is worse, because
 * it has to survive the gap between them: the database has an `auth.users` row and no
 * `profiles` row, and every RLS policy in the project compares `tenant_id` against
 * `private.current_tenant_id()`, which returns NULL for exactly that user. They can read
 * nothing at all, and `api.whoami()` returns zero rows so `getSession()` returns null and
 * the layout bounces them to /login. A half-created account with no route out of it.
 *
 * So provisioning happens here, immediately, while the session is fresh. If it fails the
 * user stays on this page with the error rather than falling into that hole, and /setup
 * exists as the recovery path for someone who closed the tab mid-way.
 *
 * ## Why there is no captcha widget on this form
 *
 * reCAPTCHA v3 is invisible and score-based; it needs no widget. Sign-in is checked
 * against the server before `signInWithPassword`, and signup is checked the same way
 * before `signUp`, because an open registration endpoint is exactly where an automated
 * account-farming script would otherwise point.
 */
export function SignupForm({ locale }: { locale: string }) {
  const t = useTranslations('signup');
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t('passwordTooShort'));
      return;
    }

    setIsPending(true);
    try {
      // Same order and same reasoning as sign-in: a token per submission, then the
      // server's verdict, and only then does Supabase hear about it. An open registration
      // endpoint is exactly where automated account-farming points, and checking after
      // signUp would mean the accounts were already created when we decided to refuse.
      const token = await getRecaptchaToken('signup');
      const verdict = await verifyRecaptchaTokenViaRoute(token);
      if (!verdict.ok) {
        setError(t(verdict.reason === 'hard_floor' ? 'recaptchaBlocked' : 'recaptchaChallenge'));
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/${locale}/setup`,
          // Supabase sends a session back immediately when email confirmation is off,
          // and withholds it when it is on. Both paths are handled below rather than
          // assumed.
          data: { full_name: fullName, org_name: orgName },
        },
      });

      if (signUpError) {
        setError(
          signUpError.message.toLowerCase().includes('already')
            ? t('emailTaken')
            : t('failed'),
        );
        return;
      }

      if (!data.session) {
        // Email confirmation is on, which is the correct production setting. They have an
        // account and no organisation yet; /setup finishes the job once they click the
        // link and sign in.
        setAwaitingEmail(true);
        return;
      }

      const tenantId = await provisionOrganisation();
      if (!tenantId) return; // provisionOrganisation has already set the error

      router.push(`/${locale}/admin`);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  /**
   * Turn the fresh auth account into a real user.
   *
   * Returns the new tenant id, or null after setting `error`. Kept separate from the
   * submit handler because it is also what /setup calls, and two copies of a
   * provisioning call would be two copies of the error messages too.
   */
  async function provisionOrganisation(): Promise<string | null> {
    const { data, error: rpcError } = await supabase.rpc('provision_tenant', {
      p_org_name: orgName,
      p_full_name: fullName,
      p_country_code: 'EG',
      p_timezone: 'Africa/Cairo',
    });

    if (rpcError) {
      setError(t('provisionFailed'));
      return null;
    }
    return data as string;
  }

  if (awaitingEmail) {
    return (
      <div className="space-y-4 text-center" data-testid="signup-awaiting-email">
        <h1 className="pf-display">{t('checkEmailTitle')}</h1>
        <p className="text-sm text-[color:var(--text-muted)]">{t('checkEmailBody', { email })}</p>
        <p className="text-xs text-[color:var(--text-muted)]">{t('checkEmailHint')}</p>
        <Link
          href={`/${locale}/login`}
          className="inline-block text-sm font-medium text-[color:var(--color-brand-600)]"
        >
          {t('backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="pf-display">{t('title')}</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
      </div>

      <div>
        <label htmlFor="org" className="block text-sm font-medium">
          {t('organisation')}
        </label>
        <input
          id="org"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
          minLength={2}
          maxLength={160}
          autoComplete="organization"
          data-testid="signup-org"
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          {t('fullName')}
        </label>
        <input
          id="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          data-testid="signup-name"
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {t('email')}
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          data-testid="signup-email"
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="new-password" className="block text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          data-testid="signup-password"
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('passwordHint')}</p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/10 px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        data-testid="signup-submit"
        className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? t('working') : t('submit')}
      </button>

      <p className="text-center text-xs text-[color:var(--text-muted)]">
        {t('haveAccount')}{' '}
        <Link
          href={`/${locale}/login`}
          className="font-medium text-[color:var(--color-brand-600)]"
        >
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}