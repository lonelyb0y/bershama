'use client';

import { useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge, Ltr } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Toolbar } from '@/components/ui/toolbar';
import { Link } from '@/i18n/routing';

/**
 * The requisition queue.
 *
 * ── what a queue is ─────────────────────────────────────────────────────────────
 *
 * A requisition is a decision somebody has to make. It arrives from outside the
 * organisation — a pharmacy asking for stock — and it sits in a list until a
 * warehouse manager allocates it or turns it down. That makes it a queue, not a list,
 * and a queue has one job: to show what is waiting, separately from what is not.
 *
 * So there are two views, and the default is the first: **needs a decision**, and
 * everything else. A requisition that was allocated an hour ago is not competing for
 * attention with one that arrived a minute ago, and putting them in one list means
 * the manager has to sort them by eye.
 *
 * ── why a table and not a list of cards ─────────────────────────────────────────
 *
 * A distributor comparing twenty requisitions is comparing a code, a facility, a
 * state and an age, down columns. Cards would make them hold the first card's age in
 * their head while reading the fifth, and would make "oldest first" impossible.
 *
 * The table is the one the catalogue and the batches list use, so the three do not
 * drift into three different densities.
 */
export interface RequisitionQueueRow {
  id: string;
  code: string;
  facility: string;
  status: string;
  statusLabel: string;
  /** Relative, computed on the server: "4 minutes ago". */
  requestedAgo: string;
  justification: string | null;
  needsDecision: boolean;
}

export interface RequisitionQueueLabels {
  code: string;
  facility: string;
  status: string;
  requested: string;
  justification: string;
  needsAction: string;
  canWait: string;
  all: string;
  searchPlaceholder: string;
  searchLabel: string;
  emptyNeedsAction: string;
  emptyNeedsActionBody: string;
  emptyAll: string;
  emptyAllBody: string;
  caption: string;
  needsActionTitle: string;
  canWaitTitle: string;
}

export function RequisitionQueue({
  rows,
  labels: l,
  locale,
  showFilters = true,
}: {
  rows: RequisitionQueueRow[];
  labels: RequisitionQueueLabels;
  locale: 'en' | 'ar';
  /**
   * False for the pharmacy surface, where there is nothing to decide: a pharmacy
   * manager raises requisitions and watches them move, but the decision is the
   * distributor's. Offering them a "needs a decision" filter would be offering them
   * a decision that is not theirs.
   */
  showFilters?: boolean;
}) {
  // 'action' is the default: a queue that opens on everything is a queue that has
  // not decided what it is for.
  const [view, setView] = useState<'action' | 'wait' | 'all'>('action');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === 'action' && !r.needsDecision) return false;
      if (view === 'wait' && r.needsDecision) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.facility.toLowerCase().includes(q) ||
        (r.justification ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, view, query]);

  const columns: Column<RequisitionQueueRow>[] = [
    {
      key: 'code',
      header: l.code,
      primary: true,
      render: (r) => (
        <span className="whitespace-nowrap font-mono text-[13px] font-medium">
          <Ltr>{r.code}</Ltr>
        </span>
      ),
    },
    {
      key: 'facility',
      header: l.facility,
      mobileLabel: l.facility,
      render: (r) => <span className="truncate">{r.facility}</span>,
    },
    {
      key: 'status',
      header: l.status,
      mobileLabel: l.status,
      render: (r) => (
        <Badge tone={r.needsDecision ? 'warn' : 'neutral'} shape={r.needsDecision ? 'circle' : 'square'}>
          {r.statusLabel}
        </Badge>
      ),
    },
    {
      key: 'requested',
      header: l.requested,
      mobileLabel: l.requested,
      numeric: true,
      secondary: true,
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-[color:var(--text-muted)]">
          {r.requestedAgo}
        </span>
      ),
    },
    {
      key: 'justification',
      header: l.justification,
      mobileLabel: l.justification,
      secondary: true,
      render: (r) => (
        <span className="line-clamp-1 text-xs text-[color:var(--text-muted)]">
          {r.justification ?? '—'}
        </span>
      ),
    },
  ];

  const waiting = rows.filter((r) => r.needsDecision).length;

  return (
    <div className="space-y-3">
      <Toolbar label={l.searchLabel}>
        {/*
          The view filter and the search are two separate systems, and that is
          deliberate. The filter decides WHICH rows; the search narrows within them.
          They are not the same control, and a screen that merges them cannot say
          "three waiting, one matching".
        */}
        {showFilters ? (
        <div
          role="group"
          aria-label={l.caption}
          className="flex shrink-0 items-center gap-1 rounded-lg border p-0.5"
        >
          {(
            [
              ['action', l.needsAction, waiting],
              ['wait', l.canWait, rows.length - waiting],
              ['all', l.all, rows.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                view === key
                  ? 'bg-[var(--color-brand-600)] text-white'
                  : 'text-[color:var(--text-muted)] hover:bg-[color:var(--text-muted)]/10'
              }`}
            >
              {label}
              {/* The denominator. A queue that cannot say how many are waiting in it
                  cannot say that you have handled everything. */}
              <span className="ms-1 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
        ) : null}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={l.searchPlaceholder}
          aria-label={l.searchPlaceholder}
          className="w-full max-w-xs rounded-lg border bg-transparent px-3 py-1.5 text-sm"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={filtered}
        caption={l.caption}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.code}
        empty={
          <EmptyState
            title={view === 'action' ? l.emptyNeedsAction : l.emptyAll}
            body={view === 'action' ? l.emptyNeedsActionBody : l.emptyAllBody}
          />
        }
        renderActions={(r) => (
          <Link
            href={`/admin/inventory/requisitions?open=${r.id}`}
            // Prefetching off: one RSC request per row, each re-running the
            // requisitions query to prove a panel exists.
            prefetch={false}
            className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
          >
            {locale === 'ar' ? 'فتح' : 'Open'}
          </Link>
        )}
      />
    </div>
  );
}
