import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { OVERVIEW_WORDS } from '#/features/overview/services/overviewWords';
import type { CountTile } from '#/features/overview/services/tiles';
import { CountsPanel } from '#/features/overview/ui/CountsPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const retry = vi.fn();

const TILES: readonly CountTile[] = [
  {
    id: 'subjects',
    label: 'Subjects',
    href: '/console/acme/subjects',
    noun: { one: 'subject', other: 'subjects' },
    againLabel: 'Count subjects again',
    count: { status: 'ready', data: { count: 10_000, capped: true } },
  },
  {
    id: 'clients',
    label: 'Clients',
    href: '/console/acme/clients',
    noun: { one: 'client', other: 'clients' },
    againLabel: 'Count clients again',
    count: { status: 'ready', data: { count: 12, capped: false } },
    allowance: ' of 200 allowed',
  },
  {
    id: 'groups',
    label: 'Groups',
    href: '/console/acme/groups',
    noun: { one: 'group', other: 'groups' },
    againLabel: 'Count groups again',
    count: { status: 'needs', capability: 'manage-tenant' },
  },
  {
    id: 'roles',
    label: 'Roles',
    href: '/console/acme/roles',
    noun: { one: 'role', other: 'roles' },
    againLabel: 'Count roles again',
    count: { status: 'failed', refused: false, retry },
  },
  {
    id: 'scopes',
    label: 'Scopes',
    href: '/console/acme/scopes',
    noun: { one: 'scope', other: 'scopes' },
    againLabel: 'Count scopes again',
    count: { status: 'loading' },
  },
];

function tile(name: string): HTMLElement {
  const link = screen.getByRole('link', { name });
  const item = link.closest('li');
  if (item === null) throw new Error(`no tile for ${name}`);
  return item;
}

it('counts each collection, a capped count as a floor, with a link to its list', () => {
  render(<CountsPanel words={OVERVIEW_WORDS.counts} tiles={TILES} />);
  expect(screen.getByRole('link', { name: 'Subjects' })).toHaveAttribute(
    'href',
    '/console/acme/subjects',
  );
  expect(tile('Subjects')).toHaveTextContent('10,000+ subjects');
  expect(tile('Clients')).toHaveTextContent('12 clients of 200 allowed');
});

it('names the capability a count needs, and says when one is still counting', () => {
  render(<CountsPanel words={OVERVIEW_WORDS.counts} tiles={TILES} />);
  expect(within(tile('Groups')).getByRole('note')).toHaveTextContent(
    'Needs the manage-tenant capability.',
  );
  expect(tile('Scopes')).toHaveTextContent('Counting…');
  expect(tile('Scopes').querySelector('[aria-hidden="true"]')).not.toBeNull();
});

it('offers to count a failed one again', async () => {
  const user = userEvent.setup();
  render(<CountsPanel words={OVERVIEW_WORDS.counts} tiles={TILES} />);
  expect(tile('Roles')).toHaveTextContent('Could not be counted');
  await user.click(screen.getByRole('button', { name: 'Count roles again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <CountsPanel words={OVERVIEW_WORDS.counts} tiles={TILES} />),
  ).toEqual({
    light: [],
    dark: [],
  });
});
