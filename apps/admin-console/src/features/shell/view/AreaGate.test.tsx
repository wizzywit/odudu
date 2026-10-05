import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { groupRoutes } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

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

it('passes axe in both themes, refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/groups/new', groupRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
