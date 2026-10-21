import { getTranslations } from 'next-intl/server';

import { IconDiamond } from '@/components/icons/regen';

/**
 * The live operations panel.
 *
 * ── what it is ────────────────────────────────────────────────────────────────
 *
 * The argument on the sign-in and sign-up pages. A distributor or a pharmacy
 * owner does not need a paragraph about supply chain -- they need to see the
 * product. So the right half of the page IS the product, and the left half is
 * the two sentences around it.
 *
 * ── the data is the product's own ─────────────────────────────────────────────
 *
 * The same three batches the landing page shows, with the same lot references
 * and the same quantities. They are the seed values, and they are the same
 * values, so a person who looks at the landing page and then signs in sees one
 * product rather than two.
 *
 * ── the three states, and what they say ──────────────────────────────────────
 *
 * The panel shows one expired batch, one inside its expiry window, and one in
 * date -- and the in-date one is NEUTRAL, not green. The panel's whole point is
 * that the eye goes to the amber and the red. A wall of green would say
 * "everything is fine" in a louder voice than the two rows that are not.
 */
export async function TelemetryPanel() {
  const t = await getTranslations('auth.telemetry');

  const rows = [
    { lot: 'LOT-2026-A0412', product: 'Panadol Extra 500 mg Tablets', units: '240', band: 'soon' as const, days: 8 },
    { lot: 'LOT-2025-C0442', product: 'Panadol Extra 500 mg Tablets', units: '60', band: 'expired' as const, days: null },
    { lot: 'LOT-2026-B1180', product: 'Augmentin 875 mg/125 mg', units: '80', band: 'ok' as const, days: 240 },
  ];

  return (
    <aside
      aria-label={t('title')}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="pf-live-dot size-2 rounded-full bg-[var(--primary)]" />
          {t('title')}
        </h2>
        <span className="pf-mono text-[11px] text-[var(--text-muted)]">
          {t('hub')}: CAI-01
        </span>
      </div>

      <table className="mt-4 w-full text-[13px]">
        <caption className="sr-only">{t('title')}</caption>
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="pf-mono px-2 py-2 text-start text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
              {t('lot')}
            </th>
            <th scope="col" className="pf-mono px-2 py-2 text-start text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
              {t('product')}
            </th>
            <th scope="col" className="pf-mono px-2 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
              {t('units')}
            </th>
            <th scope="col" className="pf-mono px-2 py-2 text-end text-[11px] tracking-[0.06em] text-[var(--text-muted)] uppercase">
              {t('status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lot} className="border-b border-[var(--border)] last:border-0">
              <td className="pf-mono px-2 py-2 whitespace-nowrap text-[var(--primary)]">
                {row.lot}
              </td>
              <td className="max-w-[11rem] truncate px-2 py-2">{row.product}</td>
              <td className="pf-mono px-2 py-2 text-end tabular-nums">{row.units}</td>
              <td className="px-2 py-2 text-end">
                <StatusBand band={row.band}>
                  {row.band === 'expired'
                    ? t('expired')
                    : row.band === 'soon'
                      ? t('days', { days: row.days ?? 0 })
                      : t('days', { days: row.days ?? 0 })}
                </StatusBand>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="pf-mono mt-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
        {t('foot')}
      </p>
    </aside>
  );
}

/**
 * A status, as a shape and a word.
 *
 * The colour comes from the shared tokens, and the shape is what carries the
 * meaning when colour cannot: a triangle is critical, a circle is a warning, a
 * diamond is settled.
 */
function StatusBand({
  band,
  children,
}: {
  band: 'ok' | 'soon' | 'expired';
  children: React.ReactNode;
}) {
  const tone = {
    ok: 'text-[var(--color-stock-ok)] border-[var(--color-stock-ok)]/40',
    soon: 'text-[var(--color-stock-warning)] border-[var(--color-stock-warning)]/40',
    expired: 'text-[var(--color-stock-critical)] border-[var(--color-stock-critical)]/40',
  }[band];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap ${tone}`}
    >
      <IconDiamond className="size-2" aria-hidden="true" />
      {children}
    </span>
  );
}
