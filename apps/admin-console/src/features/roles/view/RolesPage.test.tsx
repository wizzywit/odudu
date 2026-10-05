import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { R, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/roles';

it('lists roles, a client role and an admin capability told apart from a tenant role', async () => {
  renderConsoleAt(AT, roleRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Roles' });
  expect(within(table).getByRole('row', { name: /auditor/u })).toHaveTextContent('tenant role');
  expect(within(table).getByRole('row', { name: /auditor/u })).toHaveTextContent('Reads the books');
  const readers = within(table).getAllByRole('row', { name: /reader/u });
  expect(readers.map((row) => row.textContent)).toEqual([
    expect.stringContaining('tenant role'),
    expect.stringContaining('role of client portal'),
  ]);
  expect(within(table).getByRole('row', { name: /tenant-admin/u })).toHaveTextContent(
    'admin capability',
  );
  expect(screen.getByRole('link', { name: 'Create a role' })).toHaveAttribute(
    'href',
    '/console/acme/roles/new',
  );
});

it('narrows to the tenant roles, and opens a role from its row', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(AT, roleRoutes());
  await screen.findByRole('grid', { name: 'Roles' });
  await user.click(screen.getByRole('button', { name: /Belongs to/u }));
  await user.click(await screen.findByRole('option', { name: 'Tenant roles' }));
  await waitFor(() => {
    expect(sent.at(-1)?.search.get('client')).toBe('tenant');
  });
  await user.click(await screen.findByRole('row', { name: /auditor/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-aud');
  });
});

it("says when the list is one client's roles, with the way back to all of them", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(`${AT}?client=c-portal`, roleRoutes());
  expect(await screen.findByText(/Only the roles of client/u)).toBeVisible();
  expect(sent.find((s) => s.path === R)?.search.get('client')).toBe('c-portal');
  await user.click(screen.getByRole('button', { name: 'Show every role' }));
  await waitFor(() => {
    expect(sent.at(-1)?.search.get('client')).toBeNull();
  });
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, roleRoutes()).element,
      () => screen.findByRole('grid', { name: 'Roles' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, roleRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
