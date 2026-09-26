'use client';

// Locale switcher.
//
// Two details that matter for correctness rather than looks:
//
//  1. `dir="ltr"` on the control itself. The language names are rendered in
//     their own scripts ("English", "العربية") and the flex row must not inherit
//     the page direction, or the two labels end up in the wrong order in Arabic.
//
//  2. router.refresh(), not just navigation. Changing the locale changes the
//     <html dir> attribute, which lives in the root layout. Next's client router
//     does not re-render a parent layout on a locale switch, so without the
//     refresh the page text translates but the layout stays mirrored the wrong
//     way.

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { usePathname, useRouter } from '@/i18n/routing';
import { locales, type Locale } from '@/i18n/routing';

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
};

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;

    startTransition(() => {
      router.replace(pathname, { locale: next });
      // Re-render the root layout so <html lang dir> is corrected.
      router.refresh();
    });
  }

  return (
    <div
      dir="ltr"
      role="group"
      aria-label={t('language')}
      className="flex shrink-0 gap-1 rounded-lg border p-1 text-sm"
    >
      {locales.map((candidate) => {
        const isActive = candidate === locale;

        return (
          <button
            key={candidate}
            type="button"
            onClick={() => switchTo(candidate)}
            aria-current={isActive ? 'true' : undefined}
            disabled={isPending}
            // The accessible name stays in the UI language so a screen-reader
            // user hears "English" in Arabic, not a transliteration.
            className={`rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? 'bg-[var(--color-brand-600)] text-white'
                : 'hover:bg-[color:var(--text-muted)]/10'
            }`}
          >
            {LOCALE_NAMES[candidate]}
          </button>
        );
      })}
    </div>
  );
}
