import type { ReactNode } from 'react';

/**
 * A figure, with the sentence that makes it mean something.
 *
 * ── what changed ────────────────────────────────────────────────────────────────
 *
 * The old tile had a corner notch cut out of it and an arrow in the notch. It was
 * handsome and it carried no information: the notch was the same on all four tiles, so
 * it said nothing about which figure mattered.
 *
 * What replaced it is the thing a reader actually needs: the figure, the unit, and
 * one line saying what the figure is *for*. "EGP 62K" alone is a number; "EGP 62K —
 * what the business has tied up at cost" is a fact.
 *
 * A figure that is not available says so. It does not show a zero, because a zero is
 * a claim about the world and "we do not know yet" is not a zero.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  /** One line. Say what the figure is for, not what the figure is. */
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
  className?: string;
}) {
  const toneClass = {
    neutral: 'text-[color:var(--text)]',
    good: 'text-[var(--color-stock-ok)]',
    warn: 'text-[var(--color-stock-warning)]',
    bad: 'text-[var(--color-stock-critical)]',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-[color:var(--text-muted)]">{label}</span>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
      </div>
      {/* Tabular figures, so a column of these lines up. A proportional digit in a
          column of numbers is why dashboards look like they are wobbling. */}
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${toneClass}`}>
        {value}
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-[color:var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
