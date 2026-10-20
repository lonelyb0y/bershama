'use client';

import type { ReactNode } from 'react';

import { Ltr } from './badge';

/**
 * The table every list screen uses.
 *
 * ── why this exists ───────────────────────────────────────────────────────────────
 *
 * There was already a DataTable. Nothing imported it.
 *
 * Ten screens each rolled their own list markup instead: a <ul> of divs, or a table
 * with no semantics, or a grid of cards. A catalogue of two hundred products rendered
 * as two hundred list items with no column headers, no sort, and five buttons all
 * called "Deactivate" and five links all called "Edit" — so a screen reader heard the
 * same word ten times and could not say which product any of them belonged to.
 *
 * This is the one place that decides what a list looks like. If a screen needs
 * something different, the answer is a column, not a new list.
 *
 * ── the shape of it ───────────────────────────────────────────────────────────────
 *
 * A real <table>, always. Not a grid of divs pretending. A table is what lets a
 * browser and a screen reader associate a cell with its column, lets Ctrl+F find a
 * product name, lets a user select a column of figures, and lets the platform offer
 * "sort by" affordances. A div-list has none of that, and the accessibility cost is
 * invisible precisely because the page looks fine.
 *
 * Dense on purpose. A supervisor scanning forty batches for the one expiring this
 * week is reading a column of dates, not reading prose. The row height is 36px, the
 * type is 13px, and the numbers are tabular so they line up in a column instead of
 * dancing. Generous spacing is for a marketing page.
 *
 * ── on a phone ────────────────────────────────────────────────────────────────────
 *
 * A nine-column table on a 390px screen is a horizontal scroll through a corridor,
 * and the column you need is always off the right-hand end. So under `md` each row
 * becomes a card: the primary column is the card's heading, the rest are label/value
 * pairs, and the actions sit at the bottom where a thumb can reach them. The data is
 * the same; only the arrangement changes.
 */

// ── column ────────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-aligned, and set in tabular figures. For quantities and money. */
  numeric?: boolean;
  /** Hidden on a narrow screen: the columns that matter least on a phone. */
  secondary?: boolean;
  /**
   * The column that becomes the card's heading on a phone.
   *
   * Exactly one per table. Without it the phone layout has no title and every card
   * is an undifferentiated list of values.
   */
  primary?: boolean;
  /** The label used for this field on a phone, where there are no column headers. */
  mobileLabel?: string;
  className?: string;
  /** Extra classes for the <th>, for width. */
  headClassName?: string;
}

// ── the table ─────────────────────────────────────────────────────────────────────

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  /** A short name for the table, for a screen reader: "Products", "Batches". */
  caption: string;
  /** Identifies a row, and is used in action labels so they are never ambiguous. */
  rowKey: (row: T) => string;
  /** The human name of a row, used in action labels: the product name. */
  rowLabel?: (row: T) => string;
  empty: ReactNode;
  /** A row that opens something. The row takes focus and responds to Enter and Space. */
  onRowClick?: (row: T) => void;
  /** Rendered at the end of each row, in the actions column. */
  renderActions?: (row: T) => ReactNode;
  /**
   * A test id for each row, so a spec can count rows without depending on the
   * markup around them.
   */
  rowTestId?: string;
  className?: string;
}

/**
 * A table.
 *
 * Deliberately not a `<table role="grid">`: a grid announces every cell as
 * navigable and makes a screen reader read cell by cell, which is slower and worse
 * for a table people read by scanning. A plain table with a header row is read row
 * by row, which is what a list of products is.
 */
export function DataTable<T>({
  columns,
  rows,
  caption,
  rowKey,
  rowLabel,
  empty,
  onRowClick,
  renderActions,
  rowTestId,
  className,
}: DataTableProps<T>) {
  const primary = columns.find((c) => c.primary) ?? columns[0];

  if (rows.length === 0) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={className}>
      {/* ── the table, from md up ─────────────────────────────────────────────── */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b bg-[color:var(--surface-2)]/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2 text-start font-medium text-[color:var(--text-muted)] ${
                    c.numeric ? 'text-end' : ''
                  } ${c.secondary ? 'hidden lg:table-cell' : ''} ${c.headClassName ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
              {renderActions ? (
                <th scope="col" className="w-px px-3 py-2 text-end font-medium text-[color:var(--text-muted)]">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const label = rowLabel?.(row);
              return (
                <tr
                  key={key}
                  data-testid={rowTestId}
                  tabIndex={onRowClick ? 0 : undefined}
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
                    onRowClick ? 'cursor-pointer hover:bg-[color:var(--surface-2)]/50' : ''
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 align-middle ${
                        c.numeric ? 'text-end tabular-nums' : ''
                      } ${c.secondary ? 'hidden lg:table-cell' : ''} ${c.className ?? ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {renderActions ? (
                    <td
                      className="px-3 py-2 text-end align-middle"
                      // The row is clickable, so a click on an action must not also
                      // open the row. The actions stop propagation themselves; this
                      // is the belt to that braces.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {renderActions(row)}
                      </div>
                    </td>
                  ) : null}
                  {label ? <td className="sr-only">{label}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── the cards, under md ──────────────────────────────────────────────── */}
      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            data-testid={rowTestId}
            className="rounded-xl border p-3"
            tabIndex={onRowClick ? 0 : undefined}
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
          >
            <div className="text-sm font-medium">{primary.render(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {columns
                .filter((c) => c.key !== primary.key)
                .map((c) => (
                  <div key={c.key} className="col-span-2 flex items-baseline justify-between gap-3">
                    <dt className="text-[color:var(--text-muted)]">
                      {c.mobileLabel ?? c.header}
                    </dt>
                    <dd className={`text-end ${c.numeric ? 'tabular-nums' : ''}`}>
                      {c.render(row)}
                    </dd>
                  </div>
                ))}
            </dl>
            {renderActions ? (
              <div
                className="mt-3 flex items-center gap-2 border-t pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                {renderActions(row)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── the parts of a table that always look the same ───────────────────────────────

/**
 * The body of a table that has to be re-stated on every screen.
 *
 * Only the columns that a person actually scans for are worth a column. A catalogue
 * screen that shows the ATC code, the GTIN and the EDAN registration number is showing
 * three facts that almost nobody looks up, and hiding them behind a detail panel is
 * cheaper than showing them.
 */
export function BatchAndProductHints({
  productName,
  productNameAr,
  lot,
  extra,
}: {
  productName: string;
  productNameAr?: string | null;
  lot?: string | null;
  extra?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{productName}</div>
      {productNameAr ? (
        // The Arabic name sits under the Latin one, in the muted colour, and is
        // marked dir="ltr" on the container: an Arabic name inside an LTR page
        // inherits the paragraph direction and gets its punctuation moved to the
        // wrong end.
        <div className="truncate text-xs text-[color:var(--text-muted)]" dir="ltr">
          {productNameAr}
        </div>
      ) : null}
      {lot ? (
        <div className="truncate text-xs text-[color:var(--text-muted)] tabular-nums">
          <Ltr>{lot}</Ltr>
        </div>
      ) : null}
      {extra}
    </div>
  );
}
