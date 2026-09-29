import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import buttonCss from '#/shared/view/Button.module.css?raw';
import fieldCss from '#/shared/view/Field.module.css?raw';
import { SelectField } from '#/shared/view/Field.tsx';
import { FilterBar } from '#/shared/view/FilterBar.tsx';
import filterCss from '#/shared/view/FilterBar.module.css?raw';
import tokens from '#/shared/view/tokens.css?raw';
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

const STATUS = [
  { id: 'any', label: 'Any status' },
  { id: 'true', label: 'Enabled' },
];

function withStatus() {
  return (
    <FilterBar
      label="Filter subjects"
      fields={FIELDS}
      field="username"
      query="ada"
      onSearch={vi.fn()}
      onClear={vi.fn()}
      active
      count={<span>2 subjects</span>}
    >
      <SelectField label="Status" options={STATUS} value="true" onChange={vi.fn()} />
    </FilterBar>
  );
}

it('draws a filter with its label beside its trigger, still naming it', () => {
  render(withStatus());
  const trigger = screen.getByRole('button', { name: /Status/u });
  expect(trigger).toHaveTextContent('Enabled');
  const field = trigger.closest('[data-inline]');
  expect(field).not.toBeNull();
  const label = within(field as HTMLElement).getByText('Status');
  expect(trigger.getAttribute('aria-labelledby')?.split(' ')).toContain(label.id);
});

it('carries the count in the bar, beside Clear filters', () => {
  render(withStatus());
  const bar = screen.getByRole('search', { name: 'Filter subjects' });
  expect(within(bar).getByText('2 subjects')).toBeVisible();
  expect(within(bar).getByRole('button', { name: 'Clear filters' })).toBeVisible();
});

function rule(css: string, selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const found = [...source.matchAll(/([^{}]+)\{([^}]*)\}/gu)].find(
    ([, head = '']) => head.trim() === selector,
  );
  return found?.[2] ?? '';
}

it('gives every control in the bar one height, from one token', () => {
  expect(tokens).toMatch(/--control-height:\s*32px;/u);
  const HEIGHT = /block-size:\s*var\(--control-height\)/u;
  for (const selector of ['.chip', '.input', '.shortcut', '.count']) {
    expect(rule(filterCss, selector), selector).toMatch(HEIGHT);
  }
  expect(rule(buttonCss, '.button')).toMatch(HEIGHT);
  expect(rule(fieldCss, '.field[data-inline] .trigger')).toMatch(HEIGHT);
  expect(rule(filterCss, '.bar')).toMatch(/align-items:\s*center/u);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(withStatus)).toEqual({ light: [], dark: [] });
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
