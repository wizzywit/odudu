import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, offline, pending, problem, whoamiReads } from '#/testing/fakeTransport';
import { AUDITOR, R, READER, roleRoutes } from '#/testing/rolesFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { role } from '#/testing/roleAnswers';
afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/roles/new';
const MADE = role('r-new', 'billing');

it('creates a tenant role and lands on it', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    roleRoutes(undefined, { [`POST ${R}`]: json(MADE, 201) }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Create a role' })).toBeVisible();
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing');
  await user.click(screen.getByRole('button', { name: 'Create role' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-new');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ name: 'billing' });
});

it('opens on the name, counts the description against its limit and offers the way back', async () => {
  renderConsoleAt(AT, roleRoutes());
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveFocus();
  expect(screen.getByText(/^0 of [\d,]+ characters\.$/u)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    '/console/acme/roles',
  );
});

it('says it is creating, and holds Create, while the answer is awaited', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, roleRoutes(undefined, { [`POST ${R}`]: pending() }));
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled();
});

it('copies a role under a new name, with its description and what it nests', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [READER] }, 200, { etag: '"c"' }),
      [`POST ${R}`]: json(MADE, 201),
      [`POST ${R}/r-new/composites`]: () => new Response(null, { status: 204 }),
    }),
  );
  expect(await screen.findByText('A copy of auditor, nesting reader.')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Reads the books');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-new');
  });
  expect(sent.find((s) => s.method === 'POST' && s.path === R)?.body).toEqual({
    name: 'billing',
    description: AUDITOR.description,
  });
  expect(sent.find((s) => s.path === `${R}/r-new/composites`)?.body).toEqual({
    child_role_id: 'r-read',
  });
});

it("keeps an emptied description empty rather than the source's", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [] }, 200, { etag: '"c"' }),
    }),
  );
  const description = await screen.findByRole('textbox', { name: 'Description' });
  await waitFor(() => {
    expect(description).toHaveValue('Reads the books');
  });
  await user.clear(description);
  expect(description).toHaveValue('');
});

it('stays to say which composites a copy could not take', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [READER] }, 200, { etag: '"c"' }),
      [`POST ${R}`]: json(MADE, 201),
      [`POST ${R}/r-new/composites`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(
    await screen.findByText(/billing was created, but reader could not be nested in it/u),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open billing' })).toHaveAttribute(
    'href',
    '/console/acme/roles/r-new?tab=composites',
  );
});

it('sends nothing more while a part-made copy stays on the page', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [READER] }, 200, { etag: '"c"' }),
      [`POST ${R}`]: json(MADE, 201),
      [`POST ${R}/r-new/composites`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, 'billing{Enter}');
  await screen.findByText(/could not be nested in it/u);
  await user.type(name, 's{Enter}');
  expect(sent.filter((request) => request.method === 'POST' && request.path === R)).toHaveLength(1);
});

it('sends nothing before whoami has said what the caller holds', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [READER] }, 200, { etag: '"c"' }),
      [`POST ${R}`]: json(MADE, 201),
      [`GET ${ACME_ADMIN}/whoami`]: problem(500),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  expect(sent.some((request) => request.method === 'POST')).toBe(false);
});

it('puts a taken name under its field', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`POST ${R}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'a role named "auditor" already exists',
      }),
    }),
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, 'auditor{Enter}');
  expect(await screen.findByText('A role named "auditor" already exists.')).toBeVisible();
  expect(name).toHaveAccessibleDescription(/already exists/u);
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('never sends a creation twice whose answer was lost', async () => {
  const user = userEvent.setup();
  const { router, sent } = renderConsoleAt(AT, roleRoutes(undefined, { [`POST ${R}`]: offline() }));
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'auditor{Enter}');
  const form = (await screen.findByText(/Could not confirm whether auditor was created/u)).closest(
    'form',
  );
  await user.click(within(form ?? document.body).getByRole('button', { name: 'Look for auditor' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-aud');
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('asks for a name before sending anything, and drops the ask once one is typed', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, roleRoutes());
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.click(screen.getByRole('button', { name: 'Create role' }));
  expect(await screen.findByText('Enter a name.')).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toEqual([]);
  await user.type(name, 'a');
  expect(screen.queryByText('Enter a name.')).toBeNull();
});

it('reads whoami again when the creation is refused, and says why on the page', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, { [`POST ${R}`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(await screen.findByText(/it needs the manage-tenant capability/u)).toBeVisible();
  expect(whoamiReads(sent)).toBeGreaterThan(1);
});

it('holds Create after a lost answer until a look finds nothing, then lets it go again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`POST ${R}`]: offline(),
      [`GET ${R}`]: json({ items: [] }),
    }),
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, 'billing{Enter}');
  await screen.findByText(/Could not confirm whether billing was created/u);
  await user.type(name, '{Enter}');
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Look for billing' }));
  expect(await screen.findByText(/No role named billing was found/u)).toBeVisible();
  await user.type(name, '{Enter}');
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(2);
  });
});

it('holds the look disabled while it is under way', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, roleRoutes(undefined, { [`POST ${R}`]: offline(), [`GET ${R}`]: pending() }));
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  await screen.findByText(/Could not confirm whether billing was created/u);
  await user.click(screen.getByRole('button', { name: 'Look for billing' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Look for billing' })).toBeDisabled();
  });
});

it('drops what the last send said while the next one is in flight', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`POST ${R}`]: inTurn(problem(403, 'about:blank', 'Forbidden'), pending()),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(await screen.findByText(/it needs the manage-tenant capability/u)).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(2);
  });
  expect(screen.queryByText(/it needs the manage-tenant capability/u)).toBeNull();
});

it('says when a look for a lost creation could not be made', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, roleRoutes(undefined, { [`POST ${R}`]: offline(), [`GET ${R}`]: offline() }));
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Look for billing' }));
  expect(await screen.findByText('Could not look for billing. Try again.')).toBeVisible();
});

it('passes axe in both themes, copying', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(`${AT}?copy=r-aud`, roleRoutes()).element,
      () => screen.findByText('A copy of auditor, nesting nothing.'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('says before Create which composites a copy will leave out, and nests only the rest', async () => {
  const user = userEvent.setup();
  const deep = { ...role('r-deep', 'deep'), admin_reach: ['view-audit'] };
  const { sent, router } = renderConsoleAt(
    `${AT}?copy=r-aud`,
    roleRoutes(['manage-tenant'], {
      [`GET ${R}/r-aud/composites`]: json({ items: [READER, deep] }, 200, { etag: '"c"' }),
      [`POST ${R}`]: json(MADE, 201),
      [`POST ${R}/r-new/composites`]: () => new Response(null, { status: 204 }),
    }),
  );
  expect(await screen.findByText('A copy of auditor, nesting reader.')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Not copied' })).toHaveTextContent(
    'deep · It reaches view-audit, which you do not hold, so you cannot give or take it.',
  );
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-new');
  });
  expect(sent.filter((s) => s.path === `${R}/r-new/composites`).map((s) => s.body)).toEqual([
    { child_role_id: 'r-read' },
  ]);
});
