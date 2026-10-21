'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';

import { usePathname, useRouter } from '@/i18n/routing';
import { locales, type Locale } from '@/i18n/routing';

/**
 * The language link.
 *
 * ── why it is a link in the footer and not a switcher in the header ──────────
 *
 * A two-word switcher in a header is a permanent claim on the busiest part of
 * every screen, and it is the most fragile thing in the layout: two words in
 * two scripts, which is exactly what wraps.
 *
 * So it is out of the header. The browser's language decides for a first
 * visitor, and the account settings decide for everyone else.
 *
 * But a visitor who has not signed in yet cannot reach the account settings.
 * For them the choice has to live somewhere, and the footer is the one place
 * on a sign-in page that is not asking for anything. One word, in the other
 * language, in the bottom corner.
 *
 * ── why it is a link and not a button ────────────────────────────────────────
 *
 * Because it changes the URL. `/en/login` becomes `/ar/login`, and that URL is
 * shareable, bookmarkable, and back-button-able -- which a button that
 * rewrites the page in place is none of those things.
 */
export function LocaleFooterLink() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const other = locales.find((l) => l !== locale) ?? 'en';

  return (
    <a
      href={`/${other}${pathname === '/' ? '' : pathname}`}
      hrefLang={other}
      dir="ltr"
      onClick={(event) => {
        // Let the router do it, so the transition is a client navigation and
        // the page does not reload. The href is still there for a middle click
        // and for scripting off.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        startTransition(() => {
          router.replace(pathname, { locale: other });
          // The <html lang dir> lives in the root layout, which a client
          // navigation does not re-render. Without the refresh the text changes
          // and the direction does not.
          router.refresh();
        });
      }}
      className="text-sm text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text)] hover:underline"
    >
      {other === 'ar' ? 'العربية' : 'English'}
    </a>
  );
}
