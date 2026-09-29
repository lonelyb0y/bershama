'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { useTranslations } from 'next-intl';

/**
 * The light / dark / system toggle.
 *
 * A client component, but the class on <html> is set by the inline script in
 * lib/theme-script.ts before first paint. This component only reflects and
 * changes that state afterwards, so there is no flash on load and the toggle
 * itself is not the thing responsible for the theme being correct.
 *
 * The DOM class is the source of truth, not React state, and it is read through
 * useSyncExternalStore rather than copied into state on mount. A useEffect that
 * set the state from the DOM would render once with the wrong label and then
 * correct itself, and it would do so in the one place where a flicker is most
 * visible. Subscribing to the class attribute means the button is right on the
 * first paint the user sees, and stays right if something else changes the class
 * -- including the OS listener inside the inline script.
 */
type Choice = 'light' | 'dark' | 'system';

const KEY = 'pharmaflow:theme';
const ORDER: Choice[] = ['light', 'dark', 'system'];

function readDomChoice(): Choice {
  const { classList } = document.documentElement;
  if (classList.contains('dark')) return 'dark';
  if (classList.contains('light')) return 'light';
  return 'system';
}

function subscribe(onChange: () => void) {
  // A MutationObserver on the class attribute, so a change made anywhere --
  // here, the inline script, the devtools, another tab -- re-renders this.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // Also across tabs, via storage events: a second tab writing the preference
  // should update this one without needing a reload.
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

  // On the server there is no DOM, and the server must assume the default. The
  // inline script has already run in the browser by the time this hydrates, so
  // the first client snapshot is the real value -- no mismatch, no flicker.
  const choice = useSyncExternalStore(subscribe, readDomChoice, () => 'system' as Choice);

  const choose = useCallback((next: Choice) => {
    const root = document.documentElement;
    const dark =
      next === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : next === 'dark';
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);

    try {
      if (next === 'system') {
        // Removed rather than stored as "system", so the key's absence is the
        // system state and there is one less thing to keep in sync.
        window.localStorage.removeItem(KEY);
      } else {
        window.localStorage.setItem(KEY, next);
      }
    } catch {
      // As in the inline script: a preference is not worth an exception.
    }
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="inline-flex items-center rounded-lg border p-0.5"
    >
      {ORDER.map((option) => {
        const active = choice === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(option)}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--color-brand-600)] text-white'
                : 'text-[color:var(--text-muted)] hover:text-[color:var(--text)]'
            }`}
          >
            {t(option)}
          </button>
        );
      })}
    </div>
  );
}
