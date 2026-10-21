import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/ui/page-header';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguagePicker } from '@/components/settings/language-picker';
import { NotificationsForm } from '@/components/settings/notifications-form';
import { ProfileForm } from '@/components/settings/profile-form';
import { SignOutEverywhere } from '@/components/settings/sign-out-everywhere';
import { getSession } from '@/lib/session';
import { isLocale, type Locale } from '@/i18n/routing';

/**
 * The account settings.
 *
 * ── why the language is here and not in the header ───────────────────────────
 *
 * A language switcher in the header is a control for something most people set
 * once and never touch again. It also costs a permanent slot in the busiest
 * part of every screen, and it puts the most fragile part of the layout -- two
 * words in two scripts -- exactly where it is most likely to wrap.
 *
 * So the header does not carry it. The browser decides for a first-time
 * visitor; this page decides for everyone else, and the choice is written to
 * a cookie AND to the profile, so it survives a reload here and a new device
 * there.
 *
 * ── why these are the sections ───────────────────────────────────────────────
 *
 * Each one is something the product can actually honour:
 *
 *   Language      a cookie and a profile column, both of which exist.
 *   Appearance    the theme, which is a real preference with a real effect.
 *   Profile       the name in both scripts, and the phone number. The header
 *                 shows the Arabic name on the Arabic page, so a member of
 *                 staff with only one of them recorded was shown a blank.
 *   Notifications three preferences, per person, read by the alert centre.
 *   Security      the sessions, which are the only thing here that can lock
 *                 a person out of their own account.
 *
 * Nothing on this page is a placeholder that pretends to be a setting.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;

  if (!isLocale(rawLocale)) {
    return null;
  }
  const locale: Locale = rawLocale;
  setRequestLocale(locale);

  const t = await getTranslations('settings');
  const session = await getSession();

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />

      {/* ── language ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <h2 className="pf-display text-lg font-semibold">{t('language.title')}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t('language.body')}</p>
        <div className="mt-4">
          <LanguagePicker />
        </div>
      </section>

      {/* ── appearance ───────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <h2 className="pf-display text-lg font-semibold">{t('appearance.title')}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t('appearance.body')}</p>
        <div className="mt-4 flex items-center gap-3">
          <ThemeToggle />
          <span className="text-sm text-[var(--text-muted)]">{t('appearance.hint')}</span>
        </div>
      </section>

      {/* ── profile ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <h2 className="pf-display text-lg font-semibold">{t('profile.title')}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t('profile.body')}</p>
        <div className="mt-4">
          <ProfileForm
            fullName={session.fullName}
            fullNameAr={session.fullNameAr ?? ''}
            phone={session.phone ?? ''}
          />
        </div>
      </section>

      {/* ── notifications ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <h2 className="pf-display text-lg font-semibold">{t('notifications.title')}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t('notifications.body')}</p>
        <div className="mt-4">
          <NotificationsForm initial={session.notifications} />
        </div>
      </section>

      {/* ── security ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <h2 className="pf-display text-lg font-semibold">{t('security.title')}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t('security.body')}</p>
        <div className="mt-4">
          <SignOutEverywhere />
        </div>
      </section>
    </div>
  );
}
