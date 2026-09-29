import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, offline, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, administratorRoutes, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

const AT = '/console/system/new-tenant';
const SUBJECT_ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
const PASSWORD = 'one-time-Qm9vYmFyYmF6';
const KEY = 'odudu.console.tenant-creation';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

function routes(extra = {}) {
  return systemRoutes({
    [`POST ${ADMIN}`]: json(tenant('acme'), 201),
    ...administratorRoutes('acme', SUBJECT_ID, PASSWORD),
    ...extra,
  });
}

it('creates a tenant, then its first administrator with a password shown once, then is done', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const name = await screen.findByRole('textbox', { name: 'Name' });
  expect(screen.getByText(/A tenant name must be 1-63 lowercase letters/u)).toBeVisible();

  await user.type(name, 'Acme');
  await user.click(screen.getByRole('button', { name: 'Create tenant' }));
  expect(name).toHaveAccessibleDescription(/lowercase letters/u);
  expect(sent.some((s) => s.method === 'POST')).toBe(false);

  await user.clear(name);
  await user.type(name, 'acme');
  expect(screen.getByText('https://id.example/tenants/acme')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Create tenant' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ name: 'acme' });
  });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'First administrator of acme' }),
  ).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Username' }), 'grace');
  await user.click(screen.getByRole('button', { name: 'Create administrator' }));

  const dialog = await screen.findByRole('dialog', { name: "grace's one-time password" });
  expect(within(dialog).getByText(PASSWORD)).toBeVisible();
  expect(sessionStorage.getItem(KEY)).not.toContain(PASSWORD);
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));

  expect(await screen.findByRole('link', { name: 'Open acme' })).toHaveAttribute(
    'href',
    '/console/system/tenants/acme',
  );
  expect(screen.getByRole('link', { name: 'Enter acme' })).toHaveAttribute('href', '/console/acme');
  expect(screen.queryByText(PASSWORD)).toBeNull();
  expect(sessionStorage.getItem(KEY)).not.toContain(PASSWORD);
});

it('resumes after a reload where the last call left it', async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      owner: 'system/s0',
      creation: {
        step: 'administrator',
        tenant: 'acme',
        origin: 'created',
        username: 'grace',
        email: '',
        subjectId: SUBJECT_ID,
        granted: true,
      },
    }),
  );
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  expect(await screen.findByText(/, created\. What is left/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('dialog', { name: "grace's one-time password" })).toBeVisible();
  expect(sent.filter((s) => s.method !== 'GET').map((s) => s.path)).toEqual([
    `${ADMIN}/acme/subjects/${SUBJECT_ID}/password`,
  ]);
});

it('keeps what was typed across a reload', async () => {
  const user = userEvent.setup();
  const first = renderConsoleAt(AT, routes());
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'globex');
  first.unmount();
  renderConsoleAt(AT, routes());
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('globex');
});

it('shows a taken name under the field', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`POST ${ADMIN}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'the name "acme" is already in use',
      }),
    }),
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, 'acme{Enter}');
  await waitFor(() => {
    expect(name).toHaveAccessibleDescription(/already in use/u);
  });
});

it('never sends a creation twice whose answer was lost, and looks for the tenant instead', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [`POST ${ADMIN}`]: offline(),
      [`GET ${ADMIN}`]: inTurn(json({ items: [tenant('acme-eu'), tenant('acme')] })),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'acme{Enter}');
  expect(await screen.findByText(/Could not confirm that acme was created/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Check whether acme was created' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'First administrator of acme' }),
  ).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

function at(creation: unknown) {
  return () => {
    sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation }));
    return consoleAt(AT, routes()).element;
  };
}

it('passes axe in both themes at each step', { timeout: 20_000 }, async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(at({ step: 'tenant', name: 'acme', displayName: '' }), () =>
      screen.findByText('https://id.example/tenants/acme'),
    ),
  ).toEqual({ light: [], dark: [] });
  const imported = {
    step: 'administrator',
    tenant: 'acme',
    origin: 'imported',
    username: 'grace',
    email: '',
    subjectId: null,
    granted: false,
  };
  expect(
    await axeInBothThemes(at(imported), async () => {
      await user.click(await screen.findByRole('button', { name: 'Create administrator' }));
      await screen.findByRole('dialog');
    }),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(at({ step: 'done', tenant: 'acme', username: 'grace' }), () =>
      screen.findByRole('link', { name: 'Open acme' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
