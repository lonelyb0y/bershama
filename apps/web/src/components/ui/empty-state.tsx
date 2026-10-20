import type { ReactNode } from 'react';

/**
 * What a screen shows when there is nothing in it.
 *
 * An empty state is the one piece of copy on the screen that is written for a person
 * rather than for the database, so it earns its keep: what is empty, why, and the one
 * thing to do about it. "No data" tells a pharmacist nothing; "No batches yet — stock
 * arrives through a receipt" tells them what to do.
 */
export function EmptyState({
  title,
  body,
  action,
  compact = false,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  /** A smaller version, for a table that is empty inside a populated screen. */
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed text-center ${
        compact ? 'gap-2 p-6' : 'gap-3 p-10'
      }`}
    >
      <p className={`font-medium ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {body ? (
        <p className="max-w-sm text-sm text-[color:var(--text-muted)]">{body}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
