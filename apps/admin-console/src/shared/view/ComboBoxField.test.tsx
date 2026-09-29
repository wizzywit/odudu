import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ComboBoxField, type ComboOption } from '#/shared/view/ComboBoxField.tsx';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const ZONES: readonly ComboOption[] = [
  { id: 'Africa/Lagos', label: 'Africa/Lagos', detail: 'UTC+01:00' },
  { id: 'Europe/Berlin', label: 'Europe/Berlin', detail: 'UTC+01:00' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo', detail: 'UTC+09:00' },
];

function Controlled({ custom = false, start = '' }: { custom?: boolean; start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <ComboBoxField
        label="Time zone"
        options={ZONES}
        value={value}
        onChange={setValue}
        allowsCustomValue={custom}
        autoComplete="off"
      />
      <output aria-label="Stored">{value}</output>
      <button
        type="button"
        onClick={() => {
          setValue('Asia/Tokyo');
        }}
      >
        Reset
      </button>
    </>
  );
}

describe('ComboBoxField', () => {
  it('narrows the list as you type, and stores the chosen option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    await user.type(box, 'tok');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Asia/TokyoUTC+09:00']);
    await user.click(screen.getByRole('option', { name: 'Asia/Tokyo' }));
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Tokyo');
    expect(box).toHaveValue('Asia/Tokyo');
  });

  it('matches what an option shows beside its label', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), '+01');
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Africa/LagosUTC+01:00',
      'Europe/BerlinUTC+01:00',
    ]);
  });

  it('keeps text that names no option when a custom value is allowed', async () => {
    const user = userEvent.setup();
    render(<Controlled custom />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), 'Asia/Calcutta');
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Calcutta');
  });

  it('shows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Controlled start="Africa/Lagos" />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    expect(box).toHaveValue('Africa/Lagos');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(box).toHaveValue('Asia/Tokyo');
  });

  it('opens its whole list from the button, by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Controlled start="Africa/Lagos" />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findAllByRole('option')).toHaveLength(3);
  });

  it('carries the autocomplete token it is given', () => {
    const onChange = vi.fn();
    render(
      <ComboBoxField
        label="Country"
        options={[]}
        value=""
        onChange={onChange}
        autoComplete="country-name"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveAttribute(
      'autocomplete',
      'country-name',
    );
  });

  it('shows its value as text on a page that cannot change it', () => {
    render(
      <ReadOnlyFields when>
        <ComboBoxField label="Time zone" options={ZONES} value="Asia/Tokyo" onChange={vi.fn()} />
      </ReadOnlyFields>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <ComboBoxField
          label="Time zone"
          description="Where the subject is."
          options={ZONES}
          value="Africa/Lagos"
          onChange={vi.fn()}
          error="Not a zone."
          changed
        />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});
