import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import {
  brandingRoutes,
  draftedView,
  themeAnswer,
  themeView,
  versionsAnswer,
} from '#/testing/brandingFixtures';
import { problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';

function versions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `v${String(count - index)}`,
    version: count - index,
    state: index === 0 ? 'published' : 'archived',
    created_at: '2026-10-22T09:00:00.000Z',
    published_at: '2026-10-22T09:00:00.000Z',
  }));
}

it('lists the most the server keeps, and no more rows than that', async () => {
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
      'GET /console/api/admin/tenants/acme/theme/versions': versionsAnswer(versions(20)),
    }),
  );
  const panel = await screen.findByRole('region', { name: 'Versions' });
  const table = await within(panel).findByRole('grid', { name: 'Theme versions' });
  expect(within(table).getAllByRole('row')).toHaveLength(21);
});

it('says the versions could not be loaded, and tries again', async () => {
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(themeView()), {
      'GET /console/api/admin/tenants/acme/theme/versions': problem(500),
    }),
  );
  const panel = await screen.findByRole('region', { name: 'Versions' });
  expect(await within(panel).findByText('The versions could not be loaded')).toBeVisible();
  expect(within(panel).getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('says nothing is published when nothing is', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
  const bar = await screen.findByRole('region', { name: 'Publish' });
  expect(within(bar).getByText(/Nothing published yet/u)).toBeVisible();
  expect(within(bar).getByText('No draft.')).toBeVisible();
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('grid', { name: 'Theme versions' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
