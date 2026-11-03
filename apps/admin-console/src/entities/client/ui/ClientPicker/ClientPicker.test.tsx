import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { PickerState } from '#/shared/services/picker';
import { ClientPicker } from '#/entities/client/ui/ClientPicker/ClientPicker';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { pickerState } from '#/testing/pickerState';

const CLIENTS = [
  { id: 'c1', name: 'Billing', client_id: 'billing', type: 'confidential' as const },
  { id: 'c2', name: 'Portal', client_id: 'portal', type: 'public' as const },
];

function picker(overrides: Partial<PickerState<(typeof CLIENTS)[number]>> = {}) {
  return pickerState(CLIENTS, overrides);
}

it('names each client and its client id, so two of one name are told apart', () => {
  render(<ClientPicker label="Client" picker={picker()} selected={[]} onChange={vi.fn()} />);
  const options = within(screen.getByRole('listbox', { name: 'Client' })).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'Billingbilling · confidential',
    'Portalportal · public',
  ]);
});

it('chooses one client, searched by name', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const search = vi.fn();
  render(
    <ClientPicker
      label="Client"
      picker={picker({ search })}
      selected={[]}
      onChange={onChange}
      selectionMode="single"
    />,
  );
  await user.click(screen.getByRole('option', { name: /Portal/u }));
  expect(onChange).toHaveBeenCalledWith(['c2']);
  await user.type(screen.getByRole('searchbox', { name: 'Search clients by name' }), 'bil');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(search).toHaveBeenCalledWith('bil');
});

it('names manage-clients when the list is refused', () => {
  render(
    <ClientPicker
      label="Client"
      picker={picker({ status: 'refused', options: [] })}
      selected={[]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent('manage-clients');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => <ClientPicker label="Client" picker={picker()} selected={['c1']} onChange={vi.fn()} />,
      () => screen.findByRole('listbox', { name: 'Client' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
