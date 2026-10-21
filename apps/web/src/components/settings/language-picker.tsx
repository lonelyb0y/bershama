'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';

import { setLocalePreference } from '@/app/[locale]/settings/actions';

/**
 * The language picker.
 *
 * ── what it does ────────────────────────────────────────────────────────────
 *
 * Two buttons, the same two words as the old header switcher: English and
 * العربية. What changed is where it lives and how much of the screen it takes.
 *
 * ── why the choice is a server action ───────────────────────────────────────
 *
 * The cookie has to be written by the server, because next-intl's middleware
 * reads it on the way IN, before any client code runs. A cookie written from
 * the browser would only take effect on the next request -- so the page would
 * change language and then change back on reload, which is worse than not
 * having the control at all.
 *
 * So: the action writes the cookie and revalidates, and the router then
 * refreshes the tree so the new locale is rendered.
 */
export function LanguagePicker() {
  const t = useTranslations('settings.language');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(locale);

  const choose = (next: 'en' | 'ar') => {
    if (next === current) return;
    setCurrent(next);
    startTransition(async () => {
      await setLocalePreference(next);
      // The layout carries <html lang dir>, and a client navigation does not
      // re-render it -- so the text changes but the direction does not. The
      // refresh is what fixes the direction.
      router.refresh();
    });
  };

  return (
    <div
      dir="ltr"
      role="group"
      aria-label={t('label')}
      className="flex shrink-0 gap-1 rounded-2xl border p-1"
    >
      {(
        [
          ['en', 'English'],
          ['ar', 'العربية'],
        ] as const
      ).map(([code, name]) => {
        const active = code === current;
        return (
          <button
            key={code}
            type="button"
            onClick={() => choose(code)}
            aria-current={active ? 'true' : undefined}
            disabled={pending}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              active
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--text-muted)] hover:bg-[color:var(--text-muted)]/10 hover:text-[var(--text)]'
            }`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
