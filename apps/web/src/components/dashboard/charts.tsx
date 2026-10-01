'use client';

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
 */
export function BarTrendChart({
  points,
  highlightIndex,
  format,
  ariaLabel,
  onSelect,
}: {
  points: BarPoint[];
  /** Which bar carries the big value pill, or -1 for none. */
  highlightIndex?: number;
  format: (value: number) => string;
  ariaLabel: string;
  onSelect?: (index: number) => void;
}) {
  if (points.length === 0) return null;

  const W = 560;
  const H = 220;
  const PAD_BOTTOM = 26;
  const PAD_TOP = 34;
  const plotH = H - PAD_BOTTOM - PAD_TOP;
  const slot = W / points.length;
  const barW = Math.max(6, Math.min(28, slot * 0.42));

  // From zero, never from the minimum -- see the note above.
  const max = Math.max(...points.map((p) => p.value), 1);

  // Optional prop, so it is resolved once here rather than defaulted at every use
  // site -- indexing with `undefined` is a runtime error, not a compile error, which
  // is the worst kind to leave in a chart.
  const highlight = highlightIndex ?? -1;

  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${PAD_TOP + plotH} L ${x(0)} ${PAD_TOP + plotH} Z`;

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

      <path d={area} fill="currentColor" fillOpacity="0.10" />

      {points.map((point, i) => {
        const barX = x(i) - barW / 2;
        const barY = y(point.value);
        const h = PAD_TOP + plotH - barY;
        const isHighlight = i === highlight;
        return (
          <g key={point.label}>
            {isHighlight && (
              <line
                x1={x(i)}
                y1={barY}
                x2={x(i)}
                y2={PAD_TOP + plotH}
                stroke="currentColor"
                strokeOpacity="0.45"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
            <rect
              x={barX}
              y={barY}
              width={barW}
              height={Math.max(1, h)}
              rx={3}
              fill="currentColor"
              fillOpacity={isHighlight ? 0.95 : 0.55}
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={onSelect ? () => onSelect(i) : undefined}
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

      {/* The dotted trend, over the bars, so it reads as a second layer rather than
          as part of the series. */}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeOpacity={0.5}
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      {points.map((point, i) => (
        <circle key={`dot-${point.label}`} cx={x(i)} cy={y(point.value)} r={3} fill="currentColor" fillOpacity={0.8} />
      ))}

      {highlight >= 0 && points[highlight] && (
        <text
          x={x(highlight)}
          y={y(points[highlight].value) - 10}
          textAnchor="middle"
          fontSize="12"
          fontWeight={600}
          fill="currentColor"
        >
          {points[highlight].display ?? format(points[highlight].value)}
        </text>
      )}
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
    <ul aria-label={ariaLabel} data-testid="ranked-bars" className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.id} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 tabular text-[color:var(--text-muted)]">{row.display}</span>
          </div>
          {row.sub && <p className="truncate text-xs text-[color:var(--text-muted)]">{row.sub}</p>}
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-current/10">
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
    <div className="flex flex-col items-center gap-1.5 text-center">
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