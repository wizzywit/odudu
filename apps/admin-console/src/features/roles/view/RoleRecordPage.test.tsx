import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { A, R, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA, S } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/roles/r-portal';

it("heads a client's role with its owner, and offers no copy of it", async () => {
  renderConsoleAt(AT, roleRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'reader' })).toBeVisible();
  expect(screen.getAllByText('role of client portal')[0]).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Create a copy' })).toBeNull();
  const tabs = screen.getByRole('tablist', { name: 'Role sections' });
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['General', 'Composites', 'Members', 'Activity']);
});

it('lists the subjects the role is assigned to directly', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, { [`GET ${S}`]: json({ items: [ADA] }) }),
  );
  await user.click(await screen.findByRole('tab', { name: 'Members' }));
  expect(await screen.findByRole('grid', { name: 'Holders of reader' })).toHaveTextContent('ada');
  expect(screen.getByText(/assigned to directly/u)).toBeVisible();
  expect(sent.find((s) => s.path === S)?.search.get('role')).toBe('r-portal');
});

it("reads the role's own activity", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, roleRoutes());
  await user.click(await screen.findByRole('tab', { name: 'Activity' }));
  expect(await screen.findByText('No activity on this role yet')).toBeVisible();
  await waitFor(() => {
    const read = sent.find((s) => s.path === `${A}/audit`);
    expect(read?.search.get('resource_type')).toBe('role');
    expect(read?.search.get('resource_id')).toBe('r-portal');
  });
});

it('holds what depends on its composites until they are read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`GET ${R}/r-portal/composites`]: inTurn(
        problem(500, 'about:blank', 'Oops'),
        json({ items: [] }, 200, { etag: '"c"' }),
      ),
    }),
  );
  expect(
    await screen.findByText(/could not be read, so no delete, default or composite/u),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Read it again' }));
  expect(await screen.findByRole('button', { name: 'Delete reader' })).toBeVisible();
});

it('passes axe in both themes, on Members and refused', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, roleRoutes(undefined, { [`GET ${S}`]: json({ items: [ADA] }) })).element,
      async () => {
        await user.click(await screen.findByRole('tab', { name: 'Members' }));
        await screen.findByRole('grid', { name: 'Holders of reader' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, roleRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
