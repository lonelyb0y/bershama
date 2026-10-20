import type { ReactNode } from 'react';

/**
 * The top of every screen.
 *
 * One shape, so that a person who learns the catalogue screen has already learned the
 * batches screen: a title, a line saying what is in the list, and the actions on the
 * right. Before this, each screen decided for itself where the title went, whether
 * there was a count, and what the primary action looked like — which is why the
 * catalogue had two full-width "Add" strips and the batches screen had a button in
 * the middle of the header.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  /** What is on this screen, and how much of it. */
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
