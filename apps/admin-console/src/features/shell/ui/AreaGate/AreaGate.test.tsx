import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { pending } from '#/testing/fakeTransport';
import { groupRoutes } from '#/testing/groupsFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
});

it('lets a principal holding the area through, and keeps the way back on a refused page', async () => {
  renderConsoleAt('/console/acme/groups/new', groupRoutes(['view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Create a group needs the manage-tenant capability.',
  );
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Groups');
});

it('makes no read of its page while whoami is unanswered, and says it is checking', async () => {
  const routes = groupRoutes();
  const { sent } = renderConsoleAt('/console/acme/groups', {
    ...routes,
    [`GET ${ACME_ADMIN}/whoami`]: pending(),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  expect(await screen.findByText(/Checking access to Groups/u)).toBeVisible();
  expect(sent.filter((s) => s.path.includes('/groups'))).toEqual([]);
});

it('passes axe in both themes, refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/groups/new', groupRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
