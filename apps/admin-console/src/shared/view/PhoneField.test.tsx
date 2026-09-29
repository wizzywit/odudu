import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nProvider } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { PhoneField } from '#/shared/view/PhoneField.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function Controlled({ start = '' }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <I18nProvider locale="en-GB">
      <PhoneField label="Phone number" value={value} onChange={setValue} />
      <output aria-label="Stored">{value}</output>
    </I18nProvider>
  );
}

function stored(): string {
  return screen.getByLabelText('Stored').textContent;
}

describe('PhoneField', () => {
  it('stores E.164 from a country and a number dialled at home', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const group = screen.getByRole('group', { name: 'Phone number' });
    await user.type(within(group).getByRole('combobox', { name: 'Country' }), 'Niger');
    await user.click(await screen.findByRole('option', { name: 'Nigeria' }));
    await user.type(within(group).getByRole('textbox', { name: 'Number' }), '0803 123 4567');
    expect(stored()).toBe('+2348031234567');
    expect(group).toHaveTextContent('Stored as +2348031234567');
  });

  it('opens a stored number under its country', () => {
    render(<Controlled start="+447700900123" />);
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('United Kingdom');
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveValue('7700900123');
  });

  it('asks for the country of a number stored without one', () => {
    render(<Controlled start="555-2671" />);
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveValue('555-2671');
    expect(screen.getByRole('group', { name: 'Phone number' })).toHaveAccessibleDescription(
      /Choose the country the number is in\./u,
    );
  });

  it('carries the telephone autofill tokens', () => {
    render(<Controlled />);
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveAttribute(
      'autocomplete',
      'tel-country-code',
    );
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveAttribute(
      'autocomplete',
      'tel-national',
    );
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveAttribute('type', 'tel');
  });

  it('clears the stored number when the number is emptied', async () => {
    const user = userEvent.setup();
    render(<Controlled start="+2348031234567" />);
    await user.clear(screen.getByRole('textbox', { name: 'Number' }));
    expect(stored()).toBe('');
  });

  it('reads as text on a page that cannot change it', () => {
    render(
      <ReadOnlyFields when>
        <PhoneField label="Phone number" value="+2348031234567" onChange={vi.fn()} />
      </ReadOnlyFields>,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('+2348031234567')).toBeInTheDocument();
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <PhoneField
          label="Phone number"
          value="+2348031234567"
          onChange={vi.fn()}
          error="Not a number."
          changed
        />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});
