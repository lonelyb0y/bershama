/**
 * The chart primitives, hand-drawn in SVG.
 *
 * ── why not a charting library ───────────────────────────────────────────────
 * Every chart on this dashboard is bars, a line, and a number. That is roughly two
 * hundred lines of SVG, and a library would add a few hundred kilobytes to a page
 * that is already the second-slowest in the application for a grid of bars. It would
 * also own the design: the reference this is built to has a specific look — value
 * labels above points, a dotted trend line over solid bars — and a library would be
 * fought to produce it.
 *
 * ── the one rule that matters for correctness ────────────────────────────────
 * Bars are scaled from zero, always. A chart that scales from its minimum flattens a
 * fall into nothing, which is the one thing a stock chart must never do: the reader
 * is looking at it to see the drop.
 */

export interface BarPoint {
  label: string;
  value: number;
  /** Printed above the bar. Formatted by the caller, because money and counts do
   *  not share a format. */
  display?: string;
}

/**
 * A bar series with an overlaid trend line and a highlighted value.
 *
 * The line is the trend; the bars are the detail. In the reference the line is
 * dotted and the bars solid, which is worth keeping: two encodings, two weights, and
 * the eye can follow either without them fighting.
 *
 * ### One quantity per axis
 *
 * An earlier version drew a "cost per unit" line on top of these bars. The bars count
 * units, the line is in money, and putting both on one scale needed a fudge factor to
 * make the line visible -- which flattened every bar to a 1px sliver. A chart cannot
 * carry a second quantity on a scale it does not share, so it carries one. Cost and
 * margin are told by the two headline figures and the ranking beside this, both of
 * which are in the same unit.
 *
 * A **server** component, deliberately. It draws SVG and holds no state, so it has
 * no business being a client component -- and as a client component it could not
 * accept a formatter function, because functions do not cross the server/client
 * boundary. Every point therefore carries a pre-printed `display` string, formatted
 * on the server where the locale and currency are actually known.
 */
export function BarTrendChart({
  points,
  ariaLabel,
}: {
  points: BarPoint[];
  ariaLabel: string;
}) {
  if (points.length === 0) return null;

  const W = 560;
  const H = 240;
  const PAD_BOTTOM = 26;
  const PAD_TOP = 34;
  const plotH = H - PAD_BOTTOM - PAD_TOP;
  const slot = W / points.length;
  const barW = Math.max(6, Math.min(28, slot * 0.42));

  // From zero, never from the minimum -- see the note above.
  const max = Math.max(...points.map((p) => p.value), 1);

  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;


  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      data-testid="bar-trend-chart"
      className="w-full"
      preserveAspectRatio="none"
    >
      {/* Baseline only. Gridlines behind dense bars are noise -- the eye reads the
          bars against the axis, not against a lattice. */}
      <line
        x1={0}
        y1={PAD_TOP + plotH}
        x2={W}
        y2={PAD_TOP + plotH}
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth={1}
      />

      {points.map((point, i) => {
        const barX = x(i) - barW / 2;
        const barY = y(point.value);
        const h = PAD_TOP + plotH - barY;
        return (
          <g key={point.label}>
            <rect
              x={barX}
              y={barY}
              width={barW}
              height={Math.max(1, h)}
              rx={3}
              fill="currentColor"
              fillOpacity={0.9}
            />
            <text
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.6"
            >
              {point.label}
            </text>
          </g>
        );
      })}

    </svg>
  );
}

/**
 * A compact horizontal bar, for a ranked list.
 *
 * Ranked lists are easier to scan than a pie or a stacked bar for four-to-eight
 * items, and they cost nothing to draw.
 */
export function RankedBars({
  rows,
  ariaLabel,
}: {
  rows: Array<{ id: string; label: string; sub?: string; value: number; display: string }>;
  ariaLabel: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul aria-label={ariaLabel} data-testid="ranked-bars" className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 tabular text-[color:var(--text-muted)]">{row.display}</span>
          </div>
          {row.sub && <p className="truncate text-xs text-[color:var(--text-muted)]">{row.sub}</p>}
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-current/10">
            <div
              className="h-full rounded-full bg-[color:var(--color-brand-600)] transition-[width] duration-500"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A proportional ring, for the handful of "share of X" figures.
 *
 * Drawn with stroke-dasharray on a circle rather than with a conic-gradient: it
 * animates with a CSS transition on stroke-dashoffset, and it inherits currentColor
 * so it follows the theme without a second set of tokens.
 */
export function ProportionRing({
  value,
  total,
  label,
  display,
}: {
  value: number;
  total: number;
  label: string;
  display: string;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const fraction = total > 0 ? Math.min(1, value / total) : 0;

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" role="img" aria-label={`${label}: ${display}`}>
        <circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
          className="text-[color:var(--color-brand-600)] transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="text-sm font-semibold tabular">{display}</span>
      <span className="text-xs text-[color:var(--text-muted)]">{label}</span>
    </div>
  );
}

/**
 * A chart, and the numbers behind it.
 *
 * ── why a chart needs a table beside it ─────────────────────────────────────────
 *
 * A bar chart is a picture of a table. On a screen it is faster, and it is the
 * right thing to look at. But it is a picture: a person cannot copy a value out
 * of it, cannot sort it, and cannot hand it to an auditor.
 *
 * So every chart here has a table twin. Not instead of the chart -- the chart is
 * what you read -- but under it, one click away, with the numbers in cells.
 *
 * This matters most in the case this was built for: a QA inspector asking what
 * the expiry exposure is, on a printed report, on a connection that cannot load
 * an interactive chart. The data has to be there, as data.
 */
export function RankedBarsWithTable({
  rows,
  ariaLabel,
  tableLabel,
  showLabel,
}: {
  rows: Array<{ id: string; label: string; sub?: string; value: number; display: string }>;
  ariaLabel: string;
  tableLabel: string;
  /** The text on the disclosure. */
  showLabel: string;
}) {
  return (
    <>
      <RankedBars rows={rows} ariaLabel={ariaLabel} />
      {rows.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]">
            {showLabel}
          </summary>
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">{tableLabel}</caption>
              <thead>
                <tr className="border-b bg-[color:var(--surface-2)]/60">
                  <th scope="col" className="px-3 py-2 text-start font-medium text-[color:var(--text-muted)]">
                    {ariaLabel}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium text-[color:var(--text-muted)]">
                    {tableLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span className="block font-medium">{row.label}</span>
                      {row.sub ? (
                        <span className="block text-xs text-[color:var(--text-muted)]">
                          {row.sub}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{row.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}
