import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, offline, problem } from '#/testing/fakeTransport.ts';
import { AUDITOR, R, READER, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { role } from '#/testing/subjectsFixtures.ts';

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
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'billing');
  await user.click(screen.getByRole('button', { name: 'Create role' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-new');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ name: 'billing' });
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
