'use client';

import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge, Ltr } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export interface BatchRowView {
  id: string;
  lotNumber: string;
  productName: string;
  sku: string;
  mfgDate: string;
  expiryDate: string;
  status: string;
  supplierName: string | null;
  daysToExpiry: number;
}

export interface BatchTableLabels {
  lot: string;
  product: string;
  expiry: string;
  statusLabel: string;
  status: Record<string, string>;
  supplier: string;
  days: string;
  daysColumn: string;
  empty: string;
  emptyBody: string;
  expired: string;
  expiringSoon: string;
  readOnly: string;
  over: string;
}

/**
 * The batch list.
 *
 * ── the column that matters ──────────────────────────────────────────────────────
 *
 * A supervisor opens this screen for one reason: which batches are about to go off.
 * So "days to expiry" is a column of its own, and it is **always populated** — "12d",
 * "8d", "over 90d" — rather than being blank for the healthy rows.
 *
 * It used to be blank. The screen showed the expiry *date* in one column, and put the
 * countdown in a second column that only had content when the batch was already in
 * trouble. So the column everybody scans was empty for most of the list, and the
 * information everybody wanted was in the column everybody does not scan.
 *
 * A date is also the wrong unit for the question being asked. "2026-08-30" makes the
 * reader do arithmetic against today; "8 days" is the answer. The date is still there,
 * in its own column, for when somebody needs the exact value.
 *
 * ── how urgency is shown ─────────────────────────────────────────────────────────
 *
 * Colour, a shape, and the number. Three, not one. The number is the value, the shape
 * survives a greyscale printout, and the colour is the fastest read for the person who
 * already knows what they are looking at. Red text on a white row, never a washed-out
 * red background — a table with a coloured background is a table nobody can read.
 *
 * ── the shape of the list ────────────────────────────────────────────────────────
 *
 * A real table, and the shared one, so the catalogue and the batches list cannot drift
 * apart into two different tables with two different densities. Under `md` it becomes
 * cards, because nine columns on a 390px screen is a corridor with the useful end off
 * the right-hand side.
 */
export function BatchTable({
  rows,
  labels: l,
}: {
  rows: BatchRowView[];
  labels: BatchTableLabels;
}) {
  const columns: Column<BatchRowView>[] = [
    {
      key: 'product',
      header: l.product,
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.productName}</div>
          <div className="truncate text-xs text-[color:var(--text-muted)]">
            <Ltr>{r.sku}</Ltr>
          </div>
        </div>
      ),
    },
    {
      key: 'lot',
      header: l.lot,
      mobileLabel: l.lot,
      render: (r) => (
        <span className="whitespace-nowrap font-mono text-xs">
          <Ltr>{r.lotNumber}</Ltr>
        </span>
      ),
    },
    {
      key: 'days',
      header: l.daysColumn,
      mobileLabel: l.daysColumn,
      numeric: true,
      render: (r) => {
        const band = severityOf(r.daysToExpiry, r.status);
        if (band === 'expired') {
          return (
            <Badge tone="bad" shape="triangle">
              {l.expired}
            </Badge>
          );
        }
        if (band === 'soon') {
          return (
            <Badge tone="warn" shape="circle">
              <Ltr>
                {r.daysToExpiry} {l.days}
              </Ltr>
            </Badge>
          );
        }
        return (
          <span className="text-[color:var(--text-muted)] tabular-nums">
            <Ltr>{`${l.over} 90`}</Ltr>
          </span>
        );
      },
    },
    {
      key: 'expiry',
      header: l.expiry,
      mobileLabel: l.expiry,
      secondary: true,
      render: (r) => (
        <span className="whitespace-nowrap text-xs tabular-nums text-[color:var(--text-muted)]">
          <Ltr>{r.expiryDate}</Ltr>
        </span>
      ),
    },
    {
      key: 'status',
      header: l.statusLabel,
      mobileLabel: l.statusLabel,
      render: (r) => (
        <Badge tone={r.status === 'RELEASED' ? 'good' : 'neutral'} shape="diamond">
          {l.status[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: 'supplier',
      header: l.supplier,
      mobileLabel: l.supplier,
      secondary: true,
      render: (r) => (
        <span className="text-xs text-[color:var(--text-muted)]">{r.supplierName ?? '—'}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      caption={l.product}
      rowKey={(r) => r.id}
      rowLabel={(r) => `${r.productName} ${r.lotNumber}`}
      empty={
        <EmptyState
          title={l.empty}
          body={l.emptyBody}
        />
      }
    />
  );
}

/**
 * Severity, from the whole picture rather than from the status alone.
 *
 * A batch the database still calls RELEASED can be two days from expiry, and a
 * batch marked EXPIRED needs no further warning. What a warehouse manager needs
 * is "what should I deal with today", which is the intersection of the two.
 */
function severityOf(
  daysToExpiry: number,
  status: string,
): 'ok' | 'soon' | 'expired' {
  if (status === 'EXPIRED' || daysToExpiry < 0) return 'expired';
  if (status === 'DEPLETED') return 'ok';
  // 90 days is the point at which a batch needs moving rather than using. It is
  // a distributor's own judgement, not a regulation, and it is a named constant
  // rather than a bare number so the next person can see it was chosen.
  if (daysToExpiry <= 90) return 'soon';
  return 'ok';
}
