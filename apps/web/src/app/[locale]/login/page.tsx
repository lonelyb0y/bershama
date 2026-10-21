import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logo } from '@/components/logo';
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
    /*
     * The heading is the action, not the brand.
     *
     * It was the other way round: the app name as the h1, "Sign in" as a subtitle,
     * and the sentence explaining what the product is underneath both. A person who
     * followed a link from a catalogue or a requisition email did not come here to
     * read a brand name -- they came here to sign in, and the brand was the loudest
     * thing on the screen.
     *
     * So: the wordmark is a mark, the action is the heading, and the pitch is one
     * line under it. Everything below is the form, which is the point of the page.
     */
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <Logo />
        <LocaleSwitcher />
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('signIn')}</h1>
        <p className="text-[color:var(--text-muted)] mt-2 text-sm">
          {tLanding('headline')}
        </p>
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
