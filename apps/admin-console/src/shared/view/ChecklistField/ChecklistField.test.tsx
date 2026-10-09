import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import {
  ChecklistField,
  type ChecklistOption,
} from '#/shared/view/ChecklistField/ChecklistField.tsx';
import { ReadOnlyFields } from '#/shared/view/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const OPTIONS: readonly ChecklistOption[] = [
  { id: 'a', label: 'Alpha', description: 'The first.' },
  { id: 'b', label: 'Beta', note: 'Also held through group /ops' },
  { id: 'c', label: 'Gamma', unavailable: 'You do not hold gamma.' },
];

it('checks what is chosen, and hands back the new set in the order offered', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ChecklistField label="Pick" options={OPTIONS} value={['b']} onChange={onChange} />);
  expect(screen.getByRole('group', { name: 'Pick' })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Beta' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
  expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  await user.click(screen.getByRole('checkbox', { name: 'Beta' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('says what each option is, how it is otherwise held, and why one cannot be chosen', () => {
  render(<ChecklistField label="Pick" options={OPTIONS} value={[]} onChange={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Alpha' })).toHaveAccessibleDescription('The first.');
  expect(screen.getByRole('checkbox', { name: 'Beta' })).toHaveAccessibleDescription(
    'Also held through group /ops',
  );
  const gamma = screen.getByRole('checkbox', { name: 'Gamma' });
  expect(gamma).toBeDisabled();
  expect(gamma).toHaveAccessibleDescription('You do not hold gamma.');
});

it('shows the chosen set as text where the page is read only', () => {
  render(
    <ReadOnlyFields when>
      <ChecklistField label="Pick" options={OPTIONS} value={['a', 'b']} onChange={vi.fn()} />
    </ReadOnlyFields>,
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('Alpha, Beta')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <ChecklistField
        label="Pick"
        description="Choose any."
        options={OPTIONS}
        value={['b']}
        changed
        error="Something is wrong."
        onChange={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
