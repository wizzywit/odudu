import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, BILLING, C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, pending, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill';
// The record as it answers a client whose service account holds `reach`.
function reaching(...reach: string[]) {
  return {
    [`GET ${C}/c-bill`]: json({ ...BILLING, service_account_admin_reach: reach }, 200, {
      etag: '"c-bill-1"',
    }),
  };
}

it('heads the page with the breadcrumb, the name, its status and the tabs', async () => {
  renderConsoleAt(AT, clientRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
  expect(trail.getByText('Applications')).toBeVisible();
  expect(trail.getByRole('link', { name: 'Clients' })).toHaveAttribute(
    'href',
    '/console/acme/clients',
  );
  expect(screen.getAllByText('enabled').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'General',
    'Redirects & origins',
    'Tokens',
    'Scopes',
    'Logout',
    'Advanced',
    'Activity',
  ]);
});

it('marks the tab holding unsaved edits with its dot, and no other', async () => {
  const user = userEvent.setup();
  renderConsoleAt(`${AT}?tab=redirects`, clientRoutes());
  await screen.findByRole('button', { name: 'Add web origin' });
  await user.click(screen.getByRole('button', { name: 'Add web origin' }));
  await user.type(screen.getByRole('textbox', { name: 'Web origin 2' }), 'https://x.example');
  const tabs = screen.getAllByRole('tab');
  expect(tabs.find((tab) => tab.textContent.startsWith('Redirects'))).toHaveAccessibleName(
    /unsaved/iu,
  );
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAccessibleName('General');
});

it('says there is no such client for an id that is not one', async () => {
  renderConsoleAt(
    '/console/acme/clients/c-gone',
    clientRoutes(undefined, { [`GET ${C}/c-gone`]: problem(404, 'about:blank', 'Not Found') }),
  );
  expect(await screen.findByText('No such client')).toBeVisible();
});

it('offers nothing to change until the caller capabilities are known', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, { [`GET ${A}/whoami`]: pending(), ...reaching('view-users') }),
  );
  await screen.findByRole('heading', { level: 1, name: 'Billing' });
  await screen.findByRole('region', { name: 'Identity' });
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent('Billing');
});

it('offers nothing, and says why once, when the service account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients', 'view-users'], reaching('manage-users', 'view-users')),
  );
  expect(
    await screen.findByText(
      "Billing's service account holds manage-users, which you do not, so you cannot change Billing.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(screen.getAllByText(/service account holds/u)).toHaveLength(1);
});

it('offers every write when the service account holds nothing beyond the caller', async () => {
  renderConsoleAt(AT, clientRoutes(['manage-clients', 'view-users'], reaching('view-users')));
  expect(await screen.findByRole('textbox', { name: 'Name' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete Billing' })).toBeVisible();
  expect(screen.queryByText(/service account holds/u)).toBeNull();
});

it('lets a caller holding manage-clients alone edit a confidential client, with no read of its account', async () => {
  const { sent } = renderConsoleAt(AT, clientRoutes(['manage-clients'], reaching()));
  expect(await screen.findByRole('textbox', { name: 'Name' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete Billing' })).toBeVisible();
  expect(sent.filter((s) => s.path.endsWith('/admin-capabilities'))).toEqual([]);
});

it('shows the tabs not yet built as such', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientRoutes());
  await user.click(await screen.findByRole('tab', { name: 'Tokens' }));
  expect(await screen.findByText(/This tab is not built in this version/u)).toBeVisible();
});

it('lists the changes made to the client under Activity, from the audit trail', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, clientRoutes());
  await user.click(await screen.findByRole('tab', { name: 'Activity' }));
  await waitFor(() => {
    expect(sent.find((s) => s.path === `${A}/audit`)?.search.get('resource_id')).toBe('c-bill');
  });
  expect(sent.find((s) => s.path === `${A}/audit`)?.search.get('resource_type')).toBe('client');
});

it('says Activity needs view-audit when the caller lacks it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientRoutes(['manage-clients', 'view-users']));
  await user.click(await screen.findByRole('tab', { name: 'Activity' }));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Activity needs the view-audit capability.',
  );
});

it('passes axe in both themes, open and limited', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => screen.findByRole('textbox', { name: 'Name' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes(['manage-clients'], reaching('manage-users'))).element,
      () => screen.findByText(/service account holds manage-users/u),
    ),
  ).toEqual({ light: [], dark: [] });
});
