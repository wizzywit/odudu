import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { setModel } from '#/widgets/assistant-panel/services/approval';
import { SetDiff } from '#/widgets/assistant-panel/ui/SetDiff';

const names = (count: number) => Array.from({ length: count }, (_, i) => `role-${String(i)}`);

function drawn(added: string[], removed: string[]) {
  const set = setModel({ kind: 'set', added, removed });
  if (set === null) throw new Error('no set');
  return <SetDiff set={set} label="Change" />;
}

it('says which names are added and which removed, each side counted, every name whole', () => {
  render(drawn(['auditors', 'billing-admins-of-the-eu-west-region'], ['guests']));
  const group = screen.getByRole('group', { name: 'Change' });
  expect(within(group).getByText('Adds: 2 names')).toBeInTheDocument();
  expect(within(group).getByText('Removes: 1 name')).toBeInTheDocument();
  expect(within(group).getByText('billing-admins-of-the-eu-west-region')).toBeInTheDocument();
  expect(within(group).getAllByRole('listitem')).toHaveLength(3);
});

it('says nothing is added or removed rather than drawing an empty list', () => {
  render(drawn([], ['guests']));
  expect(screen.getByText('Adds: 0 names')).toBeInTheDocument();
  expect(screen.getByText('Nothing')).toBeInTheDocument();
});

it('draws a card for forty names a side as lists a person can read', () => {
  render(
    drawn(
      names(40),
      names(40).map((name) => `old-${name}`),
    ),
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(80);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => drawn(names(3), ['guests']))).toEqual({
    light: [],
    dark: [],
  });
});
