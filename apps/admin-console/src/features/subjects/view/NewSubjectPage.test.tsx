import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { USERNAME_RULE_TEXT } from '#/features/subjects/service.ts';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, offline, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA, ADA_ID, S, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/subjects/new';

it('creates a subject and lands on its record, in place of the creation page', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, { [`POST ${S}`]: json(ADA, 201) }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Create a subject' })).toBeVisible();
  const username = screen.getByRole('textbox', { name: 'Username' });
  expect(username).toHaveAccessibleDescription(USERNAME_RULE_TEXT);
  await user.type(username, 'ada');
  await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ada@example.test');
  await user.click(screen.getByRole('button', { name: 'Create subject' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/acme/subjects/${ADA_ID}`);
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    username: 'ada',
    email: 'ada@example.test',
  });
  expect(router.history.length).toBe(1);
});

it('climbs back to the subjects through a breadcrumb', async () => {
  renderConsoleAt(AT, subjectRoutes());
  await screen.findByRole('heading', { level: 1, name: 'Create a subject' });
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'Subjects' })).toHaveAttribute(
    'href',
    '/console/acme/subjects',
  );
  expect(within(trail).getByText('Create a subject')).toHaveAttribute('aria-current', 'page');
});

it('asks for a username before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, subjectRoutes());
  await user.click(await screen.findByRole('button', { name: 'Create subject' }));
  expect(screen.getByRole('textbox', { name: 'Username' })).toHaveAccessibleDescription(
    /Enter a username/u,
  );
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});

it('puts a taken username under its field', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`POST ${S}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'username "ada" is already taken',
        errors: [{ path: 'username', message: 'is already taken' }],
      }),
    }),
  );
  const username = await screen.findByRole('textbox', { name: 'Username' });
  await user.type(username, 'ada');
  await user.click(screen.getByRole('button', { name: 'Create subject' }));
  await waitFor(() => {
    expect(username).toHaveAccessibleDescription(/is already taken/u);
  });
});

it('never sends a lost creation again, and offers to look for it instead', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`POST ${S}`]: offline(),
      [`GET ${S}`]: json({ items: [ADA] }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Username' }), 'ada');
  await user.click(screen.getByRole('button', { name: 'Create subject' }));
  expect(await screen.findByText(/Could not confirm whether ada was created/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Look for ada' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/acme/subjects/${ADA_ID}`);
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('says creating needs manage-users when whoami says it is missing', async () => {
  renderConsoleAt(AT, subjectRoutes(['view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent(/manage-users/u);
  expect(screen.queryByRole('button', { name: 'Create subject' })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, subjectRoutes()).element,
      () => screen.findByRole('textbox', { name: 'Username' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
