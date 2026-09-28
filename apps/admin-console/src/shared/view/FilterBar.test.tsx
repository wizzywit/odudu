import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { FilterBar } from '#/shared/view/FilterBar.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const FIELDS = [
  { id: 'username', label: 'username' },
  { id: 'email', label: 'email' },
];

it('is a named search form that submits on Enter and shows it', async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  render(
    <FilterBar
      label="Filter subjects"
      fields={FIELDS}
      field="username"
      query=""
      onSearch={onSearch}
    />,
  );
  expect(screen.getByRole('search', { name: 'Filter subjects' })).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: 'Search by username' }), 'ada{Enter}');
  expect(onSearch).toHaveBeenLastCalledWith({ field: 'username', query: 'ada' });
  expect(screen.getByText('Enter', { selector: 'kbd' })).toBeVisible();
});

it('names the field it searches with a visible chip that can be changed', async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  render(
    <FilterBar
      label="Filter subjects"
      fields={FIELDS}
      field="username"
      query="ad"
      onSearch={onSearch}
    />,
  );
  await user.click(screen.getByRole('button', { name: /Search field/u }));
  await user.click(screen.getByRole('option', { name: 'email' }));
  expect(screen.getByRole('searchbox', { name: 'Search by email' })).toHaveValue('ad');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(onSearch).toHaveBeenLastCalledWith({ field: 'email', query: 'ad' });
});

it('shows a single field as fixed text', () => {
  render(
    <FilterBar
      label="Filter groups"
      fields={[{ id: 'name', label: 'name' }]}
      field="name"
      query=""
      onSearch={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: /Search field/u })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Search by name' })).toBeInTheDocument();
});

it('offers to clear only while something is filtered', async () => {
  const user = userEvent.setup();
  const onClear = vi.fn();
  const { rerender } = render(
    <FilterBar
      label="Filter subjects"
      fields={FIELDS}
      field="username"
      query=""
      onSearch={vi.fn()}
      onClear={onClear}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  rerender(
    <FilterBar
      label="Filter subjects"
      fields={FIELDS}
      field="username"
      query="ada"
      onSearch={vi.fn()}
      onClear={onClear}
      active
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(onClear).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <FilterBar
        label="Filter subjects"
        fields={FIELDS}
        field="username"
        query="ada"
        onSearch={vi.fn()}
        onClear={vi.fn()}
        active
      >
        <span>Enabled only</span>
      </FilterBar>
    )),
  ).toEqual({ light: [], dark: [] });
});
