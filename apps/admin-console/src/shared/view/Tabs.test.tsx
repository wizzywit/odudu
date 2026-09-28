import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Tabs } from '#/shared/view/Tabs.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const TABS = [
  { id: 'general', label: 'General', panel: <p>General settings</p> },
  { id: 'tokens', label: 'Tokens', dirty: true, panel: <p>Token lifetimes</p> },
  { id: 'advanced', label: 'Advanced', panel: <p>Advanced settings</p> },
];

it('names its tab list and shows the first panel', () => {
  render(<Tabs label="Client sections" tabs={TABS} />);
  expect(screen.getByRole('tablist', { name: 'Client sections' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('General settings');
});

it('moves between tabs with the arrow, Home and End keys', async () => {
  const user = userEvent.setup();
  render(<Tabs label="Client sections" tabs={TABS} />);
  await user.tab();
  expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: /^Tokens/u })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Token lifetimes');
  await user.keyboard('{End}');
  expect(screen.getByRole('tab', { name: 'Advanced' })).toHaveFocus();
  await user.keyboard('{Home}');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('General settings');
});

it('says in words that a tab holds unsaved changes', () => {
  render(<Tabs label="Client sections" tabs={TABS} />);
  expect(screen.getByRole('tab', { name: 'Tokens, unsaved changes' })).toBeInTheDocument();
});

it('reports a selection it is told to control', async () => {
  const user = userEvent.setup();
  const onSelectionChange = vi.fn();
  render(
    <Tabs
      label="Client sections"
      tabs={TABS}
      selectedKey="general"
      onSelectionChange={onSelectionChange}
    />,
  );
  await user.click(screen.getByRole('tab', { name: 'Advanced' }));
  expect(onSelectionChange).toHaveBeenCalledWith('advanced');
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Tabs label="Client sections" tabs={TABS} />)).toEqual({
    light: [],
    dark: [],
  });
});
