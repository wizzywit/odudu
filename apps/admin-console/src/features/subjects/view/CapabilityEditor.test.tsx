import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/system/tenants/acme?tab=administrators';
const S = `${ADMIN}/acme/subjects`;
const GRACE = {
  id: 's-grace',
  type: 'user',
  username: 'grace',
  email: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};

function routes(roles: ReturnType<typeof json>) {
  return systemRoutes({
    [`GET ${ADMIN}/acme`]: json(tenant('acme'), 200, { etag: '"t1"' }),
    [`GET ${S}`]: json({ items: [GRACE] }),
    [`GET ${S}/s-grace/roles`]: roles,
  });
}

it('says when the capabilities could not be read, and reads them again', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes(inTurn(problem(500), json({ items: [] }, 200, { etag: '"r1"' }))));
  await user.click(await screen.findByRole('button', { name: 'Change grace’s capabilities' }));
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('region', { name: 'Admin capabilities' })).toBeVisible();
});

it('passes axe in both themes, with nothing assigned', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(json({ items: [] }, 200, { etag: '"r1"' }))).element,
      async () => {
        await user.click(
          await screen.findByRole('button', { name: 'Change grace’s capabilities' }),
        );
        await screen.findByRole('checkbox', { name: 'Full (tenant-admin)' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('holds a save until the admin roles are read, and says when they could not be', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, {
    ...routes(json({ items: [] }, 200, { etag: '"r1"' })),
    [`GET ${ADMIN}/acme/roles`]: problem(500),
  });
  await user.click(await screen.findByRole('button', { name: 'Change grace’s capabilities' }));
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  expect(await within(section).findByText(/The admin roles could not be read/u)).toBeVisible();
  await user.click(within(section).getByRole('checkbox', { name: 'view-audit' }));
  expect(within(section).getByRole('button', { name: 'Save Admin capabilities' })).toBeDisabled();
});
