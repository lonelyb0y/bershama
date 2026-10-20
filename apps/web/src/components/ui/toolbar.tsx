import type { ReactNode } from 'react';

/**
 * The strip above a list: search, and whatever filters the list has.
 *
 * ── one landmark, not six ────────────────────────────────────────────────────────
 *
 * Every filter on the catalogue page was its own <form>, so the page had six form
 * landmarks. A screen reader user listing landmarks heard "form, form, form, form,
 * form, form" and no idea which was which. This is one form, labelled, with the
 * controls inside it — which is also what makes Enter-in-the-search-box work.
 */
export function Toolbar({
  label,
  children,
}: {
  /** What the toolbar controls, for a screen reader: "Search products". */
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 rounded-xl border p-2"
    >
      {children}
    </div>
  );
}
