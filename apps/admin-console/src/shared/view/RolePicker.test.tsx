import type { Role } from '@odudu/contracts/admin';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { PickerState } from '#/shared/service/picker.ts';
import { RolePicker } from '#/shared/view/RolePicker.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function role(id: string, name: string, clientKey: string | null = null): Role {
  return {
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `client-of-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T13:41:05Z',
  };
}

const ROLES = [role('r1', 'auditor'), role('r2', 'admin', 'billing-portal')];

function picker<T>(options: readonly T[], overrides: Partial<PickerState<T>> = {}): PickerState<T> {
  return {
    status: 'ready',
    options,
    query: '',
    search: vi.fn(),
    more: false,
    loadingMore: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

it("names each role's owner: the tenant, or the client it belongs to", () => {
  render(<RolePicker label="Roles" picker={picker(ROLES)} selected={[]} onChange={vi.fn()} />);
  const list = screen.getByRole('listbox', { name: 'Roles' });
  const options = within(list).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'auditortenant role',
    'adminclient billing-portal',
  ]);
  expect(options[1]).toHaveAccessibleName('admin, a role of client billing-portal');
});

it('adds to the selection and keeps what is selected but not on this page', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<RolePicker label="Roles" picker={picker(ROLES)} selected={['r9']} onChange={onChange} />);
  expect(screen.getByText('1 selected')).toBeVisible();
  await user.click(screen.getByRole('option', { name: /^auditor/u }));
  expect(onChange).toHaveBeenCalledWith(['r9', 'r1']);
});

it('picks one when asked for one', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <RolePicker
      label="Composite role"
      picker={picker(ROLES)}
      selected={['r1']}
      onChange={onChange}
      selectionMode="single"
    />,
  );
  await user.click(screen.getByRole('option', { name: /^admin/u }));
  expect(onChange).toHaveBeenCalledWith(['r2']);
});

it('searches on submit and loads further pages in place', async () => {
  const user = userEvent.setup();
  const state = picker(ROLES, { more: true });
  render(<RolePicker label="Roles" picker={state} selected={[]} onChange={vi.fn()} />);
  await user.type(screen.getByRole('searchbox', { name: 'Search roles by name' }), 'aud{Enter}');
  expect(state.search).toHaveBeenCalledWith('aud');
  await user.click(screen.getByRole('button', { name: 'Load more roles' }));
  expect(state.loadMore).toHaveBeenCalledOnce();
});

it('says what it needs when the list is refused, and when nothing matches', () => {
  const { rerender } = render(
    <RolePicker
      label="Roles"
      picker={picker([], { status: 'refused' })}
      selected={[]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'Choosing roles needs the view-users capability.',
  );
  rerender(
    <RolePicker
      label="Roles"
      picker={picker([], { query: 'zz' })}
      selected={[]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText('No roles start with “zz”.')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <RolePicker
        label="Roles"
        picker={picker(ROLES, { more: true })}
        selected={['r2']}
        onChange={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
