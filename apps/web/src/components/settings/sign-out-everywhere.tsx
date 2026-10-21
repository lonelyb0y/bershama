'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { signOutEverywhere } from '@/app/[locale]/settings/actions';

/**
 * Sign out everywhere else.
 *
 * Its own component because it is a destructive action and it wants its own
 * confirmation -- typed, not a dialog. A session on another device is not
 * something a two-click dialog is enough to destroy.
 */
export function SignOutEverywhere() {
  const t = useTranslations('settings.security');
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--text-muted)]/10"
      >
        {t('signOutEverywhere')}
      </button>
    );
  }

  const armed = typed.trim().toUpperCase() === t('confirmWord');

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">{t('signOutEverywhereBody')}</p>
      <div className="pf-field max-w-sm">
        <input
          id="settings-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          dir="ltr"
          placeholder=" "
          aria-label={t('confirmLabel')}
          className="w-full rounded-2xl border bg-transparent px-3 text-sm"
        />
        <label htmlFor="settings-confirm" className="pf-field__label">
          {t('confirmLabel')}
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!armed || pending}
          onClick={() => startTransition(async () => void (await signOutEverywhere()))}
          className="rounded-xl border border-[var(--color-stock-critical)]/50 px-4 py-2 text-sm font-medium text-[var(--color-stock-critical)] transition-colors hover:bg-[color:var(--color-stock-critical)]/10 disabled:opacity-50"
        >
          {pending ? t('signingOut') : t('signOutEverywhere')}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setTyped('');
          }}
          className="rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
