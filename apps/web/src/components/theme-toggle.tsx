'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { useTranslations } from 'next-intl';

/**
 * Light / dark toggle.
 *
 * One button that shows the moon in light mode and the sun in dark, and flips
 * when pressed. It replaced a three-button Light / Dark / Auto group, which
 * read as three labelled rectangles competing with the nav for the same row and
 * pushed the header into wrapping.
 *
 * The sun/moon glyph is the destination, not the current state -- you press the
 * moon to get darkness. That is the convention every other application uses and
 * the one people already understand without being told, so it beats a toggle
 * that shows the sun when you are already in the light and leaves you unsure
 * which press does what.
 *
 * Losing "Auto" is a deliberate trade: a person who wants the system preference
 * gets it on first visit, because nothing is stored until they choose. Anyone
 * who wants it back has it in the OS. "System" was a third option in a header
 * that had no room for a third option.
 *
 * The class on <html> is the source of truth, set before first paint by the
 * inline script in lib/theme-script.ts. This reads it through
 * useSyncExternalStore rather than copying it into state on mount, so the button
 * is right on the first paint and stays right when the OS preference changes
 * underneath it.
 */
const KEY = 'bershama:theme';

/**
 * Dark is the base, so the absence of a class means dark, not light.
 *
 * Reading it the other way round -- "is the root marked dark?" -- returned "light"
 * for a page with no class at all, which is the state a page is in before its
 * script runs. The button would have rendered as a light-theme control on a dark
 * page for the first frame.
 */
function readDomTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    observer.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

export function ThemeToggle() {
  const t = useTranslations('theme');
  const theme = useSyncExternalStore(subscribe, readDomTheme, () => 'dark' as const);
  const isDark = theme === 'dark';

  const toggle = useCallback(() => {
    const next = isDark ? 'light' : 'dark';

    const apply = () => {
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.classList.toggle('light', next === 'light');

      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        // A preference is not worth an exception. Private browsing in some
        // browsers throws on localStorage writes, and the class is already set.
      }
    };

    /*
     * The cross-fade.
     *
     * A theme change repaints every surface on the page at once, and without
     * help it reads as a flash -- which is a much worse experience than a
     * deliberate transition, because the eye reads the flash as a glitch and
     * the transition as an intention.
     *
     * The View Transitions API does this properly: the browser snapshots the
     * old page, applies the change, and cross-fades between the two on the
     * compositor. No JavaScript animation, no layout thrash, and it is
     * interruptible -- pressing the button again mid-transition picks up from
     * where it is.
     *
     * Two conditions skip it entirely:
     *
     *   - The browser has no View Transitions. The change is then instant,
     *     which is what everybody had before.
     *   - The reader has asked for reduced motion. A full-page cross-fade is
     *     exactly the kind of thing that setting is about, so the change is
     *     instant and silent.
     */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) {
      apply();
      return;
    }

    document.startViewTransition(apply);
  }, [isDark]);

  return (
    <button
      type="button"
      onClick={toggle}
      // The label states the destination, so it reads correctly to a screen
      // reader whether the button is in light or dark mode.
      aria-label={isDark ? t('switchToLight') : t('switchToDark')}
      title={isDark ? t('switchToLight') : t('switchToDark')}
      className="flex size-8 items-center justify-center rounded-lg border text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--text-muted)]/10 hover:text-[color:var(--text)]"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/**
 * Inline SVG rather than an icon package or an emoji.
 *
 * An emoji renders in the system emoji font, so the same button would look
 * different on every machine and would sit on the text baseline rather than
 * centring in a square hit target. Both are the kind of thing that is fine in
 * a mockup and wrong in a header.
 *
 * `currentColor` throughout, so the glyph follows the button's colour and
 * therefore the theme, with nothing to keep in sync.
 */
function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
