'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { updateNotifications } from '@/app/[locale]/settings/actions';
import type { NotificationPreferences } from '@/lib/types';

/**
 * The notification preferences.
 *
 * ── why they are per person ─────────────────────────────────────────────────
 *
 * Two people on the same shift want different things told to them. One wants
 * to hear about every batch crossing its expiry window; the other only wants
 * to hear about the ones about to be written off. A tenant-wide switch would
 * force one of them to live with the other's answer, and the switch people
 * turn off is the switch everybody turns off.
 *
 * ── why they save on change rather than on a button ─────────────────────────
 *
 * There is no "apply" button, because there is nothing to apply. Each switch
 * is one preference, and a preference you have expressed is a preference you
 * have expressed. A form with a save button for a single checkbox trains
 * people to batch their decisions, and then to leave the box where it was.
 */
export function NotificationsForm({
  initial,
}: {
  initial: NotificationPreferences;
}) {
  const t = useTranslations('settings.notifications');
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const toggle = (key: keyof NotificationPreferences) => {
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setSavedKey(key);
    startTransition(async () => {
      await updateNotifications({ [key]: next[key] });
    });
  };

  const rows: Array<[keyof NotificationPreferences, string, string]> = [
    ['expiry', t('expiry'), t('expiryBody')],
    ['deliveries', t('deliveries'), t('deliveriesBody')],
    ['requisitions', t('requisitions'), t('requisitionsBody')],
  ];

  return (
    <ul className="space-y-4">
      {rows.map(([key, label, body]) => (
        <li key={key} className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{body}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={values[key]}
            aria-label={label}
            disabled={pending}
            onClick={() => toggle(key)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${
              values[key]
                ? 'border-[var(--primary)] bg-[var(--primary)]'
                : 'border-[var(--border)] bg-[var(--surface-2)]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 size-4 rounded-full bg-[var(--primary-foreground)] transition-[inset-inline-start] ${
                values[key] ? 'start-[1.375rem]' : 'start-0.5'
              }`}
            />
          </button>
        </li>
      ))}
      <li aria-live="polite" className="sr-only">
        {savedKey ? t('saved') : ''}
      </li>
    </ul>
  );
}
