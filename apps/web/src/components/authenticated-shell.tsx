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

  // The Arabic name in Arabic. The session has carried both spellings all along
  // -- whoami returns full_name and full_name_ar -- and the header was showing
  // the Latin one on the Arabic page, so an Egyptian operator saw their own name
  // in the wrong script at the top of every screen. Falls back to the Latin name
  // for the many staff who have no Arabic name recorded, which is a real gap in
  // the profile rather than a reason to render an empty header.
  const displayName = locale === 'ar' ? (session.fullNameAr ?? session.fullName) : session.fullName;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">
            {t('common.appName')}
          </span>

          <AppNav surface={surface} role={session.role} />

          {/*
            min-w-0 and shrink-0 on the right-hand cluster, whitespace-nowrap on
            the phrases.

            With eight destinations in the nav plus four controls, the row ran out
            of room and wrapped mid-phrase: "Sign out" broke across two lines, and
            so did the user's name and the "Audit log" link. A name and a button
            are phrases, so they wrap as units or not at all. min-w-0 on the flex
            row lets the nav be the part that yields, and shrink-0 stops the
            controls being squeezed at all.
          */}
          <div className="ms-auto flex min-w-0 shrink-0 items-center gap-3">
            <div className="shrink-0">
              <ThemeToggle />
            </div>
            <div className="shrink-0">
              <LocaleSwitcher />
            </div>
            <div className="shrink-0 text-end leading-tight whitespace-nowrap">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="text-[color:var(--text-muted)] text-xs whitespace-nowrap">
                {/* The role label is translated, never shown as a raw enum
                    value: "WAREHOUSE_MANAGER" means nothing to a warehouse
                    supervisor. */}
                {t(`roles.${session.role}` as never)}
              </p>
            </div>
            <form action="/auth/sign-out" method="post" className="shrink-0">
              <button
                type="submit"
                className="rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-[color:var(--text-muted)]/10"
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
