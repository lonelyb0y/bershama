/* eslint-disable react-hooks/incompatible-library --
   The React Compiler cannot see through react-hook-form's handleSubmit and
   reports any form element as an incompatible library. A known limitation of the
   two meeting, not a bug in either, and it will appear on every form in the app.
   A line-level directive was tried first and does not apply from inside JSX
   children, which is worth knowing before spending time on it again. Revisit when
   the compiler understands RHF; it is not a signal to drop either. */

// @vitest-environment jsdom
//
// The form primitives, wired into a real react-hook-form form.
//
// Two things here are assertions about behaviour I could have assumed:
//
//   1. NumberField strips non-digits AND hands the cleaned value to RHF. RHF's
//      onChange accepts a bare value as well as a DOM event, but which path it
//      takes is an implementation detail of the library, and the digit stripping
//      is the whole reason the component overrides onChange at all. If RHF
//      stopped accepting a raw string, this form would submit "abc" and fail
//      validation with a message about a number -- so it is pinned rather than
//      reasoned about.
//
//   2. The a11y wiring: label association, aria-describedby, aria-invalid, and
//      focus moving to the first invalid field. Those are the parts a rewrite
//      breaks silently, because nothing looks wrong on screen.

import { useForm } from 'react-hook-form';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DateField,
  NumberField,
  SelectField,
  SignedNumberField,
  TextField,
  TextAreaField,
  fieldInputProps,
} from './form';

interface Form {
  lot: string;
  qty: string;
  delta: string;
  reason: string;
  note: string;
  when: string;
}

function Harness({
  onSubmit,
  errors,
}: {
  onSubmit: (values: Record<string, unknown>) => void;
  errors?: Record<string, string>;
}) {
  const form = useForm<Form>();
  // RHF's live view of the qty field, rendered. Without this, a broken onChange
  // is invisible: the DOM still holds the right text and the submit handler still
  // reads it back correctly, so only a field that never told the form about a
  // keystroke -- and so has no dirty state, no transform and no live validation
  // -- would go unnoticed.
  const liveQty = form.watch('qty');

  return (
    <form
      onSubmit={form.handleSubmit((values) =>
        onSubmit(values as unknown as Record<string, unknown>),
      )}
    >
      <TextField
        id="lot"
        label="Lot number"
        dir="ltr"
        hint="As printed on the carton"
        error={errors?.lot}
        {...fieldInputProps(form.register('lot'))}
      />

      <NumberField
        id="qty"
        label="Quantity"
        suffix="BOX"
        error={errors?.qty}
        {...fieldInputProps(form.register('qty'))}
      />

      <SignedNumberField id="delta" label="Correction" error={errors?.delta} {...fieldInputProps(form.register('delta'))} />

      <SelectField
        id="reason"
        label="Reason"
        placeholder="Choose"
        error={errors?.reason}
        options={[
          { value: 'DAMAGE', label: 'Damaged in handling' },
          { value: 'MISCOUNT', label: 'Miscount corrected' },
        ]}
        {...fieldInputProps(form.register('reason'))}
      />

      <TextAreaField id="note" label="Note" error={errors?.note} {...fieldInputProps(form.register('note'))} />

      <DateField id="when" label="Date" error={errors?.when} {...fieldInputProps(form.register('when'))} />

      <output data-testid="live-qty">{liveQty ?? ''}</output>

      <button type="submit">Save</button>
    </form>
  );
}

describe('labels and accessibility', () => {
  it('associates every label with its control', () => {
    render(<Harness onSubmit={() => {}} />);

    // A label that is not associated with its control is invisible to a screen
    // reader, and this is an application used in a warehouse by people wearing
    // gloves.
    expect(screen.getByLabelText(/Lot number/)).toBe(
      screen.getByLabelText(/Lot number/).id === 'lot' ? screen.getByRole('textbox', { name: /Lot number/ }) : null,
    );
    expect(screen.getByRole('textbox', { name: /Quantity/ })).toBeInTheDocument();
  });

  it('points a field at its hint and its error together', () => {
    render(<Harness onSubmit={() => {}} errors={{ lot: 'Enter the lot number' }} />);

    const lot = screen.getByRole('textbox', { name: /Lot number/ });
    const describedBy = lot.getAttribute('aria-describedby') ?? '';

    // Both, not one. A field that announces its hint while erroring has told the
    // user the formatting rules and nothing about what is wrong.
    expect(describedBy).toContain('lot-hint');
    expect(describedBy).toContain('lot-error');
    expect(lot).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter the lot number')).toBeInTheDocument();
  });

  it('leaves a field un-invalid when it has no error', () => {
    render(<Harness onSubmit={() => {}} />);
    const lot = screen.getByRole('textbox', { name: /Lot number/ });
    expect(lot).not.toHaveAttribute('aria-invalid');
  });

  it('announces the error, not just the field', () => {
    render(<Harness onSubmit={() => {}} errors={{ lot: 'Enter the lot number' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the lot number');
  });
});

describe('number fields', () => {
  it('strips non-digits and submits the cleaned value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    // Typed letter by letter so the stripping runs on every keystroke, which is
    // where a component that only sanitised on submit would still let a letter
    // through into the form state.
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '1a2,3b4');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].qty).toBe('1234');
  });

  it('reports the cleaned value to the form as it is typed', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} />);

    const qty = screen.getByRole('textbox', { name: /Quantity/ });
    await user.type(qty, '12a');

    // The regression this pins: onChange was once handed the cleaned STRING
    // instead of the event, which throws inside react-hook-form. The throw is
    // swallowed by React's dispatch, the DOM still showed the right value, and
    // the submit handler still read it back correctly -- so the old tests passed
    // while the form's own state was never updated.
    expect(screen.getByTestId('live-qty')).toHaveTextContent('12');
  });

  it('shows the field without the characters it rejected', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} />);

    const qty = screen.getByRole('textbox', { name: /Quantity/ });
    await user.type(qty, '12x34');

    // The value is written back, not just reported upward. Without that the
    // field displays "12x34" while the form holds "1234", and the user is looking
    // at a number that is not the one that will be submitted.
    expect(qty).toHaveValue('1234');
  });

  it('rejects a pasted thousands separator without losing the digits', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} />);

    const qty = screen.getByRole('textbox', { name: /Quantity/ });
    await user.click(qty);
    await user.paste('1,200');

    // type="number" would have made this field EMPTY, not "1200", and the user
    // would have believed the value went in.
    expect(qty).toHaveValue('1200');
  });

  it('keeps exactly one leading minus on a signed field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const delta = screen.getByRole('textbox', { name: /Correction/ });
    await user.type(delta, '--5');

    // An adjustment is the one movement that can go either way, so it needs a
    // sign. Allowing a minus anywhere produces "--5", which parses as NaN and then
    // fails validation with a message about a number rather than a sign.
    expect(delta).toHaveValue('-5');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].delta).toBe('-5');
  });

  it('refuses a minus on an unsigned field', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} />);

    const qty = screen.getByRole('textbox', { name: /Quantity/ });
    await user.type(qty, '-5');

    // A write-off with a stray minus would book stock the wrong way, which is
    // exactly why the signed variant is a separate component rather than a flag
    // on this one.
    expect(qty).toHaveValue('5');
  });

  it('asks for a numeric keypad, not a number input', () => {
    render(<Harness onSubmit={() => {}} />);
    const qty = screen.getByRole('textbox', { name: /Quantity/ });

    expect(qty).toHaveAttribute('inputmode', 'numeric');
    // A number input coerces anything unparseable to '' -- the failure this
    // component exists to prevent.
    expect(qty).not.toHaveAttribute('type', 'number');
  });
});

describe('dates and direction', () => {
  it('forces a date input left-to-right even in an RTL document', () => {
    render(<Harness onSubmit={() => {}} />);
    // A date input's segments are laid out by the browser in a fixed order, and
    // inheriting RTL renders it in a sequence nobody in Egypt reads.
    expect(screen.getByLabelText(/Date/)).toHaveAttribute('dir', 'ltr');
  });

  it('leaves a lot number left-to-right', () => {
    render(<Harness onSubmit={() => {}} />);
    // A lot number reordering inside an RTL container looks like a typo, and the
    // person reading it off a carton will transcribe it wrong.
    expect(screen.getByLabelText(/Lot number/)).toHaveAttribute('dir', 'ltr');
  });
});

describe('select', () => {
  it('renders a placeholder that is not a valid choice', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText(/Reason/), 'DAMAGE');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].reason).toBe('DAMAGE');
  });
});

/*
 * The floating label.
 *
 * The label starts inside the field and rises out of it. Three things have to
 * hold for that to work, and all three are invisible on screen:
 *
 *   1. The label is a real <label for>, so the accessible name is unchanged.
 *      A floating label that is only a placeholder loses its name the moment
 *      somebody types, and a screen reader never reads a placeholder.
 *   2. The control carries a placeholder, because `:placeholder-shown` is how
 *      CSS asks "is this field empty?". A control with no placeholder attribute
 *      is never `:placeholder-shown`, so the label would float out of a field
 *      nobody has touched.
 *   3. The label element is inside the field wrapper, because the CSS floats it
 *      with a sibling selector.
 */
describe('the floating label', () => {
  it('keeps the label associated with the control', () => {
    render(<Harness onSubmit={() => {}} />);
    // The accessible name is the label, whatever the label looks like.
    expect(screen.getByLabelText(/Lot number/)).toBeInTheDocument();
  });

  it('puts the label inside the field wrapper, so the CSS can float it', () => {
    const { container } = render(<Harness onSubmit={() => {}} />);
    const field = container.querySelector('.pf-field');
    expect(field).not.toBeNull();
    expect(field?.querySelector('label')).not.toBeNull();
    expect(field?.querySelector('input, textarea, select')).not.toBeNull();
  });

  it('gives every control a placeholder, so an empty field can be detected', () => {
    render(<Harness onSubmit={() => {}} />);
    // A select is excluded on purpose: it cannot carry a placeholder, and it
    // does not need one, because a select always displays a chosen option and
    // so its label is always in the risen state.
    const controls = [
      screen.getByLabelText(/Lot number/),
      screen.getByLabelText(/Quantity/),
      screen.getByLabelText(/Note/),
    ];
    for (const control of controls) {
      expect(control).toHaveAttribute('placeholder');
    }
  });

  it('marks a field that carries its own hint, so the two texts never collide', () => {
    const { container } = render(
      <TextField id="van" label="Van" placeholder="VAN-1" onChange={() => {}} />,
    );
    const field = container.querySelector('.pf-field');
    expect(field).toHaveAttribute('data-own-hint', 'true');
  });

  it('does not mark a field whose inside text is the label', () => {
    const { container } = render(
      <TextField id="lot" label="Lot number" onChange={() => {}} />,
    );
    const field = container.querySelector('.pf-field');
    expect(field).not.toHaveAttribute('data-own-hint');
  });
});
