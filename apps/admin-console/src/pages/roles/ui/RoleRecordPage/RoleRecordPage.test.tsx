import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, problem } from '#/testing/fakeTransport';
import { roleRoutes } from '#/testing/rolesFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ADA, S } from '#/testing/subjectsFixtures';
import { expectOwnActivity } from '#/testing/ownActivity';

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

it("reads the role's own activity from the audit trail", async () => {
  await expectOwnActivity(AT, roleRoutes(), { noun: 'role', id: 'r-portal' });
});

it('offers no delete until whoami says what the caller holds', async () => {
  renderConsoleAt(AT, roleRoutes(undefined, { [`GET ${ACME_ADMIN}/whoami`]: problem(500) }));
  expect(await screen.findByRole('heading', { level: 1, name: 'reader' })).toBeVisible();
  expect((await screen.findAllByText('Checking what it nests…')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Delete reader' })).toBeNull();
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
