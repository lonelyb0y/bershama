import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

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

  const session = await getSession();
  if (session) redirect(`/${locale}/admin`);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <SignupForm locale={locale} />
      </div>
    </main>
  );
}
