import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { A, ENG, G, groupRoutes, record } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/groups/g-eng';

it("heads a group's page with its path and description, and offers its tabs", async () => {
  renderConsoleAt(AT, groupRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: '/eng' })).toBeVisible();
  expect(screen.getAllByText('Builds the product')[0]).toBeVisible();
  const tabs = screen.getByRole('tablist', { name: 'Group sections' });
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['General', 'Roles', 'Members', 'Activity']);
});

it("reads the group's own activity from the audit trail", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, groupRoutes());
  await user.click(await screen.findByRole('tab', { name: 'Activity' }));
  expect(await screen.findByText('No activity on this group yet')).toBeVisible();
  await waitFor(() => {
    const read = sent.find((s) => s.path === `${A}/audit`);
    expect(read?.search.get('resource_type')).toBe('group');
    expect(read?.search.get('resource_id')).toBe('g-eng');
  });
});

it('tells a caller without view-audit or view-users what Activity and Members need, reading neither', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, groupRoutes(['manage-tenant']));
  await user.click(await screen.findByRole('tab', { name: 'Activity' }));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Activity needs the view-audit capability.',
  );
  await user.click(screen.getByRole('tab', { name: 'Members' }));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Members needs the view-users capability.',
  );
  expect(sent.some((s) => s.path === `${A}/audit` || s.path.startsWith(`${A}/subjects`))).toBe(
    false,
  );
});

it('holds every write that depends on what its parent hands down until that is read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    '/console/acme/groups/g-plat',
    groupRoutes(undefined, {
      [`GET ${G}/g-eng`]: inTurn(
        problem(500, 'about:blank', 'Internal Server Error'),
        json(record(ENG), 200, { etag: '"g-eng-1"' }),
      ),
    }),
  );
  expect(
    await screen.findByText(/could not be read, so no move, delete or role change/u),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(screen.queryByText(/^Checking/u)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Read it again' }));
  expect(
    await screen.findByRole('button', { name: 'Delete /eng/platform and every group beneath it' }),
  ).toBeVisible();
});

it('offers a group under it only to a caller holding all it hands out', async () => {
  renderConsoleAt(AT, groupRoutes());
  expect(await screen.findByRole('link', { name: 'Create a group under /eng' })).toHaveAttribute(
    'href',
    '/console/acme/groups/new?parent=g-eng',
  );
});

it('offers no group under one handing out what the caller lacks', async () => {
  renderConsoleAt(
    AT,
    groupRoutes(['manage-tenant'], {
      [`GET ${G}/g-eng`]: json(record({ ...ENG, admin_reach: ['view-users'] }), 200, {
        etag: '"g-eng-1"',
      }),
    }),
  );
  await screen.findByRole('button', { name: 'Delete /eng and every group beneath it' });
  expect(screen.queryByRole('link', { name: 'Create a group under /eng' })).toBeNull();
});

it('says so when there is no such group', async () => {
  renderConsoleAt('/console/acme/groups/g-gone', groupRoutes());
  expect(await screen.findByText('No such group')).toBeVisible();
});

it('names the capability a principal without manage-tenant lacks', async () => {
  renderConsoleAt(AT, groupRoutes(['view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Group needs the manage-tenant capability.',
  );
});

it('passes axe in both themes, on Activity and refused', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, groupRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('tab', { name: 'Activity' }));
        await screen.findByText('No activity on this group yet');
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
