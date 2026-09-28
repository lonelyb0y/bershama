// @vitest-environment jsdom
// The count sheet, which is the screen where a wrong number becomes a wrong
// ledger.
//
// The behaviours asserted here are the ones a careless user could trigger and
// would not notice:
//
//   * a blank line is NOT a count of zero
//   * a pasted value with a separator is not silently cleared
//   * a partly-refused sheet says so, and says which lines
//   * a clean run clears the boxes, so the same numbers cannot be posted twice

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { CountSheet, type StocktakeRow, type StocktakeSubmission } from './count-sheet';
import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json';

const ROWS: StocktakeRow[] = [
  {
    batchId: 'b1',
    productId: 'p1',
    lotNumber: 'LOT-1001',
    productName: 'Panadol Extra 500mg',
    expiryDate: '2027-12-01',
    qtyOnHand: 100,
  },
  {
    batchId: 'b2',
    productId: 'p2',
    lotNumber: 'LOT-1002',
    productName: 'Amoxil 500mg',
    expiryDate: '2026-10-15',
    qtyOnHand: 25,
  },
];

type CountSheetProps = React.ComponentProps<typeof CountSheet>;

function mount(overrides: Partial<CountSheetProps> = {}) {
  // Typed through the component's own prop type, so mock.calls is a real tuple
  // without the implementation having to declare parameters it ignores.
  const submit = vi.fn<CountSheetProps['submit']>(async () => ({
    summary: 'Saved 1 variance and 0 matching lines.',
    failures: [],
  }));

  const props = {
    locationId: 'loc-1',
    rows: ROWS,
    submit,
    ...overrides,
  };

  const utils = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CountSheet {...props} />
    </NextIntlClientProvider>,
  );

  return { submit, ...utils };
}

const countBox = (lot: string) =>
  screen.getByRole('textbox', { name: new RegExp(`Counted: .*${lot}`) });

/**
 * The variance cells, in row order.
 *
 * Read by column position rather than by text. An em-dash appears in two places
 * on a row -- the variance cell when nothing is typed, and the reason
 * dropdown's placeholder -- so `getAllByText('—')` cannot tell them apart, and
 * the first version of these tests counted four dashes and then asserted that no
 * dash existed at all.
 */
function varianceCells(): string[] {
  const rows = screen.getAllByRole('row').slice(1); // drop the header row
  // Index 1, not 2. The first column is a <th scope="row">, which exposes the
  // `rowheader` role rather than `cell`, so it is absent from getAllByRole
  // ('cell') and the data cells are system, variance, count, reason.
  return rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');
}

describe('the sheet as loaded', () => {
  it('names each count box after its row', () => {
    mount();
    // A cell input has no visible label, so the row is the only thing that can
    // give it an accessible name. Without this every box on a 200-row sheet
    // announces as "Counted" and is unusable by keyboard or screen reader.
    expect(countBox('LOT-1001')).toBeInTheDocument();
    expect(countBox('LOT-1002')).toBeInTheDocument();
  });

  it('shows the system quantity and no variance before anything is typed', () => {
    mount();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(varianceCells()).toEqual(['—', '—']);
  });

  it('starts with save disabled, because nothing has been counted', () => {
    mount();
    expect(screen.getByRole('button', { name: /Save the sheet/ })).toBeDisabled();
  });

  it('says there is nothing to count rather than showing an empty table', () => {
    mount({ rows: [] });
    expect(screen.getByText(/no stock recorded/i)).toBeInTheDocument();
  });
});

describe('the live variance', () => {
  it('shows the difference as soon as a count is typed', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(countBox('LOT-1001'), '97');

    // Before saving. A mistake caught while counting is cheap; the same mistake
    // found in a reconciliation report a week later is not.
    expect(varianceCells()).toEqual(['-3', '—']);
  });

  it('signs a positive variance', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(countBox('LOT-1001'), '103');
    expect(varianceCells()[0]).toBe('+3');
  });

  it('shows a zero variance as a zero, not as a dash', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(countBox('LOT-1001'), '100');
    // "Counted 100, books say 100" is the most reassuring result on the sheet, and
    // it is worth saying so rather than leaving the counter to wonder whether the
    // box registered at all.
    expect(varianceCells()).toEqual(['0', '—']);
  });
});

describe('entering counts', () => {
  it('strips non-digits from a pasted value rather than clearing it', async () => {
    const user = userEvent.setup();
    mount();

    const box = countBox('LOT-1001');
    await user.click(box);
    await user.paste('1,200');

    // A type="number" input would return '' here, and the counter would believe
    // the value went in.
    expect(box).toHaveValue('1200');
  });

  it('enables save once something is counted', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(countBox('LOT-1001'), '97');
    expect(screen.getByRole('button', { name: /Save the sheet/ })).toBeEnabled();
  });

  it('counts how many lines are in, for the counter to check', async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getByText('0 / 2')).toBeInTheDocument();
    await user.type(countBox('LOT-1001'), '97');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });
});

describe('submitting', () => {
  it('sends a blank line as blank, and a zero as zero', async () => {
    const user = userEvent.setup();
    const { submit } = mount();

    // The distinction the whole screen rests on. Blank means the bay was locked;
    // zero means counted, and the shelf is empty -- which is exactly the
    // discrepancy a stocktake exists to find.
    await user.type(countBox('LOT-1001'), '97');
    await user.type(countBox('LOT-1002'), '0');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    await waitFor(() => expect(submit).toHaveBeenCalled());

    const [locationId, lines] = submit.mock.calls[0];

    expect(locationId).toBe('loc-1');
    expect(lines.find((l) => l.batchId === 'b1')?.countedQty).toBe('97');
    expect(lines.find((l) => l.batchId === 'b2')?.countedQty).toBe('0');
  });

  it('sends a blank line as an empty string, not a zero', async () => {
    const user = userEvent.setup();
    const { submit } = mount();

    await user.type(countBox('LOT-1001'), '97');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    const lines = submit.mock.calls[0][1];

    expect(lines.find((l) => l.batchId === 'b2')?.countedQty).toBe('');
  });

  it('clears the boxes after a clean save', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(countBox('LOT-1001'), '97');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    await waitFor(() => expect(countBox('LOT-1001')).toHaveValue(''));
  });

  it('keeps the boxes when something was refused', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async (): Promise<StocktakeSubmission> => ({
      summary: 'Saved 1 line and refused 1.',
      failures: [{ batchId: 'b2', productId: 'p2', code: 'counted_quantity_invalid', message: 'Enter a quantity greater than zero.' }],
    }));

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={submit} />
      </NextIntlClientProvider>,
    );

    await user.type(countBox('LOT-1001'), '97');
    await user.type(countBox('LOT-1002'), '3');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    // The counts are the only copy. Clearing them on a partial failure would make
    // the counter walk the warehouse again.
    await waitFor(() => expect(countBox('LOT-1001')).toHaveValue('97'));
  });

  it('reports a thrown submission as an error, not as silence', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => {
      throw new Error('Network unreachable');
    });

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={submit} />
      </NextIntlClientProvider>,
    );

    await user.type(countBox('LOT-1001'), '97');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unreachable'));
  });
});

describe('refused lines', () => {
  it('lists which lot failed and why', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async (): Promise<StocktakeSubmission> => ({
      summary: 'Saved 1 line and refused 1.',
      failures: [
        {
          batchId: 'b2',
          productId: 'p2',
          code: 'insufficient_stock',
          message: 'Only 12 in stock here; you asked for 40.',
        },
      ],
    }));

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={submit} />
      </NextIntlClientProvider>,
    );

    await user.type(countBox('LOT-1002'), '3');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    const section = await screen.findByRole('region', { name: /Lines that were not saved/ });
    // Both the lot and the reason. A failure list that shows only "1 failed"
    // leaves the counter hunting for which shelf.
    expect(within(section).getByText('LOT-1002')).toBeInTheDocument();
    expect(section).toHaveTextContent('Only 12 in stock here; you asked for 40.');
  });

  it('marks the failed row', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async (): Promise<StocktakeSubmission> => ({
      summary: 'refused',
      failures: [{ batchId: 'b2', productId: 'p2', code: 'x', message: 'nope' }],
    }));

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={submit} />
      </NextIntlClientProvider>,
    );

    await user.type(countBox('LOT-1002'), '3');
    await user.click(screen.getByRole('button', { name: /Save the sheet/ }));

    await waitFor(() => expect(countBox('LOT-1002')).toHaveAttribute('aria-invalid'));
  });
});

describe('direction and numbers', () => {
  it('forces a lot number left-to-right even in an Arabic sheet', () => {
    render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={vi.fn()} />
      </NextIntlClientProvider>,
    );

    // The counter is transcribing this off a carton. A reordered lot number reads
    // as a typo and gets written down wrong.
    const lot = screen.getByText(/LOT-1001/);
    expect(lot).toHaveAttribute('dir', 'ltr');
  });

  it('renders an Arabic sheet in Arabic', () => {
    render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <CountSheet locationId="loc-1" rows={ROWS} submit={vi.fn()} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: /حفظ ورقة الجرد/ })).toBeInTheDocument();
  });

  it('asks for a numeric keypad on every box', () => {
    mount();
    for (const box of [countBox('LOT-1001'), countBox('LOT-1002')]) {
      expect(box).toHaveAttribute('inputmode', 'numeric');
    }
  });
});
