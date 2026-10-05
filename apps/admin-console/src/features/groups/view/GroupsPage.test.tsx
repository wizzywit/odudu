import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
import { G, groupRoutes } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/groups';

it('shows the top of the tree, and a level beneath a group when asked', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, groupRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  const tree = await screen.findByRole('list', { name: 'Groups' });
  expect(within(tree).getByRole('link', { name: 'eng' })).toHaveAttribute(
    'href',
    '/console/acme/groups/g-eng',
  );
  expect(within(tree).getByText('Builds the product')).toBeVisible();
  expect(within(tree).queryByRole('link', { name: 'platform' })).toBeNull();
  expect(sent.find((s) => s.path === G)?.search.get('parent')).toBe('root');
  expect(await screen.findByText('2 top-level groups')).toBeVisible();

  const show = within(tree).getByRole('button', { name: 'Show the groups under /eng' });
  expect(show).toHaveAttribute('aria-expanded', 'false');
  await user.click(show);
  const under = await within(tree).findByRole('list', { name: 'Under /eng' });
  expect(within(under).getByRole('link', { name: 'platform' })).toBeVisible();
  expect(within(tree).getByRole('button', { name: 'Hide the groups under /eng' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await user.click(
    within(under).getByRole('button', { name: 'Show the groups under /eng/platform' }),
  );
  expect(await within(under).findByText('No groups under /eng/platform yet.')).toBeVisible();
});

it('offers a group to be created at the top, or under any group', async () => {
  renderConsoleAt(AT, groupRoutes());
  expect(await screen.findByRole('link', { name: 'Create a group' })).toHaveAttribute(
    'href',
    '/console/acme/groups/new',
  );
  const tree = await screen.findByRole('list', { name: 'Groups' });
  expect(within(tree).getByRole('link', { name: 'Create a group under /eng' })).toHaveAttribute(
    'href',
    '/console/acme/groups/new?parent=g-eng',
  );
});

it('searches every level by name, and shows each match where it sits', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, groupRoutes());
  await screen.findByRole('list', { name: 'Groups' });
  await user.type(screen.getByRole('searchbox', { name: 'Search by Name' }), 'plat{Enter}');
  const found = await screen.findByRole('grid', { name: 'Groups' });
  expect(within(found).getByRole('row', { name: /platform/u })).toHaveTextContent('/eng/platform');
  await waitFor(() => {
    expect(sent.at(-1)?.search.get('parent')).toBeNull();
  });
});

it('says there are none yet, and names what a group is for', async () => {
  renderConsoleAt(AT, groupRoutes(undefined, { [`GET ${G}`]: json({ items: [] }) }));
  expect(await screen.findByText('No groups yet')).toBeVisible();
});

it('names the capability a principal without manage-tenant lacks', async () => {
  renderConsoleAt(AT, groupRoutes(['view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Groups needs the manage-tenant capability.',
  );
});

it('passes axe in both themes, with a level open and refused', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, groupRoutes()).element,
      async () => {
        const tree = await screen.findByRole('list', { name: 'Groups' });
        await user.click(within(tree).getByRole('button', { name: 'Show the groups under /eng' }));
        await within(tree).findByRole('list', { name: 'Under /eng' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, groupRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
