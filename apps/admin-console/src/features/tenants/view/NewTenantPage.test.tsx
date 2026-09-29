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
const SYSTEM_KEY = 'odudu.console.system-administrator';
const SYSTEM_AT = '/console/system/system-admins/new';
const ACME_KEY = 'odudu.console.administrator/acme';
const ACME_AT = '/console/system/tenants/acme/new-administrator';

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

it('climbs back to Tenants through a breadcrumb', async () => {
  renderConsoleAt(AT, routes());
  await screen.findByRole('heading', { level: 1, name: 'Create a tenant' });
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
    'href',
    '/console/system/tenants',
  );
  expect(within(trail).getByText('Create a tenant')).toHaveAttribute('aria-current', 'page');
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

function at(creation: unknown, where = AT) {
  return () => {
    const key = where === SYSTEM_AT ? SYSTEM_KEY : where === ACME_AT ? ACME_KEY : KEY;
    sessionStorage.setItem(key, JSON.stringify({ owner: 'system/s0', creation }));
    return consoleAt(where, routes()).element;
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
    await axeInBothThemes(at(imported, ACME_AT), async () => {
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

it('shows the detail of a grant refusal that names no field, as the page message', async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({ owner: 'system/s0', creation: { ...HALFWAY, subjectId: SUBJECT_ID } }),
  );
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${ADMIN}/acme/subjects/${SUBJECT_ID}/roles`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'acme already holds every role tenant-admin carries',
      }),
    }),
  );
  const button = await screen.findByRole('button', { name: 'Continue' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  expect(
    await screen.findByText('acme already holds every role tenant-admin carries'),
  ).toBeVisible();
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

it('asks a resumed step for all that tenant-admin carries, since the password is for a holder of it', async () => {
  const resumed = JSON.stringify({
    owner: 'system/s0',
    creation: { ...HALFWAY, subjectId: SUBJECT_ID, granted: true },
  });
  sessionStorage.setItem(KEY, resumed);
  const { unmount } = renderConsoleAt(
    AT,
    routes({ [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'manage-users']) }),
  );
  const notes = await screen.findAllByRole('note');
  expect(notes.map((note) => note.textContent)).toContain(
    'Creating the administrator needs the manage-keys capability.',
  );
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  unmount();
  resetConsole();

  sessionStorage.setItem(KEY, resumed);
  renderConsoleAt(AT, routes());
  const button = await screen.findByRole('button', { name: 'Continue' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  expect(screen.queryAllByRole('note')).toEqual([]);
});

it("adds a system administrator as system's own administrator, and leads back to them", async () => {
  const user = userEvent.setup();
  sessionStorage.setItem(
    SYSTEM_KEY,
    JSON.stringify({ owner: 'system/s0', creation: { ...HALFWAY, tenant: 'system' } }),
  );
  renderConsoleAt(SYSTEM_AT, systemRoutes(administratorRoutes('system', SUBJECT_ID, PASSWORD)));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'System administrators' })).toHaveAttribute(
    'href',
    '/console/system/system-admins',
  );
  expect(within(trail).getByText('Add a system administrator')).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await screen.findByText(/reaches every tenant/u)).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  const button = screen.getByRole('button', { name: 'Create administrator' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  const dialog = await screen.findByRole('dialog', { name: "grace's one-time password" });
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(await screen.findByText(/is a system administrator/u)).toBeVisible();
  const done = screen.getByText(/is a system administrator/u).parentElement ?? document.body;
  expect(within(done).getByRole('link', { name: 'Back to System administrators' })).toHaveAttribute(
    'href',
    '/console/system/system-admins',
  );
  expect(screen.queryByRole('link', { name: 'Enter system' })).toBeNull();
});

it('passes axe in both themes adding a system administrator', async () => {
  expect(
    await axeInBothThemes(at({ ...HALFWAY, tenant: 'system' }, SYSTEM_AT), () =>
      screen.findByText(/reaches every tenant/u),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      at({ step: 'done', tenant: 'system', username: 'grace' }, SYSTEM_AT),
      () => screen.findAllByRole('link', { name: 'Back to System administrators' }),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('opens a new tenant, not a system administrator left half added', async () => {
  sessionStorage.setItem(
    SYSTEM_KEY,
    JSON.stringify({ owner: 'system/s0', creation: { ...HALFWAY, tenant: 'system' } }),
  );
  const { router } = renderConsoleAt(AT, routes());
  expect(await screen.findByRole('textbox', { name: 'Name' })).toBeVisible();
  expect(screen.getByRole('heading', { level: 1, name: 'Create a tenant' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/system/new-tenant');
  expect(sessionStorage.getItem(SYSTEM_KEY)).toContain('"tenant":"system"');
});

it('opens a system administrator, not a tenant left half created', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  const { router } = renderConsoleAt(
    SYSTEM_AT,
    systemRoutes(administratorRoutes('system', SUBJECT_ID, PASSWORD)),
  );
  expect(await screen.findByText(/reaches every tenant/u)).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe('/system/system-admins/new');
  expect(sessionStorage.getItem(KEY)).toContain('"tenant":"acme"');
});

it('resumes a system administrator after a reload, beside a tenant of its own', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  sessionStorage.setItem(
    SYSTEM_KEY,
    JSON.stringify({
      owner: 'system/s0',
      creation: { ...HALFWAY, tenant: 'system', username: 'ada', subjectId: SUBJECT_ID },
    }),
  );
  renderConsoleAt(SYSTEM_AT, systemRoutes(administratorRoutes('system', SUBJECT_ID, PASSWORD)));
  expect(await screen.findByText(/ada/u, { selector: 'code' })).toBeVisible();
});

const FLOWS = [
  { flow: 'Create a tenant', at: AT, first: 'Name', heading: 'Create a tenant' },
  {
    flow: 'Add an administrator to acme',
    at: ACME_AT,
    first: 'Username',
    heading: 'Add an administrator to acme',
  },
  {
    flow: 'Add a system administrator',
    at: SYSTEM_AT,
    first: 'Username',
    heading: 'Add a system administrator',
  },
] as const;

const PAIRS = FLOWS.flatMap((started) =>
  FLOWS.filter((opened) => opened !== started).map((opened) => ({ started, opened })),
);

it.each(PAIRS)(
  'opens $opened.flow at its own first step after $started.flow was started',
  async ({ started, opened }) => {
    const user = userEvent.setup();
    const { router } = renderConsoleAt(started.at, routes());
    await user.type(await screen.findByRole('textbox', { name: started.first }), 'begun');
    await router.navigate({ href: opened.at.replace('/console', '') });
    expect(await screen.findByRole('heading', { level: 1, name: opened.heading })).toBeVisible();
    expect(screen.getByRole('textbox', { name: opened.first })).toHaveValue('');
    expect(`/console${router.state.location.pathname}`).toBe(opened.at);

    await router.navigate({ href: started.at.replace('/console', '') });
    expect(await screen.findByRole('textbox', { name: started.first })).toHaveValue('begun');
    expect(`/console${router.state.location.pathname}`).toBe(started.at);
  },
);

it('adds an administrator to an existing tenant under its record, and offers another', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(ACME_AT, routes());
  expect(await screen.findByText(/gets another administrator/u)).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Add an administrator to acme' }),
  ).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(
    within(trail)
      .getAllByRole('listitem')
      .map((item) => item.textContent.replace('›', '')),
  ).toEqual(['System', 'Tenants', 'acme', 'Add an administrator']);
  expect(within(trail).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
    'href',
    '/console/system/tenants',
  );
  expect(within(trail).getByRole('link', { name: 'acme' })).toHaveAttribute(
    'href',
    '/console/system/tenants/acme',
  );
  await user.type(screen.getByRole('textbox', { name: 'Username' }), 'grace');
  const button = screen.getByRole('button', { name: 'Create administrator' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  const dialog = await screen.findByRole('dialog', { name: "grace's one-time password" });
  expect(sessionStorage.getItem(ACME_KEY)).not.toContain(PASSWORD);
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(await screen.findByRole('link', { name: 'Open acme' })).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Add an administrator to acme' }),
  ).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  expect(sent.some((s) => s.path === ADMIN && s.method === 'POST')).toBe(false);
  expect(screen.queryByRole('button', { name: 'Create another tenant' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Add another administrator' }));
  expect(await screen.findByRole('textbox', { name: 'Username' })).toHaveValue('');
});

it("resumes a tenant's administrator after a reload, and only that tenant's", async () => {
  sessionStorage.setItem(
    ACME_KEY,
    JSON.stringify({
      owner: 'system/s0',
      creation: { ...HALFWAY, origin: 'existing', username: 'ada', subjectId: SUBJECT_ID },
    }),
  );
  const { router } = renderConsoleAt(ACME_AT, routes());
  expect(await screen.findByText(/ada/u, { selector: 'code' })).toBeVisible();
  expect(screen.getByText(/, created\. What is left/u)).toBeVisible();
  await router.navigate({ href: '/system/tenants/globex/new-administrator' });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add an administrator to globex' }),
  ).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('');
  expect(sessionStorage.getItem(ACME_KEY)).toContain(SUBJECT_ID);
});

it('asks before starting over from an administrator already created, and keeps it if told to', async () => {
  const created = { ...HALFWAY, username: 'ada', subjectId: SUBJECT_ID };
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: created }));
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Start over' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Replace the unfinished administrator?',
  });
  expect(dialog).toHaveTextContent('ada was created in acme');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText(/, created\. What is left/u)).toBeVisible();
  expect(sessionStorage.getItem(KEY)).toContain(SUBJECT_ID);

  await user.click(screen.getByRole('button', { name: 'Start over' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace it' }),
  );
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('');
  expect(sessionStorage.getItem(KEY)).not.toContain(SUBJECT_ID);
});

it('starts over without asking while nothing has been created', async () => {
  sessionStorage.setItem(KEY, JSON.stringify({ owner: 'system/s0', creation: HALFWAY }));
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Start over' }));
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('');
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes asking before a start over', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(at({ ...HALFWAY, subjectId: SUBJECT_ID }, ACME_AT), async () => {
      await user.click(await screen.findByRole('button', { name: 'Start over' }));
      await screen.findByRole('alertdialog');
    }),
  ).toEqual({ light: [], dark: [] });
});
