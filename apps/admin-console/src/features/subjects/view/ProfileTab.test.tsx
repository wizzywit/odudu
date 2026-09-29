import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, GRACE, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import {
  ADA,
  ADA_AT,
  ADA_ID,
  noContent,
  profile,
  S,
  SETTINGS,
  subject,
  subjectRoutes,
} from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it('shows the username fixed, with the reason and a link to Settings, while renaming is off', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes());
  const fixed = await screen.findByText(/username_editable setting is off/u);
  expect(fixed).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Username' })).toBeNull();
  expect(within(fixed).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/console/acme/settings',
  );
});

it('renames on the ETag the subject was read with while renaming is on', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`GET ${SETTINGS}`]: json({ username_editable: true }),
      [`PATCH ${S}/${ADA_ID}`]: json({ ...ADA, username: 'ada2' }, 200, { etag: '"s2"' }),
    }),
  );
  const field = await screen.findByRole('textbox', { name: 'Username' });
  await user.clear(field);
  await user.type(field, 'ada2');
  await user.click(screen.getByRole('button', { name: 'Save Account' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { username: 'ada2' },
    });
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'ada2' })).toBeVisible();
});

it('offers the rename when the setting cannot be read, and puts a refusal under the field', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(['view-users', 'manage-users'], {
      [`PATCH ${S}/${ADA_ID}`]: problem(400, 'about:blank', 'Bad Request', {
        detail: 'username: this tenant has not enabled username editing (username_editable)',
        errors: [
          {
            path: 'username',
            message: 'this tenant has not enabled username editing (username_editable)',
          },
        ],
      }),
    }),
  );
  const field = await screen.findByRole('textbox', { name: 'Username' });
  expect(field).toHaveAccessibleDescription(/reading it needs the manage-tenant capability/u);
  await user.type(field, 'x');
  await user.click(screen.getByRole('button', { name: 'Save Account' }));
  await waitFor(() => {
    expect(field).toHaveAccessibleDescription(/has not enabled username editing/u);
  });
  expect(sent.some((s) => s.path === SETTINGS)).toBe(false);
});

it('clears an emptied email rather than sending an empty one', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`PATCH ${S}/${ADA_ID}`]: json({ ...ADA, email: null }, 200, { etag: '"s2"' }),
    }),
  );
  await user.clear(await screen.findByRole('textbox', { name: 'Email' }));
  await user.click(screen.getByRole('button', { name: 'Save Account' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ email: null });
  });
});

it('saves claims on the profile’s own ETag, an emptied claim as none', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`GET ${S}/${ADA_ID}/profile`]: json(profile({ nickname: 'Countess' }), 200, {
        etag: '"p1"',
      }),
      [`PATCH ${S}/${ADA_ID}/profile`]: json(profile({ name: 'Ada Lovelace' }), 200, {
        etag: '"p2"',
      }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Full name' }), 'Ada Lovelace');
  await user.clear(screen.getByRole('textbox', { name: 'Nickname' }));
  await user.click(screen.getByRole('button', { name: 'Save Name' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"p1"',
      body: { name: 'Ada Lovelace', nickname: null },
    });
  });
});

it('marks the email and the phone number verified in one save', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`PATCH ${S}/${ADA_ID}/profile`]: json(profile({ email_verified: true }), 200, {
        etag: '"p2"',
      }),
    }),
  );
  await user.click(await screen.findByRole('switch', { name: 'Email verified' }));
  await user.click(screen.getByRole('button', { name: 'Save Verification' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ email_verified: true });
  });
});

it('shows a 412 on the profile as the other value beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`GET ${S}/${ADA_ID}/profile`]: inTurn(
        json(profile(), 200, { etag: '"p1"' }),
        json(profile({ name: 'Augusta' }), 200, { etag: '"p9"' }),
      ),
      [`PATCH ${S}/${ADA_ID}/profile`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Full name' }), 'Ada');
  await user.click(screen.getByRole('button', { name: 'Save Name' }));
  const table = await screen.findByRole('table', { name: 'Changed in Name since you opened it' });
  expect(within(table).getByRole('row', { name: /Full name/u })).toHaveTextContent('AugustaAda');
});

it('disables after a plain confirmation, and enables again without one', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`PATCH ${S}/${ADA_ID}`]: inTurn(
        json({ ...ADA, enabled: false }, 200, { etag: '"s2"' }),
        json(ADA, 200, { etag: '"s3"' }),
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Disable ada' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Disable ada?' });
  await user.click(within(dialog).getByRole('button', { name: 'Disable ada' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { enabled: false },
    });
  });
  await user.click(await screen.findByRole('button', { name: 'Enable ada' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH')[1]).toMatchObject({
      ifMatch: '"s2"',
      body: { enabled: true },
    });
  });
});

it('says so when you are disabling yourself, and shows the guard’s refusal', async () => {
  const user = userEvent.setup();
  const grace = subject(GRACE.subject_id, 'grace');
  renderConsoleAt(
    `/console/acme/subjects/${GRACE.subject_id}`,
    subjectRoutes(undefined, {
      [`GET ${S}/${GRACE.subject_id}`]: json(grace, 200, { etag: '"g1"' }),
      [`GET ${S}/${GRACE.subject_id}/profile`]: json(profile(), 200, { etag: '"gp"' }),
      [`PATCH ${S}/${GRACE.subject_id}`]: problem(
        409,
        'about:blank#last-administrator',
        'Conflict',
        {
          detail: 'acme would be left with no enabled administrator',
        },
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Disable grace' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Disable your own subject?' });
  await user.click(within(dialog).getByRole('button', { name: 'Disable grace' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    /left with no enabled administrator/u,
  );
});

it('deletes only once the username is typed, then goes back to the list', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, { [`DELETE ${S}/${ADA_ID}`]: noContent() }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete ada' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete ada?' });
  const confirm = within(dialog).getByRole('button', { name: 'Delete ada' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox', { name: 'Type ada to confirm' }), 'ada');
  await user.click(confirm);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/subjects');
  });
  expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
});

it('shows an operator who can only look the values, and nothing to change them with', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes(['view-users']));
  expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Email' })).toBeDisabled();
  expect(screen.getByRole('note')).toHaveTextContent(/manage-users/u);
  expect(screen.queryByRole('button', { name: 'Disable ada' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete ada' })).toBeNull();
});

it('says a service subject has no profile to edit', async () => {
  const bot = subject(ADA_ID, null, { type: 'service' });
  renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, { [`GET ${S}/${ADA_ID}`]: json(bot, 200, { etag: '"b1"' }) }),
  );
  expect(await screen.findByText(/has no username, email or profile/u)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull();
});

it('passes axe in both themes, with the deletion open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(ADA_AT, subjectRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Delete ada' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes for an operator who can only look', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(ADA_AT, subjectRoutes(['view-users'])).element,
      () => screen.findByRole('textbox', { name: 'Full name' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
