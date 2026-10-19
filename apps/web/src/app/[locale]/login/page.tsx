import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getSession, homeRouteForRole } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');
  const tCommon = await getTranslations('common');
  const tLanding = await getTranslations('landing');
  const session = await getSession();

  // Already signed in: skip the form.
  if (session) {
    redirect(`/${locale}${homeRouteForRole(session.role)}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-8 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {tCommon('appName')}
          </h1>
          <p className="text-[color:var(--text-muted)] mt-1 text-sm">
            {t('signIn')}
          </p>
          <p className="text-[color:var(--text-muted)] mt-3 text-sm">
            {tLanding('headline')}
          </p>
        </div>
        <LocaleSwitcher />
      </div>

      <LoginForm />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[color:var(--border)]" />
        <span className="text-xs text-[color:var(--text-muted)]">
          {tCommon('or')}
        </span>
        <span className="h-px flex-1 bg-[color:var(--border)]" />
      </div>

      <GoogleSignInButton label={t('continueWithGoogle')} />
    </main>
  );
}
