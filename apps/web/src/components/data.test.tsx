// @vitest-environment jsdom
//
// The only kind that needs a DOM. Spelled per file rather than configured
// globally, so the 60-odd pure-logic tests keep running in node.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable, ErrorBanner, StatusPill, type Column } from './data';

/**
 * The pager, not the rendering.
 *
 * DataTable's job is to not lie about what it is showing. Every interesting
 * failure here is a table that displays a number the user then acts on:
 * "showing 1-50 of 312" when only 12 rows exist, or "page 9 of 3" with an empty
 * grid and no way to get back. The arithmetic is a few lines and it is the part
 * that will be wrong, so it is pinned rather than eyeballed.
 */

interface Row {
  sku: string;
  qty: number;
}

// Typed as Column<Row>[] rather than left to infer. The inference version needed
// an `as never` to spread into the component, which is the compiler being told to
// stop checking -- exactly what a test of the pager's arithmetic cannot afford.
const COLUMNS: Column<Row>[] = [
  { key: 'sku', header: 'SKU', render: (r) => r.sku },
  { key: 'qty', header: 'Qty', numeric: true, render: (r) => r.qty },
];

const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
  sku: `SKU-${i + 1}`,
  qty: i + 1,
}));

type TableProps = React.ComponentProps<typeof DataTable<Row>>;

function renderTable(overrides: Partial<TableProps> = {}) {
  const props: TableProps = {
    columns: COLUMNS,
    rows,
    total: 312,
    page: 0,
    pageSize: 50,
    onPageChange: () => {},
    emptyMessage: 'Nothing here',
    rowKey: (r) => r.sku,
    ...overrides,
  };
  render(<DataTable<Row> {...props} />);
  return props;
}

describe('page arithmetic', () => {
  it('reports the first page as 1 to pageSize of the total', () => {
    renderTable({ page: 0, total: 312, pageSize: 50 });
    expect(screen.getByText('1–50 of 312')).toBeTruthy();
    expect(screen.getByText('1 / 7')).toBeTruthy();
  });

  it('reports a middle page as the right slice', () => {
    renderTable({ page: 2, total: 312, pageSize: 50 });
    expect(screen.getByText('101–150 of 312')).toBeTruthy();
    expect(screen.getByText('3 / 7')).toBeTruthy();
  });

  it('truncates the last page rather than overshooting the total', () => {
    // 312 items at 50 a page leaves 12 on page 7. Reporting "251-300 of 312"
    // would imply a page size the user never chose.
    renderTable({ page: 6, total: 312, pageSize: 50 });
    expect(screen.getByText('301–312 of 312')).toBeTruthy();
  });

  it('handles a total that is an exact multiple of the page size', () => {
    renderTable({ page: 1, total: 100, pageSize: 50 });
    expect(screen.getByText('51–100 of 100')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('clamps a page past the end instead of rendering page 9 of 3', () => {
    // Reachable in normal use: change a filter while on page 5 and the new
    // result set is one page long. The table would show an empty grid, a page
    // counter larger than the page count, and Previous as the only way out.
    renderTable({ page: 8, total: 40, pageSize: 50 });
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText('1–40 of 40')).toBeTruthy();
  });

  it('clamps a negative page', () => {
    renderTable({ page: -3, total: 100, pageSize: 50 });
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('reports a single page as 1 / 1 and does not divide by zero', () => {
    renderTable({ page: 0, total: 5, pageSize: 50 });
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText('1–5 of 5')).toBeTruthy();
  });
});

describe('empty results', () => {
  it('shows the empty message instead of a pager reading 1 / 1', () => {
    renderTable({ rows: [], total: 0, page: 0 });
    expect(screen.getByText('Nothing here')).toBeTruthy();
    // "1–0 of 0" would be nonsense, and a Next button on a one-page result set
    // invites the user to hunt for a second page.
    expect(screen.queryByText(/–0 of/)).toBeNull();
  });

  it('keeps the header while loading rather than flashing the empty message', () => {
    // A filter that briefly shows "nothing here" before rows arrive reads as a
    // failed search, and on a slow connection that is most of the wait.
    renderTable({ rows: [], total: 0, isPending: true });
    expect(screen.queryByText('Nothing here')).toBeNull();
  });
});

describe('pager controls', () => {
  it('disables Previous on the first page and Next on the last', () => {
    const base: TableProps = {
      columns: COLUMNS,
      rows,
      total: 100,
      page: 0,
      pageSize: 50,
      onPageChange: () => {},
      emptyMessage: 'x',
      rowKey: (r) => r.sku,
    };
    const { rerender } = render(<DataTable<Row> {...base} />);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);

    rerender(<DataTable<Row> {...base} page={1} />);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('ErrorBanner', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('exposes the database code as data-code, not as the message', () => {
    // The sentence is translated; the code is the only stable handle on which
    // error the database actually raised.
    render(
      <ErrorBanner error={{ message: 'المتوفر 12 فقط', code: 'insufficient_stock', isFallback: false }} />,
    );
    const banner = screen.getByRole('alert');
    expect(banner.getAttribute('data-code')).toBe('insufficient_stock');
    expect(banner.textContent).toContain('12');
    expect(banner.textContent).not.toContain('insufficient_stock');
  });

  it('surfaces the reference code when the message fell back', () => {
    // Otherwise a user reports an unexplained failure and the logs show
    // something our error map had never heard of, with nothing connecting them.
    render(<ErrorBanner error={{ message: 'Something went wrong.', code: 'mystery_code', isFallback: true }} />);
    expect(screen.getByRole('alert').textContent).toContain('mystery_code');
  });
});

describe('StatusPill', () => {
  it('renders an unknown status rather than an empty pill', () => {
    render(<StatusPill status="SOMETHING_NEW" />);
    expect(screen.getByText('something new')).toBeTruthy();
  });

  it('shows the status in words, not SCREAMING_SNAKE', () => {
    // EXPIRED and CRITICAL are genuinely different states and a warehouse
    // treats them differently, so they are not collapsed into one red pill.
    render(<StatusPill status="RECALLED" />);
    expect(screen.getByText('recalled')).toBeTruthy();
  });
});
