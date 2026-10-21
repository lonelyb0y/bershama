'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { updateProfile } from '@/app/[locale]/settings/actions';

/**
 * The profile form.
 *
 * ── why it is a client component that calls a server action ──────────────────
 *
 * The profile lives in the database behind RLS, and the write has to go
 * through `api.update_my_profile`, which is the only thing permitted to write
 * it. A client component calling a server action gets both: the action runs on
 * the server, with the session cookie and the API client, and the component
 * never sees a database credential.
 *
 * ── why the form is uncontrolled ─────────────────────────────────────────────
 *
 * A controlled form here would re-render the whole page on every keystroke,
 * and this page is the one place a person is most likely to be typing slowly
 * -- their own name, in two scripts, on a phone. The fields keep their own
 * state and the action reads them at submit.
 */
export function ProfileForm({
  fullName,
  fullNameAr,
  phone,
}: {
  fullName: string;
  fullNameAr: string;
  phone: string;
}) {
  const t = useTranslations('settings.profile');
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const submit = (formData: FormData) => {
    startTransition(async () => {
      await updateProfile(formData);
      setSaved(true);
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="pf-field">
          <input
            id="settings-full-name"
            name="fullName"
            defaultValue={fullName}
            placeholder=" "
            autoComplete="name"
            className="w-full rounded-2xl border border-[var(--border-control)] bg-transparent px-3 text-sm"
          />
          <label htmlFor="settings-full-name" className="pf-field__label">
            {t('fullName')}
          </label>
        </div>

        <div className="pf-field">
          <input
            id="settings-full-name-ar"
            name="fullNameAr"
            defaultValue={fullNameAr}
            dir="rtl"
            placeholder=" "
            className="w-full rounded-2xl border border-[var(--border-control)] bg-transparent px-3 text-sm"
          />
          <label htmlFor="settings-full-name-ar" className="pf-field__label">
            {t('fullNameAr')}
          </label>
        </div>
      </div>

      <div className="pf-field">
        <input
          id="settings-phone"
          name="phone"
          defaultValue={phone}
          type="tel"
          dir="ltr"
          placeholder=" "
          autoComplete="tel"
          className="w-full rounded-2xl border border-[var(--border-control)] bg-transparent px-3 text-sm"
        />
        <label htmlFor="settings-phone" className="pf-field__label">
          {t('phone')}
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-[filter,transform] active:translate-y-px disabled:opacity-60"
        >
          {pending ? t('saving') : t('save')}
        </button>
        {saved && !pending ? (
          <span role="status" className="text-sm text-[var(--color-stock-ok)]">
            {t('saved')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
