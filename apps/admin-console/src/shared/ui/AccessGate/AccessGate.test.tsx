import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AccessGate, type Access } from '#/shared/ui/AccessGate';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function gate(access: Access, checking: string | null = null) {
  return (
    <AccessGate access={access} title="Groups" kicker="acme" checking={checking}>
      <p>The page</p>
    </AccessGate>
  );
}

it('draws the page for an open area', () => {
  render(gate({ kind: 'open' }));
  expect(screen.getByText('The page')).toBeVisible();
});

it('is not a page where whoami names no such area', () => {
  render(gate({ kind: 'hidden' }));
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(screen.queryByText('The page')).toBeNull();
});

it('names the capability a refused principal needs, under the page title', () => {
  render(gate({ kind: 'refused', capability: 'view-users' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  expect(screen.getByRole('note')).toHaveTextContent('Groups needs the view-users capability.');
  expect(screen.queryByText('The page')).toBeNull();
});

it('says it is checking, and draws nothing of the page, when it has a placeholder', () => {
  render(gate({ kind: 'checking' }, 'Checking access to Groups'));
  expect(screen.getByRole('status')).toHaveTextContent('Checking access to Groups');
  expect(screen.queryByText('The page')).toBeNull();
});

it('draws the page meanwhile when it has no placeholder', () => {
  render(gate({ kind: 'checking' }));
  expect(screen.getByText('The page')).toBeVisible();
});

it('has no accessibility violations in either theme, refused', async () => {
  expect(
    await axeInBothThemes(() => <main>{gate({ kind: 'refused', capability: 'view-users' })}</main>),
  ).toEqual({ light: [], dark: [] });
});
