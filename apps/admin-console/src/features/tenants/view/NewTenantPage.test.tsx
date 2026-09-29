import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, offline, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole, whoami } from '#/testing/renderConsole.tsx';
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

it('starts fresh once a finished creation has been left', async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      owner: 'system/s0',
      creation: { step: 'done', tenant: 'acme', username: 'grace' },
    }),
  );
  const { router } = renderConsoleAt(AT, {
    ...routes(),
    [`GET ${ADMIN}`]: json({ items: [] }),
    [`GET ${ADMIN}/count`]: json({ count: 0, capped: false }),
  });
  expect(await screen.findByRole('link', { name: 'Open acme' })).toBeVisible();
  await router.navigate({ href: '/system/tenants' });
  await screen.findByRole('heading', { level: 1, name: 'Tenants' });
  await router.navigate({ href: '/system/new-tenant' });
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('');
});

const HALFWAY = {
  step: 'administrator',
  tenant: 'acme',
  origin: 'created',
  username: 'grace',
  email: '',
  subjectId: null,
  granted: false,
};

it('names what the first administrator needs to a holder of manage-tenants alone, and sends nothing', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  const { sent } = renderConsoleAt(
    AT,
    routes({ [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants']) }),
  );
  const notes = await screen.findAllByRole('note');
  expect(notes.map((note) => note.textContent)).toEqual([
    'Creating the administrator needs the manage-users capability.',
    'Creating the administrator needs the manage-clients capability.',
    'Creating the administrator needs the view-users capability.',
    'Creating the administrator needs the manage-tenant capability.',
    'Creating the administrator needs the manage-keys capability.',
    'Creating the administrator needs the manage-sessions capability.',
    'Creating the administrator needs the view-audit capability.',
  ]);
  expect(screen.getByRole('button', { name: 'Create administrator' })).toBeDisabled();
  expect(sent.filter((s) => s.method !== 'GET')).toHaveLength(0);
});

it('names the capability of the one call the server refused, and reads whoami again', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  const user = userEvent.setup();
  const { calls } = renderConsoleAt(
    AT,
    routes({
      [`GET ${ADMIN}/acme/clients`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  const whoamis = () => calls.filter((call) => call.path === `${ADMIN}/system/whoami`).length;
  const button = await screen.findByRole('button', { name: 'Create administrator' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  const before = whoamis();
  await user.click(button);
  expect(
    await screen.findByText('Refused: finishing grace needs the manage-clients capability.'),
  ).toBeVisible();
  await waitFor(() => {
    expect(whoamis()).toBe(before + 1);
  });
});

it('names view-users when the lookup for an unconfirmed administrator is refused', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`POST ${ADMIN}/acme/subjects`]: offline(),
      [`GET ${ADMIN}/acme/subjects`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  const button = await screen.findByRole('button', { name: 'Create administrator' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  await user.click(await screen.findByRole('button', { name: 'Check whether grace was created' }));
  expect(
    await screen.findByText('Refused: looking for grace needs the view-users capability.'),
  ).toBeVisible();
});

it('asks only for what the steps still to run need, when a creation is resumed', async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      owner: 'system/s0',
      creation: { ...HALFWAY, subjectId: SUBJECT_ID, granted: true },
    }),
  );
  renderConsoleAt(
    AT,
    routes({ [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'manage-users']) }),
  );
  const button = await screen.findByRole('button', { name: 'Continue' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  expect(screen.queryAllByRole('note')).toEqual([]);
});
