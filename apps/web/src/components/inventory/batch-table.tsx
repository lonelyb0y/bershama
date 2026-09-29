'use client';

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
  empty: string;
  expired: string;
  expiringSoon: string;
  readOnly: string;
}

/**
 * The batch list, as a real <table>.
 *
 * A table because the content is tabular data that people compare down a column:
 * expiry dates, statuses, lot numbers. A list of cards reads better on a phone
 * and worse for the only thing this screen is for, which is scanning a column
 * for the row that is about to go off.
 *
 * Expiry is expressed in days rather than as a date alone. "2026-08-30" requires
 * the reader to do arithmetic against today; "8 days" is the answer. The date is
 * still there, for when someone needs the exact value.
 *
 * Server-rendered, so it works before hydration and is readable by a screen
 * reader as a table. The only thing client-side is the colour, and that is CSS.
 */
export function BatchTable({ rows, labels: l }: { rows: BatchRowView[]; labels: BatchTableLabels }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border p-8 text-center text-sm text-[color:var(--text-muted)]">
        {l.empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-start">
            <Th>{l.lot}</Th>
            <Th>{l.product}</Th>
            <Th>{l.expiry}</Th>
            <Th>{l.statusLabel}</Th>
            <Th>{l.supplier}</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const severity = severityOf(r.daysToExpiry, r.status);

            return (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  {/* dir="ltr": a lot number is copied onto a count sheet and
                      typed into a search box, both of which are Latin-first. */}
                  <span dir="ltr" className="font-mono text-xs">
                    {r.lotNumber}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="block">{r.productName}</span>
                  <span dir="ltr" className="text-[color:var(--text-muted)] text-xs">
                    {r.sku}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span dir="ltr" className="block">
                    {r.expiryDate}
                  </span>
                  <span
                    className={`text-xs ${
                      severity === 'expired'
                        ? 'text-[var(--color-stock-expired)] font-medium'
                        : severity === 'soon'
                          ? 'text-[var(--color-stock-warning)]'
                          : 'text-[color:var(--text-muted)]'
                    }`}
                  >
                    {severity === 'expired'
                      ? l.expired
                      : severity === 'soon'
                        ? `${r.daysToExpiry} ${l.days}`
                        : ''}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] font-medium">
                    {l.status[r.status] ?? r.status}
                  </span>
                </td>
                <td className="text-[color:var(--text-muted)] px-4 py-3 text-xs">
                  {r.supplierName ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="text-[color:var(--text-muted)] px-4 py-2 text-start text-xs font-medium tracking-wide uppercase"
    >
      {children}
    </th>
  );
}

/**
 * Severity, from the whole picture rather than from the status alone.
 *
 * A batch the database still calls RELEASED can be two days from expiry, and a
 * batch marked EXPIRED needs no further warning. What a warehouse manager needs
 * is "what should I deal with today", which is the intersection of the two.
 */
function severityOf(daysToExpiry: number, status: string): 'ok' | 'soon' | 'expired' {
  if (status === 'EXPIRED' || daysToExpiry < 0) return 'expired';
  if (status === 'DEPLETED') return 'ok';
  // 90 days is the point at which a batch needs moving rather than using. It is
  // a distributor's own judgement, not a regulation, and it is a named constant
  // rather than a bare number so the next person can see it was chosen.
  if (daysToExpiry <= 90) return 'soon';
  return 'ok';
}
