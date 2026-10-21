import type { ReactNode } from 'react';

/**
 * A table, for a server-rendered list.
 *
 * ── why there are two tables ────────────────────────────────────────────────────
 *
 * `DataTable` is a client component, because a column is a render function and a
 * render function cannot cross from a server component to a client one. That cost was
 * learned the hard way: the catalogue shipped a page that threw on every visit.
 *
 * But most lists are simple enough that the server can write the rows itself, and
 * for those this is the right primitive: no client boundary, no render functions, and
 * the rows are in the HTML before JavaScript arrives at all.
 *
 * The two are the same table to look at. The same density, the same header band, the
 * same treatment of a numeric column. A screen that uses one and a screen that uses
 * the other look like the same product, which is the point.
 */
export function SimpleTable({
  caption,
  headers,
  children,
  className,
}: {
  /** What the table is, for a screen reader. */
  caption: string;
  /** Column headings. A `numeric` one is right-aligned. */
  headers: readonly { label: string; numeric?: boolean; className?: string }[];
  /** The rows. Each is a `<tr>`. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-xl border ${className ?? ''}`}>
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-[color:var(--surface-2)]/60">
            {headers.map((h) => (
              <th
                key={h.label}
                scope="col"
                className={`px-3 py-2 text-start font-medium text-[color:var(--text-muted)] ${
                  h.numeric ? 'text-end' : ''
                } ${h.className ?? ''}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A cell.
 *
 * The numeric variant is right-aligned and set in tabular figures, so a column of
 * quantities lines up instead of dancing. Numbers that are compared down a column are
 * the whole reason a table is a table.
 */
export function Td({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 align-middle ${numeric ? 'text-end tabular-nums' : ''} ${className ?? ''}`}
    >
      {children}
    </td>
  );
}
