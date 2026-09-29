import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA, ADA_ID, S, subject, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const BOT = subject('01a0e72d-7fc7-7950-a1e7-1d079588f8b9', null, { type: 'service' });
const OFF = subject('01a0e72d-7fc7-7950-a1e7-1d079588f8b8', 'linus', { enabled: false });

function routes(capabilities?: readonly string[]) {
  return subjectRoutes(capabilities, {
    [`GET ${S}`]: json({ items: [ADA, OFF, BOT] }),
    [`GET ${S}/count`]: json({ count: 3, capped: false }),
  });
}

it('lists subjects with their status and count, and offers creation', async () => {
  renderConsoleAt('/console/acme/subjects', routes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Subjects' });
  expect(within(table).getByRole('row', { name: /ada/u })).toHaveTextContent('enabled');
  expect(within(table).getByRole('row', { name: /linus/u })).toHaveTextContent('disabled');
  expect(within(table).getByText(/^service /u)).toBeVisible();
  expect(await screen.findByText('3 subjects')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Create a subject' })).toHaveAttribute(
    'href',
    '/console/acme/subjects/new',
  );
});

it('searches one field at a time and opens a subject from its row', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt('/console/acme/subjects', routes());
  await screen.findByRole('grid', { name: 'Subjects' });
  await user.click(screen.getByRole('button', { name: /Search field/u }));
  await user.click(await screen.findByRole('option', { name: 'Email' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search by Email' }), 'ada@{Enter}');
  await waitFor(() => {
    expect(sent.some((s) => s.path === S && s.search.toString() === 'email=ada%40')).toBe(true);
  });
  await user.click(await screen.findByRole('row', { name: /ada/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/acme/subjects/${ADA_ID}`);
  });
});

it('filters by status and by a capability held any way at all', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt('/console/acme/subjects', routes());
  await screen.findByRole('grid', { name: 'Subjects' });
  await user.click(screen.getByRole('button', { name: /Capability/u }));
  await user.click(await screen.findByRole('option', { name: 'manage-users' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === S && s.search.get('capability') === 'manage-users')).toBe(
      true,
    );
  });
  await user.click(screen.getByRole('button', { name: /Status/u }));
  await user.click(await screen.findByRole('option', { name: 'Disabled' }));
  await waitFor(() => {
    expect(
      sent.some(
        (s) =>
          s.path === `${S}/count` &&
          s.search.get('enabled') === 'false' &&
          s.search.get('capability') === 'manage-users',
      ),
    ).toBe(true);
  });
});

it('says when the list is narrowed to one role or group, and lets that go', async () => {
  const user = userEvent.setup();
  const role = '01a0e72d-7fc7-7950-a1e7-00000000000a';
  const { sent, router } = renderConsoleAt(`/console/acme/subjects?role=${role}`, routes());
  expect(await screen.findByText(/Only subjects holding the role/u)).toBeVisible();
  expect(sent.some((s) => s.path === S && s.search.get('role') === role)).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Show every role' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({});
  });
});

it('offers no creation to an operator who can only look', async () => {
  renderConsoleAt('/console/acme/subjects', routes(['view-users']));
  await screen.findByRole('grid', { name: 'Subjects' });
  expect(screen.queryByRole('link', { name: 'Create a subject' })).toBeNull();
});

it('says which capability a refused list needs', async () => {
  renderConsoleAt(
    '/console/acme/subjects',
    subjectRoutes(['manage-clients'], {
      [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  expect(await screen.findByRole('note')).toHaveTextContent(/view-users/u);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/subjects', routes()).element,
      () => screen.findByRole('grid', { name: 'Subjects' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
