// Authenticated shell: the frame every dashboard renders inside.
//
// The guard runs on the server, in the layout, before any child renders. Three
// reasons that placement matters:
//
//   1. A server-side guard cannot be bypassed by a client that skips the check.
//      Client-side checks are a UX affordance; this is the boundary.
//   2. The role comes from the session, which comes from the database, which is
//      behind RLS. Nothing the browser sends participates in the decision.
//   3. It runs once for the whole subtree instead of per page.

import { redirect, notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppNav } from '@/components/app-nav';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { ROLES_BY_SURFACE, getSession } from '@/lib/session';
import { isLocale, type Locale } from '@/i18n/routing';

type Surface = keyof typeof ROLES_BY_SURFACE;

export async function AuthenticatedShell({
  children,
  params,
  surface,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
  surface: Surface;
}) {
  const { locale: rawLocale } = await params;

  // Narrow the platform's `string` to a known locale. An unknown locale means
  // someone hand-crafted a URL, so it is a 404 rather than a silent fallback to
  // English -- serving the wrong text direction to an Arabic speaker is a bug,
  // not a harmless default.
  if (!isLocale(rawLocale)) {
    notFound();
  }
  const locale: Locale = rawLocale;
  setRequestLocale(locale);

  const t = await getTranslations();
  const session = await getSession();

  // Unauthenticated: send to login. The callback is a relative path, so it
  // cannot be used as an open redirect.
  if (!session) {
    redirect(`/${locale}/login`);
  }

  // Authenticated but wrong role for this surface.
  //
  // notFound() rather than a redirect: a user who guesses /admin should not be
  // told it exists, and silently bouncing them to their own dashboard would hide
  // a real authorisation bug during testing.
  if (!ROLES_BY_SURFACE[surface].includes(session.role)) {
    notFound();
  }

  const displayName = session.fullName;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">
            {t('common.appName')}
          </span>

          <AppNav surface={surface} role={session.role} />

          <div className="ms-auto flex items-center gap-3">
            <ThemeToggle />
            <LocaleSwitcher />
            <div className="text-end leading-tight">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-[color:var(--text-muted)] text-xs">
                {/* The role label is translated, never shown as a raw enum
                    value: "WAREHOUSE_MANAGER" means nothing to a warehouse
                    supervisor. */}
                {t(`roles.${session.role}` as never)}
              </p>
            </div>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
              >
                {t('common.signOut')}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
