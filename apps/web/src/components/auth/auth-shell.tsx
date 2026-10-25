import { getTranslations } from 'next-intl/server';

import { Logo } from '@/components/logo';
import { LocaleFooterLink } from '@/components/locale-footer-link';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The shell the three public forms share.
 *
 * ── what it is ────────────────────────────────────────────────────────────────
 *
 * A full-bleed bar, a two-column split, and a footer. The form is on the left
 * and the product is on the right, because the argument on this page is not a
 * paragraph about supply chain -- it is the software, working, next to the
 * two sentences that introduce it.
 *
 * ── why the bar and the footer are here at all ───────────────────────────────
 *
 * Because a sign-in page is a page, and a page that floats a form in the
 * middle of a void is a page with nothing on it. The bar carries the things
 * that are true of the organisation -- the licence it operates under, the hub
 * it runs from -- and the footer carries the things that are true of the
 * software.
 *
 * ── what is NOT on the bar ───────────────────────────────────────────────────
 *
 * A language switcher. The browser's language decides for a first-time
 * visitor, and the account settings decide for everyone else, and the bar has
 * two permanent slots that are worth more than that.
 */
export async function AuthShell({
  eyebrow,
  title,
  pitch,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  pitch: string;
  /** The form. */
  children: React.ReactNode;
  /** The panel on the right. */
  aside: React.ReactNode;
}) {
  const t = await getTranslations('auth');
  const tShell = await getTranslations('auth.shell');

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ── the bar ───────────────────────────────────────────────────────── */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Logo />
          <span aria-hidden="true" className="size-2 rounded-full bg-[var(--primary)]" />
          <span className="pf-mono hidden text-[11px] text-[var(--text-muted)] sm:inline">
            {tShell('licence')}
          </span>
          <span aria-hidden="true" className="pf-mono hidden text-[11px] text-[var(--text-muted)] sm:inline">
            /
          </span>
          <span className="pf-mono hidden text-[11px] text-[var(--text-muted)] sm:inline">
            {tShell('hub')}
          </span>

          <div className="ms-auto flex items-center gap-2">
            <LocaleFooterLink />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── the split ─────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <div className="min-w-0 max-w-xl">
            <p className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
              {eyebrow}
            </p>
            <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-[52ch] text-sm leading-[1.55] text-[var(--text-muted)]">
              {pitch}
            </p>

            <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 sm:p-6">
              {children}
            </div>
          </div>

          <div className="lg:pt-16">{aside}</div>
        </div>
      </main>

      {/* ── the footer ────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
          <p className="pf-mono max-w-[62ch] text-[11px] text-[var(--text-muted)]">
            {tShell('footer')}
          </p>
          <p dir="rtl" className="font-display text-sm font-semibold">
            {t('slogan')}
          </p>
        </div>
      </footer>
    </div>
  );
}
