// The form-level failure surface, and the paged table.
//
// Two components, because every M2 screen needs the same two things and they
// have the same failure modes every time.

'use client';

import type { ReactNode } from 'react';

import { Button } from './form';

/* ── error banner ───────────────────────────────────────────────────────── */

/**
 * A failure the user is shown.
 *
 * Named and exported because three places need to agree on it: the banner, the
 * server action's return value, and the component holding the state. Restating
 * the shape in each is how the field ends up optional in one of them.
 */
export interface ActionError {
  message: string;
  code: string;
  isFallback: boolean;
}

/**
 * Render a failed ApiResult.
 *
 * Takes the `error` object rather than a string, so the database's code stays
 * available as a `data-code` attribute. That is not for display: when a
 * warehouse manager reports "it said insufficient stock" and the sentence is
 * translated, the code is the only thing that identifies which error the
 * database actually raised.
 *
 * It is a form-level message rather than a field-level one because the same
 * failure arrives attached to different fields depending on which form posted
 * it. `insufficient_stock` on a receive form is about the batch, not the field
 * the cursor is in.
 */
export function ErrorBanner({
  error,
  onRetry,
}: {
  error: ActionError | null;
  onRetry?: () => void;
}) {
  if (!error) return null;

  return (
    <div
      role="alert"
      data-code={error.code}
      className="flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/10 px-3 py-2.5 text-sm"
    >
      <div className="flex-1">
        <p>{error.message}</p>
        {error.isFallback ? (
          // An unmapped code means the client is behind the database. Telling the
          // user their action failed for no stated reason, while hiding the fact
          // that the reason is a gap in our own error map, produces a support
          // ticket nobody can act on. The code is in data-code for whoever reads
          // the logs.
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            The reference code is {error.code}.
          </p>
        ) : null}
      </div>

      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="px-3 py-1.5 text-xs">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A success message, for the outcomes a user is entitled to know about.
 *
 * A stocktake that matched is the case that matters: it is the common result,
 * the user pressed a button and nothing appeared to happen, and silence after a
 * deliberate action reads as a failure.
 */
export function NoticeBanner({
  tone = 'ok',
  children,
}: {
  tone?: 'ok' | 'info';
  children: ReactNode;
}) {
  const tones = {
    ok: 'border-[var(--color-stock-ok)]/40 bg-[var(--color-stock-ok)]/10',
    info: 'border-[var(--color-brand-600)]/40 bg-[var(--color-brand-600)]/10',
  } as const;

  return (
    <div
      // "status" rather than "alert": this confirms an action rather than
      // interrupting with a problem, and a screen reader should not interrupt
      // for it.
      role="status"
      className={`rounded-lg border px-3 py-2.5 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/* ── paged table ────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-aligned for quantities and money. */
  numeric?: boolean;
  /** Hidden on a narrow screen; the columns that matter on a phone. */
  secondary?: boolean;
  className?: string;
}

/**
 * A table with a server-side pager.
 *
 * Paged rather than client-side because the result set is bounded by `max_rows`
 * in PostgREST and silently truncates past that. A warehouse with 4,000 SKUs
 * cannot hold the catalogue in the browser, and a list that quietly stops at
 * 1,000 rows is worse than one that admits it is showing page 1 of 40.
 *
 * The count comes from the same response as the rows (search_products repeats
 * total_count on every row for exactly this reason), so rendering page 1 of 40
 * costs one round trip rather than two.
 */
export function DataTable<T>({
  columns,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  isPending,
  emptyMessage,
  rowKey,
  onRowClick,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  total: number;
  /** Zero-based. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  isPending?: boolean;
  emptyMessage: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp rather than trust the incoming page: a filter change can leave the
  // current page past the end, and a table showing "page 9 of 3" with no rows is
  // a bug the user cannot act on.
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const from = total === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(total, (safePage + 1) * pageSize);

  if (rows.length === 0 && !isPending) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-[color:var(--text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={isPending ? 'opacity-60 transition-opacity' : undefined}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2.5 text-start font-medium text-[color:var(--text-muted)] ${
                    c.numeric ? 'text-end' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                // A clickable row is still a row, not a button: nesting a button
                // inside a tr makes the row's purpose ambiguous to a screen
                // reader and duplicates the focus stop. The row itself takes
                // focus and responds to Enter and Space.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={`border-b last:border-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-[color:var(--surface-raised)]' : ''
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 ${c.numeric ? 'text-end tabular-nums' : ''} ${
                      c.className ?? ''
                    }`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[color:var(--text-muted)]">
        <span aria-live="polite">
          {total === 0 ? 'No results' : `${from}–${to} of ${total}`}
        </span>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="px-3 py-1.5"
            disabled={safePage === 0 || isPending}
            onClick={() => onPageChange(safePage - 1)}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            {safePage + 1} / {pageCount}
          </span>
          <Button
            variant="secondary"
            className="px-3 py-1.5"
            disabled={safePage >= pageCount - 1 || isPending}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── status pills ───────────────────────────────────────────────────────── */

/**
 * Batch status, coloured.
 *
 * The colour comes from the existing stock-* tokens rather than a new palette, so
 * a batch that is red in the table is the same red as the row shading used
 * everywhere else. EXPIRED is distinguished from CRITICAL because a warehouse
 * treats them differently: expired stock is written off, short-dated stock is
 * sold first.
 */
export function StatusPill({ status }: { status: string }) {
  const tones: Record<string, string> = {
    RELEASED: 'border-[var(--color-stock-ok)]/50 text-[var(--color-stock-ok)]',
    QUARANTINED: 'border-[var(--color-stock-warning)]/50 text-[var(--color-stock-warning)]',
    RECALLED: 'border-[var(--color-stock-critical)]/50 text-[var(--color-stock-critical)]',
    EXPIRED: 'border-[var(--color-stock-expired)]/60 text-[var(--color-stock-expired)]',
    DEPLETED: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
  };

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
        tones[status] ?? tones.DEPLETED
      }`}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
