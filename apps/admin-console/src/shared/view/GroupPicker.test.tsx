import type { Group } from '@odudu/contracts/admin';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { PickerState } from '#/shared/service/picker.ts';
import { GroupPicker } from '#/shared/view/GroupPicker.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

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

const GROUPS: readonly Group[] = [
  {
    id: 'g1',
    name: 'engineering',
    description: null,
    parent_id: null,
    default_for_new_subjects: false,
    path: '/engineering',
    created_at: '2026-09-28T13:41:05Z',
    admin_reach: [],
  },
  {
    id: 'g2',
    name: 'platform',
    description: null,
    parent_id: 'g1',
    default_for_new_subjects: false,
    path: '/engineering/platform',
    created_at: '2026-09-28T13:41:05Z',
    admin_reach: [],
  },
];

it('shows each group where it sits in the tree', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<GroupPicker label="Groups" picker={picker(GROUPS)} selected={[]} onChange={onChange} />);
  const options = within(screen.getByRole('listbox', { name: 'Groups' })).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'engineering/engineering',
    'platform/engineering/platform',
  ]);
  await user.click(options[1] ?? document.body);
  expect(onChange).toHaveBeenCalledWith(['g2']);
});

it("shows a group's description beside its place in the tree", () => {
  const described = { ...GROUPS[0], description: 'Everybody who ships code' } as Group;
  render(
    <GroupPicker label="Groups" picker={picker([described])} selected={[]} onChange={vi.fn()} />,
  );
  const option = within(screen.getByRole('listbox', { name: 'Groups' })).getByRole('option');
  expect(option).toHaveTextContent('engineering/engineering · Everybody who ships code');
});

it('says why a group cannot be chosen, and does not choose it', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <GroupPicker
      label="Parent"
      picker={picker(GROUPS)}
      selected={[]}
      onChange={onChange}
      selectionMode="single"
      unavailableOf={(group) => (group.id === 'g2' ? 'the group itself' : null)}
    />,
  );
  const option = within(screen.getByRole('listbox', { name: 'Parent' })).getByRole('option', {
    name: /platform/u,
  });
  expect(option).toHaveTextContent('/engineering/platform · the group itself');
  await user.click(option);
  expect(onChange).not.toHaveBeenCalled();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <GroupPicker label="Groups" picker={picker(GROUPS)} selected={['g1']} onChange={vi.fn()} />
    )),
  ).toEqual({ light: [], dark: [] });
});
