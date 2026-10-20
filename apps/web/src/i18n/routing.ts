// Internationalisation for Bershama.
//
// Two locales from the start: English and Arabic. Arabic is not an afterthought
// here. The operator is in Egypt, staff will read Arabic, product names are
// bilingual, and the layout must be genuinely right-to-left. Retrofitting RTL
// into a shipped interface means revisiting every component, so the `dir`
// attribute is driven by locale from the first commit and never hardcoded.
//
// A locale that only switches text but leaves the layout mirrored is worse than
// no translation at all, so direction is treated as part of the locale
// definition rather than a component-level concern.

import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeDirection: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
};

export const localeLabel: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
};

// Money is integer minor units (piastres for EGP) end to end. There is no
// floating-point money anywhere in this system, so formatting is a display
// concern only and never a place to round.
export const localeTag: Record<Locale, string> = {
  en: 'en-EG',
  ar: 'ar-EG',
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return localeDirection[locale];
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always prefix the URL with the locale. /ar/... and /en/... both exist, which
  // keeps deep links and bookmarks unambiguous once a second locale is live.
  localePrefix: 'always',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
