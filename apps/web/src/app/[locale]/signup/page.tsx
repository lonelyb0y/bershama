import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { SignupForm } from '@/components/signup-form';
import { getSession } from '@/lib/session';
import { Logo } from '@/components/logo';
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
        {/* The mark, so the two public entry screens look like the same product as
            the one they lead into. A person who came from a link should not have
            to guess whether they are somewhere else. */}
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <SignupForm locale={locale} />
      </div>
    </main>
  );
}
