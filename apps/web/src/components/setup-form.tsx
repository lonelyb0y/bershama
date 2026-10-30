'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Finish setting up an account that exists but has no organisation.
 *
 * ## The situation this exists for
 *
 * `api.provision_tenant()` is normally called by the signup form, in the same submission
 * that creates the auth account. Three things can interrupt that:
 *
 *   - the tab closed between the email confirmation and the provisioning call;
 *   - email confirmation is on, so `signUp` returned no session and the call could not
 *     happen yet;
 *   - provisioning failed for a transient reason and the user retried the form.
 *
 * In every case the result is the same: an `auth.users` row, no `profiles` row. Such a
 * user reads nothing at all, and `getSession()` returns null, so every authenticated route
 * redirects them to /login with no way to tell that they are already half-made.
 *
 * ## Why no organisation name is asked for here
 *
 * Because it is asked for on the signup page and passed through the signup metadata, so a
 * user arriving here already told us. Re-asking would be a second chance to disagree with
 * themselves, and this route has to work for someone who no longer remembers what they
 * typed. So it reads the name back out of `user_metadata` and falls back to a generic
 * one only when it is genuinely absent.
 */
export function SetupForm({ locale }: { locale: string }) {
  const t = useTranslations('setup');
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [orgName, setOrgName] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Read back what the signup form recorded. Runs once, on mount.
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    setLoaded(true);
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const meta = data.user?.user_metadata ?? {};
      setOrgName(meta.org_name ?? '');
      setFullName(meta.full_name ?? '');
    })();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const { error: rpcError } = await supabase.rpc('provision_tenant', {
        p_org_name: orgName,
        p_full_name: fullName,
        p_country_code: 'EG',
        p_timezone: 'Africa/Cairo',
      });

      if (rpcError) {
        // The overwhelmingly likely cause is that this account already belongs to an
        // organisation -- which means setup is done and something else sent them here.
        // Saying so, and sending them onward, beats a generic failure they cannot act on.
        if (/already belongs/i.test(rpcError.message)) {
          router.push(`/${locale}/admin`);
          router.refresh();
          return;
        }
        setError(t('provisionFailed'));
        return;
      }

      router.push(`/${locale}/admin`);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="pf-display">{t('title')}</h2>
        <p className="text-sm text-[color:var(--text-muted)]">{t('subtitle')}</p>
      </div>

      <div className="pf-field">
        <label htmlFor="setup-org" className="pf-field__label">
          {t('organisation')}
        </label>
        <input placeholder=" "
          id="setup-org"
          value={orgName ?? ''}
          onChange={(e) => setOrgName(e.target.value)}
          required
          minLength={2}
          maxLength={160}
          autoComplete="organization"
          data-testid="setup-org"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
        <p className="text-xs text-[color:var(--text-muted)]">{t('organisationHint')}</p>
      </div>

      <div className="pf-field">
        <label htmlFor="setup-name" className="pf-field__label">
          {t('fullName')}
        </label>
        <input placeholder=" "
          id="setup-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          data-testid="setup-name"
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
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
        disabled={isPending || orgName === null}
        data-testid="setup-submit"
        className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? t('working') : t('submit')}
      </button>
    </form>
  );
}