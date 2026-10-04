import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nProvider } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import { BirthdateField } from '#/shared/view/BirthdateField.tsx';
import { OwnDataFields, ReadOnlyFields } from '#/shared/view/Field.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function Controlled({ start = '', locale = 'en-US' }: { start?: string; locale?: string }) {
  const [value, setValue] = useState(start);
  return (
    <I18nProvider locale={locale}>
      <BirthdateField label="Birthdate" value={value} onChange={setValue} />
      <output aria-label="Stored">{value}</output>
    </I18nProvider>
  );
}

// The form chosen is a select beside the date, not a row of radios.
function known(): HTMLElement {
  return screen.getByRole('button', { name: /What is known of the birthdate/u });
}

async function choose(user: ReturnType<typeof userEvent.setup>, form: string): Promise<void> {
  await user.click(known());
  await user.click(await screen.findByRole('option', { name: form }));
}

function stored(): string {
  return screen.getByLabelText('Stored').textContent;
}

describe('BirthdateField', () => {
  it('takes a full date in the reader’s own order and stores it as YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    render(<Controlled locale="en-GB" />);
    const group = screen.getByRole('group', { name: 'Birthdate' });
    const segments = within(group).getAllByRole('spinbutton');
    expect(segments.map((s) => s.dataset.type)).toEqual(['day', 'month', 'year']);
    await user.click(within(group).getByRole('spinbutton', { name: /^day/u }));
    await user.keyboard('31011990');
    expect(stored()).toBe('1990-01-31');
  });

  it('puts the form chosen and the date on one line, with no radios', () => {
    render(<Controlled start="1990-01-31" />);
    const group = screen.getByRole('group', { name: 'Birthdate' });
    expect(within(group).queryAllByRole('radio')).toEqual([]);
    expect(known()).toHaveTextContent('Full date');
    expect(within(group).getByText('Date').closest('[style]')).toHaveStyle({
      position: 'absolute',
    });
    expect(group.querySelectorAll('[data-control]')).toHaveLength(2);
  });

  it('shows a stored date in its segments', () => {
    render(<Controlled start="1990-01-31" />);
    const segments = within(screen.getByRole('group', { name: 'Birthdate' })).getAllByRole(
      'spinbutton',
    );
    expect(segments.map((s) => s.textContent)).toEqual(['1', '31', '1990']);
  });

  it('stores the year alone when only the year is known', async () => {
    const user = userEvent.setup();
    render(<Controlled start="1990-01-31" />);
    await choose(user, 'Year only');
    expect(stored()).toBe('1990');
    const year = screen.getByRole('textbox', { name: 'Year' });
    await user.clear(year);
    await user.type(year, '1987');
    await user.tab();
    expect(stored()).toBe('1987');
  });

  it('stores 0000-MM-DD when the year is withheld', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await choose(user, 'Day and month');
    await user.click(screen.getByRole('button', { name: /Month/u }));
    await user.click(await screen.findByRole('option', { name: 'February' }));
    expect(stored()).toBe('');
    await user.click(screen.getByRole('button', { name: /Day$/u }));
    await user.click(await screen.findByRole('option', { name: '29' }));
    expect(stored()).toBe('0000-02-29');
  });

  it('opens a stored year or withheld year in its own form', () => {
    const { unmount } = render(<Controlled start="1990" />);
    expect(known()).toHaveTextContent('Year only');
    unmount();
    render(<Controlled start="0000-02-29" />);
    expect(known()).toHaveTextContent('Day and month');
  });

  it('stores a year as it is typed, so Enter saves it', async () => {
    const user = userEvent.setup();
    render(<Controlled start="1990" />);
    const year = screen.getByRole('textbox', { name: 'Year' });
    await user.clear(year);
    await user.type(year, '1987');
    expect(stored()).toBe('1987');
  });

  it('refuses a date in the future, and says so on the date', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const group = screen.getByRole('group', { name: 'Birthdate' });
    await user.click(within(group).getByRole('spinbutton', { name: /^month/u }));
    await user.keyboard('01012999');
    const date = within(group).getAllByRole('spinbutton')[0];
    expect(date).toHaveAccessibleDescription(/A birthdate cannot be in the future\./u);
  });

  it('ties the field’s error to each of its controls', () => {
    render(<BirthdateField label="Birthdate" value="1990" onChange={vi.fn()} error="Refused." />);
    const year = screen.getByRole('textbox', { name: 'Year' });
    expect(year).toHaveAttribute('aria-invalid', 'true');
    expect(year).toHaveAccessibleDescription(/Refused\./u);
  });

  it('carries the bday token for autofill', () => {
    const { container } = render(
      <OwnDataFields when>
        <Controlled />
      </OwnDataFields>,
    );
    expect(container.querySelector('input[autocomplete="bday"]')).not.toBeNull();
  });

  it('says so when the stored value names no day that exists', () => {
    render(<Controlled start="1990-02-31" />);
    expect(screen.getByText(/Stored as 1990-02-31, which names no day/u)).toBeInTheDocument();
  });

  it('reads as text on a page that cannot change it', () => {
    render(
      <I18nProvider locale="en-GB">
        <ReadOnlyFields when>
          <BirthdateField label="Birthdate" value="1990-01-31" onChange={vi.fn()} />
          <BirthdateField label="Other" value="0000-02-29" onChange={vi.fn()} />
        </ReadOnlyFields>
      </I18nProvider>,
    );
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText('31 January 1990')).toBeInTheDocument();
    expect(screen.getByText('29 February, year withheld')).toBeInTheDocument();
  });

  it('passes axe in both themes, in each form', async () => {
    for (const value of ['1990-01-31', '1990', '0000-02-29']) {
      expect(
        await axeInBothThemes(() => (
          <BirthdateField
            label="Birthdate"
            description="As the subject gave it."
            value={value}
            onChange={vi.fn()}
            error="Not a date."
            changed
          />
        )),
      ).toEqual({ light: [], dark: [] });
    }
  });
});

it('offers no autofill on another person’s record', () => {
  const { container } = render(
    <OwnDataFields when={false}>
      <BirthdateField label="Birthdate" value="" onChange={vi.fn()} />
    </OwnDataFields>,
  );
  const tokens = [...container.querySelectorAll('input, select')].map((e) =>
    e.getAttribute('autocomplete'),
  );
  expect(tokens.filter((t) => t !== null && t !== 'off')).toEqual([]);
});
