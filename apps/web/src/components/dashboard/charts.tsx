'use client';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { Ring } from '@/components/charts/ring';
import { RingChart } from '@/components/charts/ring-chart';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';

/**
 * The dashboard's charts.
 *
 * ── why these are client components now ──────────────────────────────────────
 *
 * They used to be server components drawing SVG by hand. They are not any more,
 * because the charts are Bklit's now, and Bklit's charts animate -- they grow
 * their bars, they settle their axes, they follow the pointer.
 *
 * That means JavaScript, and it means these are client components. Which is
 * also why every point still carries a PRE-PRINTED `display` string: a
 * formatter function cannot cross the server/client boundary, so the value is
 * formatted on the server, where the locale and the currency are actually
 * known.
 *
 * ── what did not change ──────────────────────────────────────────────────────
 *
 * The exported names, the props, and the table twins. Every page that draws a
 * chart draws the same one, and the rule that a chart is never the only copy of
 * the data has not moved.
 */

export interface BarPoint {
  label: string;
  value: number;
  /** Printed above the bar. Formatted by the caller, because money and counts do
   *  not share a format. */
  display?: string;
}

/**
 * A bar chart of one quantity over time.
 *
 * ### One quantity per axis
 *
 * An earlier version drew a "cost per unit" line on top of these bars. The bars count
 * units, the line is in money, and putting both on one scale needed a fudge factor to
 * make the line visible -- which flattened every bar to a 1px sliver. A chart cannot
 * carry a second quantity on a scale it does not share, so it carries one. Cost and
 * margin are told by the two headline figures and the ranking beside this, both of
 * which are in the same unit.
 */
export function BarTrendChart({
  points,
  ariaLabel,
}: {
  points: BarPoint[];
  ariaLabel: string;
}) {
  if (points.length === 0) return null;

  return (
    <figure aria-label={ariaLabel} data-testid="bar-trend-chart" className="m-0">
      <BarChart
        data={points as unknown as Record<string, unknown>[]}
        xDataKey="label"
        margin={{ top: 12, right: 8, bottom: 8, left: 8 }}
        aspectRatio="2 / 1"
      >
        <Bar
          dataKey="value"
          animationType="grow"
          fill="var(--chart-line-primary)"
        />
        <ChartTooltip
          showCrosshair={false}
          content={({ point }) => (
            <div className="text-xs">
              <span className="block font-medium">{String(point.label ?? '')}</span>
              <span className="block tabular-nums text-[var(--chart-foreground-muted)]">
                {String(point.display ?? point.value ?? '')}
              </span>
            </div>
          )}
        />
      </BarChart>

      {/*
        The category labels, in a grid with one cell per point.

        A grid rather than a flex row with `justify-between`, because the bars sit
        in an equal-width band and a label centred in the same band lines up with
        its bar. `justify-between` puts the first label on the left edge and the
        last on the right, which is half a band out on both sides.
      */}
      <div
        className="mt-2 grid gap-1 text-center text-[11px] text-[var(--text-muted)]"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((point) => (
          <span key={point.label} className="truncate">
            {point.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Ranked bars.
 *
 * ── why this one is still a list and not a chart ──────────────────────────────
 *
 * A chart puts the number on the pointer. A list puts the number on the row,
 * always, without a hover and without JavaScript.
 *
 * For a person comparing four to eight batches -- which is the whole question
 * this list answers -- the number being permanently visible is the feature. A
 * chart here would be prettier and less usable, and the table twin underneath it
 * would be the thing anybody actually reads.
 *
 * So the bars are still bars, in still CSS, and the list is still a list.
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
 * Bklit's ring, animated: the arc sweeps to its value on the first paint, which
 * is the one animation on this page that says something rather than decorating.
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
  const fraction = total > 0 ? Math.min(1, value / total) : 0;

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div role="img" aria-label={`${label}: ${display}`} className="size-16">
        <RingChart
          data={[{ label, value: fraction * 100, maxValue: 100 }]}
          size={64}
          strokeWidth={6}
          baseInnerRadius={0}
          animationDuration={900}
        >
          <Ring index={0} color="var(--chart-line-primary)" />
        </RingChart>
      </div>
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
