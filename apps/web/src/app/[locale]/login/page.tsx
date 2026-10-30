import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/auth/auth-shell';
import { TelemetryPanel } from '@/components/auth/telemetry-panel';
import { LoginForm } from '@/components/login-form';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { getSession, homeRouteForRole } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next } = await searchParams;

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
     * So: the wordmark is a mark in the bar, the action is the heading, and the
     * pitch is one line under it. The right half of the page is the product, which
     * is the better half of an argument.
     */
    <AuthShell
      eyebrow={tLanding('eyebrow')}
      title={t('signIn')}
      pitch={tLanding('headline')}
      aside={<TelemetryPanel />}
    >
      <h2 className="font-display text-lg font-semibold">{t('accountAccess')}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t('accountAccessBody')}</p>

      <div className="mt-5">
        <LoginForm />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs text-[var(--text-muted)]">{tCommon('or')}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="mt-4">
        <GoogleSignInButton label={t('continueWithGoogle')} next={next} />
      </div>
    </AuthShell>
  );
}
