import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, offline, problem } from '#/testing/fakeTransport.ts';
import { ENG, G, group, groupRoutes, record } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/groups/new';
const MADE = group('g-new', '/eng/qa', 'g-eng');

it('creates a group under the parent it was asked from, and lands on it', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    `${AT}?parent=g-eng`,
    groupRoutes(undefined, { [`POST ${G}`]: json(record(MADE), 201, { etag: '"n1"' }) }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Create a group' })).toBeVisible();
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
      name: 'Groups',
    }),
  ).toHaveAttribute('href', '/console/acme/groups');
  expect(await screen.findByText('It will sit under /eng.')).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'qa');
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Tests it');
  await user.click(screen.getByRole('button', { name: 'Create group' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/groups/g-new');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    name: 'qa',
    description: 'Tests it',
    parent_id: 'g-eng',
  });
});

it('puts a group at the top level once its parent is let go', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `${AT}?parent=g-eng`,
    groupRoutes(undefined, { [`POST ${G}`]: json(record(group('g-top', '/qa')), 201) }),
  );
  const parent = await screen.findByRole('listbox', { name: 'Parent' });
  await user.click(await within(parent).findByRole('option', { name: /^eng/u }));
  expect(await screen.findByText('It will sit at the top level.')).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'qa{Enter}');
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ name: 'qa' });
  });
});

it('puts a taken name under its field, and a ceiling refusal beside the button', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`POST ${G}`]: inTurn(
        problem(409, 'about:blank', 'Conflict', {
          detail: 'a group named "eng" already exists there',
        }),
        problem(403, 'about:blank', 'Forbidden', {
          detail: 'the caller does not hold: view-users',
        }),
      ),
    }),
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, 'eng{Enter}');
  expect(await screen.findByText('A group named "eng" already exists there.')).toBeVisible();
  expect(name).toHaveAccessibleDescription(/already exists there/u);
  await user.click(screen.getByRole('button', { name: 'Create group' }));
  expect(
    await screen.findByText(
      'Refused: it would hand out view-users, which you do not hold yourself.',
    ),
  ).toBeVisible();
});

it('looks for a group whose creation could not be confirmed rather than sending it again', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`POST ${G}`]: offline(),
      [`GET ${G}`]: (request) =>
        json({ items: request.search.get('name') === 'qa' ? [group('g-qa', '/qa')] : [ENG] })(
          request,
        ),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'qa{Enter}');
  expect(await screen.findByText(/Could not confirm whether qa was created/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Look for qa' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/groups/g-qa');
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(`${AT}?parent=g-eng`, groupRoutes()).element,
      () => screen.findByText('It will sit under /eng.'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('holds Create under a parent handing out what the caller lacks, and says why', async () => {
  const { sent } = renderConsoleAt(
    `${AT}?parent=g-eng`,
    groupRoutes(['manage-tenant'], {
      [`GET ${G}`]: json({ items: [{ ...ENG, admin_reach: ['view-users'] }] }),
    }),
  );
  expect(
    await screen.findByText(
      'A group made under /eng hands its members view-users, which you do not hold, so you cannot make one there.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create group' })).toBeDisabled();
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});
