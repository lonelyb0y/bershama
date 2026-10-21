// @vitest-environment jsdom
//
// The dashboard charts.
//
// ── why these are tested at all ───────────────────────────────────────────────
//
// The charts are Bklit's now, and Bklit's are CLIENT components with a data
// boundary. That boundary is exactly where a chart breaks: the page still
// renders, the panel is still there, and the chart is simply missing. A
// dashboard whose charts failed to mount looks like an EMPTY dashboard rather
// than like a broken one, so nothing complains.
//
// The browser suite cannot catch it, because the charts are conditional on
// fulfilled deliveries, and the CI fixture has none. So the mount is tested
// here, with points, where it is deterministic.
//
// The table twin is tested too, and that is the rule that matters most: a chart
// is a picture of a table, and the picture is never the only copy of the data.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarTrendChart, ProportionRing, RankedBars, RankedBarsWithTable } from './charts';

const POINTS = [
  { label: '14 Oct', value: 4200, display: 'EGP 4,200' },
  { label: '21 Oct', value: 6100, display: 'EGP 6,100' },
  { label: '28 Oct', value: 5400, display: 'EGP 5,400' },
];

const ROWS = [
  { id: 'a', label: 'Panadol Extra 500 mg Tablets', sub: 'Ambient Aisle 1', value: 240, display: 'EGP 3,200' },
  { id: 'b', label: 'ORS Sachet', sub: 'Ambient Aisle 2', value: 80, display: 'EGP 640' },
];

describe('the dashboard charts', () => {
  it('mounts the bar trend chart when there are points', () => {
    render(<BarTrendChart points={POINTS} ariaLabel="Delivered margin" />);

    expect(screen.getByTestId('bar-trend-chart')).toBeInTheDocument();
    // The chart is a figure with a name, so it is in the accessibility tree and
    // not just in the pixels.
    expect(screen.getByRole('figure', { name: 'Delivered margin' })).toBeInTheDocument();
  });

  it('renders nothing at all when there are no points', () => {
    const { container } = render(<BarTrendChart points={[]} ariaLabel="Delivered margin" />);
    // An empty chart is a panel with a hole in it, which reads as "no data" when
    // it means "nothing to draw". The panel's own empty state is the honest one.
    expect(container.querySelector('[data-testid="bar-trend-chart"]')).toBeNull();
  });

  it('shows every category label', () => {
    render(<BarTrendChart points={POINTS} ariaLabel="Delivered margin" />);
    for (const point of POINTS) {
      expect(screen.getByText(point.label)).toBeInTheDocument();
    }
  });

  it('keeps the number visible on a ranked row, without a hover', () => {
    render(<RankedBars rows={ROWS} ariaLabel="Ranked by realised margin" />);

    // The number is on the row, always. A chart puts it on the pointer, and
    // this list is read by comparing four to eight things at once.
    expect(screen.getByText('EGP 3,200')).toBeInTheDocument();
    expect(screen.getByText('EGP 640')).toBeInTheDocument();
    expect(screen.getByText('Panadol Extra 500 mg Tablets')).toBeInTheDocument();
  });

  it('gives the ring an accessible name carrying its value', () => {
    render(<ProportionRing value={30} total={120} label="Filled this week" display="25%" />);
    expect(screen.getByRole('img', { name: 'Filled this week: 25%' })).toBeInTheDocument();
  });

  it('keeps the table twin, with the numbers in cells', () => {
    render(
      <RankedBarsWithTable
        rows={ROWS}
        ariaLabel="Product"
        tableLabel="Value"
        showLabel="Show the numbers"
      />,
    );

    expect(screen.getByText('Show the numbers')).toBeInTheDocument();
    // The table exists before it is opened, which is what lets a browser find
    // it, and what lets a printed report carry it.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('EGP 3,200').length).toBeGreaterThan(0);
  });
});
