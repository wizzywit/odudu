import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { OptionalSecondsField } from '#/features/clients/view/ClientRecordPage/OptionalSecondsField.tsx';
import { ReadOnlyFields } from '#/shared/view/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function Field({
  initial,
  onChange,
}: {
  initial: number | null;
  onChange?: (v: number | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <OptionalSecondsField
      label="Access token lifetime"
      offLabel="Use the tenant's access token lifetime"
      offText="Takes the tenant's."
      rule="Between 1 s and 3600 s · 1 hour."
      value={value}
      start={300}
      min={1}
      max={3600}
      error={undefined}
      changed={false}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

it('says where the default comes from while it is taken, and shows no number', () => {
  render(<Field initial={null} />);
  expect(screen.getByText("Takes the tenant's.")).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('starts from the value given when the default is turned off, with its duration reading', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Field initial={null} onChange={onChange} />);
  await user.click(screen.getByRole('switch', { name: "Use the tenant's access token lifetime" }));
  expect(onChange).toHaveBeenCalledWith(300);
  expect(screen.getByRole('textbox', { name: 'Access token lifetime, in seconds' })).toHaveValue(
    '300',
  );
  expect(screen.getByText('300 s · 5 minutes')).toBeVisible();
});

it('hands the default back, as null', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Field initial={600} onChange={onChange} />);
  await user.click(screen.getByRole('switch', { name: "Use the tenant's access token lifetime" }));
  expect(onChange).toHaveBeenCalledWith(null);
});

it('keeps the value it had when the number is cleared', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Field initial={600} onChange={onChange} />);
  const input = screen.getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await user.clear(input);
  await user.tab();
  expect(onChange).not.toHaveBeenCalledWith(Number.NaN);
});

it('is text, with its reading, on a page that cannot be changed', () => {
  render(
    <ReadOnlyFields when>
      <Field initial={600} />
    </ReadOnlyFields>,
  );
  expect(screen.getByText('600 s · 10 minutes')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
});

it('passes axe in both themes, given and taken from the default', async () => {
  expect(await axeInBothThemes(() => <Field initial={600} />)).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => <Field initial={null} />)).toEqual({ light: [], dark: [] });
});
