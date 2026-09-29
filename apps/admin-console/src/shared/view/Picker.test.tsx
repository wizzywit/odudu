import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { PickerState } from '#/shared/service/picker.ts';
import pickerCss from '#/shared/view/Picker.module.css?raw';
import { Picker } from '#/shared/view/Picker.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

interface Scope {
  readonly id: string;
  readonly name: string;
}

const SCOPES: readonly Scope[] = [
  { id: 's1', name: 'profile' },
  { id: 's2', name: 'email' },
];

function state(overrides: Partial<PickerState<Scope>> = {}): PickerState<Scope> {
  return {
    status: 'ready',
    options: SCOPES,
    query: '',
    search: vi.fn(),
    more: false,
    loadingMore: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function scopes(picker: PickerState<Scope>, onChange = vi.fn(), selected: readonly string[] = []) {
  return (
    <Picker
      label="Scopes"
      noun={{ one: 'scope', other: 'scopes' }}
      picker={picker}
      idOf={(scope) => scope.id}
      nameOf={(scope) => scope.name}
      detailOf={() => 'assigned by default'}
      capability="manage-tenant"
      selected={selected}
      onChange={onChange}
    />
  );
}

it('offers every option with its detail, and reports the ids chosen', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(scopes(state(), onChange, ['s2']));
  expect(screen.getByRole('option', { name: 'email' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('option', { name: 'profile' }));
  expect(onChange).toHaveBeenCalledWith(['s2', 's1']);
});

it('marks an option that cannot be chosen, says why, and never reports it', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Picker
      label="Scopes"
      noun={{ one: 'scope', other: 'scopes' }}
      picker={state()}
      idOf={(scope) => scope.id}
      nameOf={(scope) => scope.name}
      detailOf={() => 'assigned by default'}
      unavailableOf={(scope) => (scope.id === 's1' ? 'already assigned' : null)}
      capability="manage-tenant"
      selected={[]}
      onChange={onChange}
    />,
  );
  const taken = screen.getByRole('option', { name: 'profile' });
  expect(taken).toHaveAttribute('aria-disabled', 'true');
  expect(taken).toHaveAccessibleDescription('assigned by default · already assigned');
  expect(screen.getByRole('option', { name: 'email' })).not.toHaveAttribute('aria-disabled');
  await user.click(taken);
  expect(onChange).not.toHaveBeenCalled();
});

it('says when the list is loading, and when it failed', async () => {
  const user = userEvent.setup();
  const failed = state({ status: 'failed', options: [] });
  const { rerender } = render(scopes(state({ status: 'loading', options: [] })));
  expect(screen.getByRole('status')).toHaveTextContent('Loading scopes');
  expect(screen.getByRole('status').querySelector('[data-shape="list"]')).not.toBeNull();
  rerender(scopes(failed));
  expect(screen.getByRole('alert')).toHaveTextContent('Scopes could not be loaded.');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(failed.retry).toHaveBeenCalledOnce();
});

it('says there is nothing to choose from yet', () => {
  render(scopes(state({ options: [] })));
  expect(screen.getByText('There are no scopes yet.')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => scopes(state({ more: true }), vi.fn(), ['s1']))).toEqual({
    light: [],
    dark: [],
  });
});

it('sizes each option to its content, so a scrolled list never overlaps its rows', () => {
  expect(pickerCss).toMatch(/\.list\s*\{[^}]*grid-auto-rows:\s*max-content/u);
});
