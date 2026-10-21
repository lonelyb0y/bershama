'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getRecaptchaToken } from '@/lib/recaptcha';
import { verifyRecaptchaTokenViaRoute } from '@/lib/recaptcha-verify';
import { assessPassword, MIN_LENGTH } from '@/lib/password';

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
/** Colour per score band. Not decoration: a 2-band has to look different from a 4-band. */
const STRENGTH_COLOURS = [
  'bg-current/10',
  'bg-[var(--color-stock-critical)]',
  'bg-[var(--color-warn)]',
  'bg-[var(--color-stock-ok)]',
  'bg-[var(--color-stock-ok)]',
] as const;

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

  // Re-derived every keystroke rather than stored in state: it is a pure function of
  // (password, email), and keeping one source of truth means the meter cannot disagree
  // with the check that actually runs on submit.
  const assessment = assessPassword(password, email);
  const strength = password.length === 0 ? null : assessment.score;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The form's own gate. A browser can be bypassed and this is not a security boundary --
    // see lib/password.ts -- but it means nobody can *choose* a weak password by accident,
    // and it can explain why before a generic server error does.
    const verdict = assessPassword(password, email);
    if (!verdict.ok) {
      setError(verdict.problems.map((problem) => t(`passwordRules.${problem}`)).join(' '));
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
        // Supabase's own reasons, mapped rather than flattened into "try again". Every one
        // of these is a real configuration state the person can act on or report, and
        // "Something went wrong" is how a misconfigured project gets shipped instead of
        // diagnosed.
        //
        //   "Signups not allowed for otp"  -> Allow new users to sign up is still off
        //   rate limit / security purposes -> too many attempts from this address
        //   already registered            -> this address has an account
        //
        // The raw message is logged regardless. It costs nothing and it is the difference
        // between a five-minute diagnosis and an afternoon.
        const reason = signUpError.message.toLowerCase();
        console.error('[signup] supabase refused signUp:', signUpError.message);

        if (reason.includes('signups not allowed') || reason.includes('signups are disabled')) {
          setError(t('signupsDisabled'));
        } else if (reason.includes('rate limit') || reason.includes('security purposes')) {
          setError(t('tooManyAttempts'));
        } else if (reason.includes('already') || reason.includes('registered')) {
          setError(t('emailTaken'));
        } else {
          setError(`${t('failed')} (${signUpError.message})`);
        }
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
        <p className="text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
      </div>

      <div className="pf-field">
        <label htmlFor="org" className="pf-field__label">
          {t('organisation')}
        </label>
        <input placeholder=" "
          id="org"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
          minLength={2}
          maxLength={160}
          autoComplete="organization"
          data-testid="signup-org"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
      </div>

      <div className="pf-field">
        <label htmlFor="name" className="pf-field__label">
          {t('fullName')}
        </label>
        <input placeholder=" "
          id="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          data-testid="signup-name"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
      </div>

      <div className="pf-field">
        <label htmlFor="email" className="pf-field__label">
          {t('email')}
        </label>
        <input placeholder=" "
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          data-testid="signup-email"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
      </div>

      <div className="pf-field">
        <label htmlFor="new-password" className="pf-field__label">
          {t('password')}
        </label>
        <input placeholder=" "
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          data-testid="signup-password"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
        <p className="text-xs text-[color:var(--text-muted)]">
          {t('passwordHint', { n: MIN_LENGTH })}
        </p>

        {strength !== null && (
          <div className="mt-2" data-testid="password-strength" data-score={strength}>
            <div
              className="flex gap-1"
              role="meter"
              aria-valuenow={strength}
              aria-valuemin={0}
              aria-valuemax={4}
              aria-label={t('strength')}
            >
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    step <= strength ? STRENGTH_COLOURS[strength] : 'bg-current/10'
                  }`}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-[color:var(--text-muted)]" aria-live="polite">
              {assessment.ok ? t('passwordGood') : t(`strengthScale.${strength}`)}
            </p>

            {/* Every outstanding problem, not just the first, so the meter never reads as
                "not moving" the way the coverage table's single figure did. */}
            {assessment.problems.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-[color:var(--color-warn)]">
                {assessment.problems.map((problem) => (
                  <li key={problem} data-testid={`password-problem-${problem}`}>
                    {t(`passwordRules.${problem}`)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
        disabled={isPending || !assessment.ok}
        data-testid="signup-submit"
        className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
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