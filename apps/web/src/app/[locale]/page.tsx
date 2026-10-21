import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { Logo } from '@/components/logo';
import type { Locale } from '@/i18n/routing';

/**
 * The landing page.
 *
 * ── the shape of it ──────────────────────────────────────────────────────────────
 *
 * A split hero, left-aligned, with a live operations panel on the right. The panel is
 * the argument: a distributor and a pharmacy owner do not need a paragraph about
 * supply chain, they need to see the product. So the right half is the product, and
 * the left half is the two sentences around it.
 *
 * Never centred, and never three cards in a row. A centred hero is the shape every
 * template reaches for; a two-column zig-zag and a horizontal rail are not, and the
 * difference is what makes a page look designed rather than filled.
 *
 * ── the data on it ───────────────────────────────────────────────────────────────
 *
 * The batch rows are the real product's own seed data: real Egyptian formulations,
 * real lot-reference shapes, and the real expiry bands. Nothing here is a metric
 * invented to look impressive -- no uptime, no response time, no "trusted by". A
 * landing page for a regulated product that shows invented numbers is a page that
 * teaches a person to discount every number on it.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('landing');
  const tNav = await getTranslations('nav');
  const tCommon = await getTranslations('common');

  // The three rows in the operations panel, and the rail beneath the hero. The same
  // three that the inventory console shows, so the landing page and the product
  // speak with the same voice.
  const telemetry = [
    { lot: 'LOT-2026-A0412', product: 'Panadol Extra 500 mg Tablets', qty: '240', band: 'soon', days: 8 },
    { lot: 'LOT-2025-C0442', product: 'Panadol Extra 500 mg Tablets', qty: '60', band: 'expired', days: null },
    { lot: 'LOT-2026-B1180', product: 'Augmentin 875 mg/125 mg', qty: '80', band: 'ok', days: 240 },
  ] as const;

  const rail = [
    { sku: 'PH-1001', name: 'Panadol Extra 500 mg Tablets', band: 'ok', days: null },
    { sku: 'PH-1002', name: 'Augmentin 875 mg/125 mg Film-Coated Tablets', band: 'ok', days: null },
    { sku: 'PH-1003', name: 'NovoRapid FlexPen 100 IU/mL Solution for Injection', band: 'soon', days: 14 },
    { sku: 'PH-1004', name: 'ORS Sachet', band: 'ok', days: null },
    { sku: 'PH-1005', name: 'Cefriaxone 1 g Powder for Solution', band: 'ok', days: null },
    { sku: 'PH-1006', name: 'Influenza Vaccine 0.5 mL Prefilled Syringe', band: 'ok', days: null },
  ] as const;

  /*
   * A status, as a word.
   *
   * The days are a count, so they are an ICU plural -- Arabic has six of them, and
   * "# أيام" is not the same sentence as "# يومًا". Hard-coding "8 days" here put
   * English on the Arabic page, which is exactly the defect the translation test
   * exists to catch: a key that is missing is loud, a key that is right is
   * invisible, and a string that never went through the message files at all is
   * invisible in both senses.
   */
  const bandLabel = (band: 'ok' | 'soon' | 'expired', days: number | null): string => {
    if (days !== null) return t('status.days', { days });
    return band === 'expired' ? t('status.expired') : t('status.inDate');
  };

  return (
    <main className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── the top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/92 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <Link
            href={`/${locale}`}
            className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            aria-label={tCommon('appName')}
          >
            <Logo />
          </Link>

          <nav aria-label={tNav('primary')} className="hidden items-center gap-1 lg:flex">
            {['capabilities', 'compliance', 'network'].map((item) => (
              <a
                key={item}
                href={`#${item}`}
                className="rounded-md px-3 py-2 font-mono text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                {tNav(item)}
              </a>
            ))}
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-2">
            <Link
              href={`/${locale}/login`}
              className="rounded-md px-3 py-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              {t('signIn')}
            </Link>
            <Link
              href={`/${locale}/signup`}
              className="rounded-[10px] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-[filter,transform] active:translate-y-px"
            >
              {t('createOrg')}
            </Link>
          </div>
        </div>
      </header>

      {/* ── the hero ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1400px] px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="pf-stagger">
            <p
              className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase"
              style={{ ['--pf-i' as string]: 0 }}
            >
              {t('eyebrow')}
            </p>

            <h1
              className="font-display mt-5 max-w-[16ch] text-[2.75rem] leading-[1.09] font-semibold sm:text-[2.75rem]"
              style={{ ['--pf-i' as string]: 1 }}
            >
              {t('headline')}
            </h1>

            <p
              className="mt-6 max-w-[58ch] text-[0.9375rem] leading-[1.55] text-[var(--text-muted)]"
              style={{ ['--pf-i' as string]: 2 }}
            >
              {t('lede')}
            </p>

            <div
              className="mt-8 flex flex-wrap items-center gap-3"
              style={{ ['--pf-i' as string]: 3 }}
            >
              <Link
                href={`/${locale}/signup`}
                className="group inline-flex items-center gap-2 rounded-[10px] bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-[filter,transform] active:translate-y-px"
              >
                {t('createOrg')}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
              <a
                href="#capabilities"
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--sidebar-ring)]"
              >
                {t('talkToSales')}
              </a>
            </div>

            {/* Three facts, in the register of a licence rather than a slogan. */}
            <dl
              className="mt-12 grid max-w-2xl grid-cols-2 gap-6 sm:grid-cols-3"
              style={{ ['--pf-i' as string]: 4 }}
            >
              {(
                [
                  ['eda', 'EDA Licence', '#8491/2023'],
                  ['gdp', 'Audit standard', 'WHO GDP'],
                  ['fefo', 'Dispatch logic', 'FEFO strict'],
                ] as const
              ).map(([key, label, value]) => (
                <div key={key}>
                  <dt className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
                    {label}
                  </dt>
                  <dd
                    className={`mt-1 text-sm ${
                      key === 'fefo' ? 'text-[var(--primary)]' : 'text-[var(--text)]'
                    }`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* The panel is the argument. */}
          <div
            className="pf-reveal rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            style={{ animationDelay: '120ms' }}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="pf-mono flex items-center gap-2 text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
                <span aria-hidden="true" className="pf-live-dot size-2 rounded-full bg-[var(--primary)]" />
                {t('liveTelemetry')}
              </h2>
              <span className="pf-mono text-[11px] text-[var(--text-muted)]">
                {t('hubLabel')}
              </span>
            </div>

            <table className="mt-4 w-full text-[13px]">
              <caption className="sr-only">{t('liveTelemetry')}</caption>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="pf-mono px-2 py-2 text-start text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('colLot')}
                  </th>
                  <th scope="col" className="pf-mono px-2 py-2 text-start text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('colProduct')}
                  </th>
                  <th scope="col" className="pf-mono px-2 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('colUnits')}
                  </th>
                  <th scope="col" className="pf-mono px-2 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {t('colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {telemetry.map((row) => (
                  <tr key={row.lot} className="border-b border-[var(--border)] last:border-0">
                    <td className="pf-mono px-2 py-3 whitespace-nowrap text-[var(--primary)]">
                      {row.lot}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-3">{row.product}</td>
                    <td className="pf-mono px-2 py-3 text-end tabular-nums">{row.qty}</td>
                    <td className="px-2 py-3 text-end">
                      <StatusBand band={row.band}>{bandLabel(row.band, row.days)}</StatusBand>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="pf-mono mt-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
              {t('telemetryFoot')}
            </p>
          </div>
        </div>
      </section>

      {/* ── the two audiences ──────────────────────────────────────────────── */}
      <section id="capabilities" className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="pf-reveal rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
            >
              <svg viewBox="0 0 24 24" className="size-4 text-[var(--primary)]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9.5 12 4l9 5.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
                <path d="M9 21v-7h6v7" />
              </svg>
            </span>
            <h2 className="font-display mt-5 text-2xl font-semibold">{t('adminRole')}</h2>
            <p className="mt-3 text-sm leading-[1.55] text-[var(--text-muted)]">
              {t('adminRoleBody')}
            </p>
            <a
              href="#capabilities"
              className="mt-4 inline-block text-sm font-medium text-[var(--primary)] hover:underline"
            >
              {t('seeExpiry')} &rarr;
            </a>
          </article>

          <article
            className="pf-reveal rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
            style={{ animationDelay: '80ms' }}
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
            >
              <svg viewBox="0 0 24 24" className="size-4 text-[var(--primary)]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7h18l-1.5 12.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5L3 7Z" />
                <path d="M8 7V5a4 4 0 0 1 8 0v2" />
              </svg>
            </span>
            <h2 className="font-display mt-5 text-2xl font-semibold">{t('pharmacyRole')}</h2>
            <p className="mt-3 text-sm leading-[1.55] text-[var(--text-muted)]">
              {t('pharmacyRoleBody')}
            </p>
            <a
              href="#capabilities"
              className="mt-4 inline-block text-sm font-medium text-[var(--primary)] hover:underline"
            >
              {t('seeOrdering')} &rarr;
            </a>
          </article>
        </div>
      </section>

      {/* ── the capability band ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <h2 className="font-display text-2xl font-semibold">{t('capabilitiesHeading')}</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t('capabilitiesLede')}</p>

        <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {(
            [
              ['traceability', t('traceability'), t('traceabilityBody')],
              ['coldChain', t('coldChain'), t('coldChainBody')],
              ['fefo', t('fefo'), t('fefoBody')],
              ['delivery', t('delivery'), t('deliveryBody')],
            ] as const
          ).map(([key, heading, body], i) => (
            <div
              key={key}
              className="border-t border-[var(--border)] pt-5"
              style={{ ['--pf-i' as string]: i }}
            >
              <p className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
                {t(`capability.${key}.eyebrow`)}
              </p>
              <h3 className="font-display mt-2 text-lg font-medium">{heading}</h3>
              <p className="mt-2 text-sm leading-[1.55] text-[var(--text-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── the live rail ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            {t('railHeading')}
          </h2>
          <span aria-hidden="true" className="pf-mono text-[11px] text-[var(--text-muted)]">
            {t('railHint')} &rarr;
          </span>
        </div>

        {/*
          The rail.

          Two things it has to get right, and both were wrong the first time.

          The cards are the same height, and the lot line sits at the bottom of every
          one of them. Without that, a card holding "Augmentin 875 mg/125 mg Film-Coated
          Tablets" is twice the height of one holding "ORS Sachet", and the row reads
          as a ragged edge rather than a shelf.

          And the fifth card peeks. A rail whose last card ends exactly at the edge of
          the screen is a rail that reads as a list, not as something that scrolls --
          which is the difference between a person swiping and a person giving up.
          The cards are narrow enough that the fifth always has an edge showing.
        */}
        <ul className="pf-rail mt-4 flex items-stretch gap-3 pb-2">
          {rail.map((item) => (
            <li
              key={item.sku}
              className="flex w-[15.5rem] shrink-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="pf-mono text-xs text-[var(--primary)]">{item.sku}</span>
                <StatusBand band={item.band}>{bandLabel(item.band, item.days)}</StatusBand>
              </div>
              {/* Two lines, always. A product name is one to three lines long, and the
                  third line is what makes the row ragged. */}
              <p className="font-display mt-3 line-clamp-2 text-[0.9375rem] leading-snug font-medium">
                {item.name}
              </p>
              <p className="pf-mono mt-auto border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
                {t('railFoot')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── the footer, and the slogan ─────────────────────────────────────── */}
      <footer className="mt-10 border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
            <div>
              <Logo />
              {/*
                The slogan, at the only size it works. "لو شغل متتزاكاش" is a
                line the team says to itself, and printing it small and grey in a
                footer column would waste it. It is set large, in the display face,
                because it is the one piece of the brand that is actually a voice.
              */}
              <p
                dir="rtl"
                className="font-display mt-4 text-2xl leading-tight font-semibold text-[var(--text)]"
              >
                {t('slogan')}
              </p>
              <p className="mt-3 max-w-[34ch] text-sm text-[var(--text-muted)]">
                {t('footerLede')}
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-3">
              {(
                [
                  ['distribution', t('footerDistribution')],
                  ['regulatory', t('footerRegulatory')],
                  ['infrastructure', t('footerInfrastructure')],
                ] as const
              ).map(([key, heading]) => (
                <div key={key}>
                  <h3 className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
                    {heading}
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                    {(
                      (t.raw(`footer.${key}.items`) as unknown as string).split('|')
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-6">
            <p className="pf-mono text-[11px] text-[var(--text-muted)]">
              &copy; 2026 BERSHAMA PHARMACEUTICAL LOGISTICS S.A.E. &middot; CAIRO, EGYPT
            </p>
            <p className="pf-mono text-[11px] text-[var(--text-muted)]">
              {t('footerLicence')}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

/**
 * A status, as a shape and a word.
 *
 * The colour comes from the shared tokens, and the shape is what carries the meaning
 * when colour cannot: a triangle is critical, a circle is a warning, a diamond is
 * settled. It survives a greyscale printout, a colour-blind operator and a sunlit
 * phone screen.
 */
function StatusBand({ band, children }: { band: 'ok' | 'soon' | 'expired'; children: React.ReactNode }) {
  const tone = {
    ok: 'text-[var(--color-stock-ok)] border-[var(--color-stock-ok)]/40',
    soon: 'text-[var(--color-stock-warning)] border-[var(--color-stock-warning)]/40',
    expired: 'text-[var(--color-stock-critical)] border-[var(--color-stock-critical)]/40',
  }[band];

  const glyph = { ok: '◆', soon: '●', expired: '▲' }[band];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none ${tone}`}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}
