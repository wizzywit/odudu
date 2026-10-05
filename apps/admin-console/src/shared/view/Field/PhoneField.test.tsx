import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nProvider } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import { OwnDataFields, ReadOnlyFields } from '#/shared/view/Field/Field.tsx';
import { PhoneField } from '#/shared/view/Field/PhoneField.tsx';
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
    expect(group).toHaveTextContent('Stored as +2348031234567, which reads +234 803 123 4567.');
  });

  it('names its parts for a screen reader only, each a control of one height', () => {
    render(<Controlled start="+447700900123;ext=12" />);
    const group = screen.getByRole('group', { name: 'Phone number' });
    for (const name of ['Country', 'Number', 'Extension']) {
      expect(within(group).getByText(name).closest('[style]'), name).toHaveStyle({
        position: 'absolute',
      });
    }
    expect(group.querySelectorAll('[data-control]')).toHaveLength(3);
  });

  it('shows each part the words its name starts with, for speech input', () => {
    render(<Controlled />);
    for (const name of ['Country', 'Number', 'Extension']) {
      const control = screen.getByRole(name === 'Country' ? 'combobox' : 'textbox', { name });
      expect(control).toHaveAttribute('placeholder', name);
    }
  });

  it('opens a stored number under its country', () => {
    render(<Controlled start="+447700900123" />);
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('United Kingdom');
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveValue('7700900123');
  });

  it('asks for the country of a number stored without one, on the country', () => {
    render(<Controlled start="555-2671" />);
    const number = screen.getByRole('textbox', { name: 'Number' });
    expect(number).toHaveValue('555-2671');
    const country = screen.getByRole('combobox', { name: 'Country' });
    expect(country).toHaveAttribute('aria-invalid', 'true');
    expect(country).toHaveAccessibleDescription(/Choose the country the number is in\./u);
    expect(number).not.toHaveAttribute('aria-invalid');
  });

  it('puts a problem with the number on the number', async () => {
    const user = userEvent.setup();
    render(<Controlled start="+2348031234567" />);
    const number = screen.getByRole('textbox', { name: 'Number' });
    await user.type(number, 'x');
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(number).toHaveAccessibleDescription(/Use digits only/u);
    expect(screen.getByRole('combobox', { name: 'Country' })).not.toHaveAttribute('aria-invalid');
  });

  it('judges nothing while a calling code is still being typed', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const number = screen.getByRole('textbox', { name: 'Number' });
    await user.type(number, '+23');
    expect(number).not.toHaveAttribute('aria-invalid');
  });

  it('says on the number when it is too short for its country', async () => {
    const user = userEvent.setup();
    render(<Controlled start="+2348031234567" />);
    const number = screen.getByRole('textbox', { name: 'Number' });
    await user.clear(number);
    await user.type(number, '0803');
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(number).toHaveAccessibleDescription(/Too short for a phone number in this country\./u);
  });

  it('reads a pasted international number for its country', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('textbox', { name: 'Number' }));
    await user.paste('+234 803 123 4567');
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('Nigeria');
    expect(screen.getByRole('textbox', { name: 'Number' })).toHaveValue('8031234567');
    expect(stored()).toBe('+2348031234567');
  });

  it('shows a stored extension, and removes it when it is emptied', async () => {
    const user = userEvent.setup();
    render(<Controlled start="+14155550100;ext=12" />);
    const extension = screen.getByRole('textbox', { name: 'Extension' });
    expect(extension).toHaveValue('12');
    await user.clear(extension);
    expect(stored()).toBe('+14155550100');
    await user.type(extension, '7');
    expect(stored()).toBe('+14155550100;ext=7');
  });

  it('carries the telephone autofill token on the number, which autofill can fill', () => {
    render(
      <OwnDataFields when>
        <Controlled />
      </OwnDataFields>,
    );
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveAttribute(
      'autocomplete',
      'off',
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
    expect(screen.getByText('+234 803 123 4567')).toBeInTheDocument();
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

it('offers no autofill on another person’s record', () => {
  const { container } = render(
    <OwnDataFields when={false}>
      <PhoneField label="Phone number" value="" onChange={vi.fn()} />
    </OwnDataFields>,
  );
  const tokens = [...container.querySelectorAll('input, select')].map((e) =>
    e.getAttribute('autocomplete'),
  );
  expect(tokens.filter((t) => t !== null && t !== 'off')).toEqual([]);
});
