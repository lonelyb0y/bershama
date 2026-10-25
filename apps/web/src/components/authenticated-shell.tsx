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
import { HeaderCluster } from '@/components/header-cluster';
import { Logo } from '@/components/logo';
import { ConsoleDockNav } from '@/components/console-dock-nav';
import { ROLES_BY_SURFACE, getSession, homeRouteForRole } from '@/lib/session';
import { isLocale, Link, type Locale } from '@/i18n/routing';

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
    // The header.
    // -- why the navigation gets its own row below lg --------------------------
    // It used to be one row: wordmark, eight destinations, theme, language, name,
    // role and sign-out. The comment that used to sit above that markup recorded
    // what that cost -- the row ran out of room, "Sign out" broke across two lines,
    // and so did the user's name. Thirteen items do not fit on one line at 1024px,
    // and they will not be made to.
    // So from lg up it is one row, which is what a wide screen is for. Below lg the
    // navigation takes a second row of its own and scrolls sideways, which is the
    // behaviour every phone has taught people already: a tab strip, not a wrapped
    // sentence. Phrases stay phrases at every width because nothing has to wrap.
    // -- the glass -------------------------------------------------------------
    // The same material as the dashboard, so the page reads as one surface rather
    // than a header sitting on top of a different design. `pf-glass-header` is a
    // separate class from `pf-glass` because a sticky header needs more opacity to
    // stay legible over content passing underneath -- at the dashboard's 78% the text
    // loses its background every time a row scrolls behind it.
      <div className="min-h-dvh">
      <header
        // Named. A banner and a main with no name are two landmarks a screen
        // reader lists as "banner" and "main" -- which tells a person using the
        // landmark list nothing about which is which, on a page that has a
        // navigation in it.
        aria-label={t('common.appName')}
        className="pf-glass-header sticky top-0 z-30"
      >
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center gap-4">
            <Link
              // NO locale prefix. next-intl's Link expects a locale-less path and
              // prefixes the active locale itself -- the mistake the login form made
              // once, which produced /en/en/admin on every click.
              href={homeRouteForRole(session.role)}
              // Prefetching off: every authenticated page was round-tripping the
              // dashboard for a link in the corner, including the dashboard itself.
              prefetch={false}
              className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
              // The wordmark is the way home, as a logo is in any other application.
              aria-label={t('common.appName')}
            >
              <Logo />
            </Link>

            {/* On wide screens the navigation lives here; below lg this wrapper is
                hidden and the strip underneath carries it. */}
            <div data-testid="header-nav" className="hidden min-w-0 flex-1 lg:block">
              <AppNav surface={surface} role={session.role} />
            </div>

            <HeaderCluster displayName={displayName} role={session.role} surface={surface} />
          </div>

          {/* Below lg: the navigation on its own row, scrollable rather than wrapped.
              The scrollbar is hidden on purpose -- a visible one on a tab strip is
              noise, and the strip's own overflow is the affordance. */}
          <div data-testid="header-nav-strip" className="-mx-4 border-t border-[color:var(--border)]/30 lg:hidden overflow-x-auto scrollbar-hide">
            {/* A different name from the navigation above, not the same one.
                They are the same destinations in two arrangements, and two
                landmarks with the same name are a landmark list that says
                nothing. */}
            <nav aria-label={t('nav.sections')} className="px-4 min-w-0">
              <AppNav surface={surface} role={session.role} />
            </nav>
          </div>
        </div>
      </header>

      <main
        aria-label={t('common.appName')}
        className="mx-auto max-w-7xl px-4 py-6"
      >
        {children}
      </main>

      {/*
        The console dock, on the admin surface only.

        A magnification dock is a mouse affordance, and it is a quick-jump rail for
        a person at a desk with six destinations in their head. The driver, the
        pharmacy and the distributor surfaces are phone surfaces, where the
        magnification does nothing, so the dock is not rendered there at all.
      */}
      {surface === 'admin' ? <ConsoleDockNav locale={locale} /> : null}
      </div>
  );
}
