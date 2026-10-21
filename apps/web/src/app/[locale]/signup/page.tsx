import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/auth/auth-shell';
import { TelemetryPanel } from '@/components/auth/telemetry-panel';
import { SignupForm } from '@/components/signup-form';
import { getSession } from '@/lib/session';
import type { Locale } from '@/i18n/routing';

/**
 * Self-serve signup.
 *
 * Redirects away when a session already exists, for the same reason the login page does:
 * a signed-in visitor has no business creating a second organisation, and
 * api.provision_tenant() would refuse them anyway. Redirecting here means they are not
 * shown a form whose submission is guaranteed to fail.
 */
export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');
  const tLanding = await getTranslations('landing');
  const session = await getSession();
  if (session) redirect(`/${locale}/admin`);

  return (
    <AuthShell
      eyebrow={tLanding('eyebrow')}
      title={t('createOrganisation')}
      pitch={tLanding('lede')}
      aside={<TelemetryPanel />}
    >
      <h2 className="font-display text-lg font-semibold">{t('createAccountAccess')}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t('createAccountAccessBody')}</p>

      <div className="mt-5">
        <SignupForm locale={locale} />
      </div>
    </AuthShell>
  );
}
