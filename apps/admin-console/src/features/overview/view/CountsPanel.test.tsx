import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { CountTile } from '#/features/overview/service.ts';
import { CountsPanel } from '#/features/overview/view/CountsPanel.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const retry = vi.fn();

const TILES: readonly CountTile[] = [
  {
    id: 'subjects',
    label: 'Subjects',
    href: '/console/acme/subjects',
    noun: { one: 'subject', other: 'subjects' },
    count: { status: 'ready', data: { count: 10_000, capped: true } },
  },
  {
    id: 'clients',
    label: 'Clients',
    href: '/console/acme/clients',
    noun: { one: 'client', other: 'clients' },
    count: { status: 'ready', data: { count: 12, capped: false } },
    limit: 200,
  },
  {
    id: 'groups',
    label: 'Groups',
    href: '/console/acme/groups',
    noun: { one: 'group', other: 'groups' },
    count: { status: 'needs', capability: 'manage-tenant' },
  },
  {
    id: 'roles',
    label: 'Roles',
    href: '/console/acme/roles',
    noun: { one: 'role', other: 'roles' },
    count: { status: 'failed', refused: false, retry },
  },
  {
    id: 'scopes',
    label: 'Scopes',
    href: '/console/acme/scopes',
    noun: { one: 'scope', other: 'scopes' },
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
  render(<CountsPanel tiles={TILES} />);
  expect(screen.getByRole('link', { name: 'Subjects' })).toHaveAttribute(
    'href',
    '/console/acme/subjects',
  );
  expect(tile('Subjects')).toHaveTextContent('10,000+ subjects');
  expect(tile('Clients')).toHaveTextContent('12 clients of 200 allowed');
});

it('names the capability a count needs, and says when one is still counting', () => {
  render(<CountsPanel tiles={TILES} />);
  expect(within(tile('Groups')).getByRole('note')).toHaveTextContent(
    'Needs the manage-tenant capability.',
  );
  expect(tile('Scopes')).toHaveTextContent('Counting…');
  expect(tile('Scopes').querySelector('[aria-hidden="true"]')).not.toBeNull();
});

it('offers to count a failed one again', async () => {
  const user = userEvent.setup();
  render(<CountsPanel tiles={TILES} />);
  expect(tile('Roles')).toHaveTextContent('Could not be counted');
  await user.click(screen.getByRole('button', { name: 'Count roles again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <CountsPanel tiles={TILES} />)).toEqual({
    light: [],
    dark: [],
  });
});
