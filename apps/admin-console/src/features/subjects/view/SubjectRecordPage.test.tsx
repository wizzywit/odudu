import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole, whoami } from '#/testing/renderConsole.tsx';
import { ADA_AT, ADA_ID, S, subject, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it('heads the record with the username, its status, and a tab per concern', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'ada' })).toBeVisible();
  expect(screen.getAllByText('enabled')[0]).toBeVisible();
  const tabs = screen.getByRole('tablist', { name: 'Subject sections' });
  expect(tabs).toHaveTextContent('Profile');
  expect(tabs).toHaveTextContent('Credentials');
  expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
});

it('climbs back to the subjects through a breadcrumb', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes());
  await screen.findByRole('heading', { level: 1, name: 'ada' });
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'Subjects' })).toHaveAttribute(
    'href',
    '/console/acme/subjects',
  );
  expect(within(trail).getByText('ada')).toHaveAttribute('aria-current', 'page');
});

it('keeps the tab in the address', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(ADA_AT, subjectRoutes());
  await user.click(await screen.findByRole('tab', { name: 'Credentials' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({ tab: 'credentials' });
  });
  expect(await screen.findByRole('heading', { level: 2, name: 'Password' })).toBeVisible();
});

it('names a subject with no username by its kind and id', async () => {
  const bot = subject(ADA_ID, null, { type: 'service' });
  renderConsoleAt(ADA_AT, subjectRoutes(undefined, { [`GET ${S}/${ADA_ID}`]: json(bot) }));
  expect(await screen.findByRole('heading', { level: 1, name: `service ${ADA_ID}` })).toBeVisible();
});

it('says a subject that does not exist is not there', async () => {
  renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      [`GET ${S}/${ADA_ID}`]: problem(404, 'about:blank', 'Not Found'),
    }),
  );
  expect(await screen.findByText('No such subject')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(ADA_AT, subjectRoutes()).element,
      () => screen.findByRole('tablist', { name: 'Subject sections' }),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('marks the Profile tab while one of its sections holds an edit', async () => {
  const user = userEvent.setup();
  renderConsoleAt(ADA_AT, subjectRoutes());
  await user.type(await screen.findByRole('textbox', { name: 'Full name' }), 'Ada');
  expect(screen.getByRole('tab', { name: 'Profile, unsaved changes' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Credentials' })).toBeVisible();
});

it('follows a whoami re-read after a 403, in the rail and on the page, without a reload', async () => {
  const user = userEvent.setup();
  let revoked = false;
  const refused = problem(403, 'about:blank', 'Forbidden');
  renderConsoleAt(
    ADA_AT,
    subjectRoutes(undefined, {
      'GET /console/api/admin/tenants/acme/whoami': (request) =>
        whoami(revoked ? ['view-users'] : ['view-users', 'manage-users', 'manage-clients'])(
          request,
        ),
      [`PATCH ${S}/${ADA_ID}/profile`]: (request) => {
        revoked = true;
        return refused(request);
      },
    }),
  );
  const rail = await screen.findByRole('navigation', { name: 'Areas of acme' });
  expect(await within(rail).findByRole('link', { name: 'Clients' })).toBeVisible();
  await user.type(await screen.findByRole('textbox', { name: 'Nickname' }), 'Countess');
  await user.click(screen.getByRole('button', { name: 'Save Name' }));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'You can view subjects but not change them (needs manage-users).',
  );
  expect(within(rail).queryByRole('link', { name: 'Clients' })).toBeNull();
  expect(within(rail).getByRole('link', { name: 'Subjects' })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  // The refused edit is kept, marked as never saved, with only a way to drop it.
  expect(screen.queryByRole('button', { name: /^Save/u })).toBeNull();
  expect(screen.getByText('Countess').closest('dd')).toHaveTextContent('Countess · not saved');
  const name = screen.getByRole('region', { name: 'Name' });
  expect(within(name).getByRole('status')).toHaveTextContent(
    'Your change here was not saved and cannot be saved now.',
  );
  expect(screen.getByRole('tab', { name: 'Profile, unsaved changes' })).toBeVisible();
  await user.click(within(name).getByRole('button', { name: 'Discard your change to Name' }));
  expect(screen.queryByText(/not saved/u)).toBeNull();
  expect(screen.getByRole('tab', { name: 'Profile' })).toBeVisible();
  expect(useUnsavedGuard.getState().dirty.size).toBe(0);
});

it('reads whoami once, however many parts of the page ask what it says', async () => {
  const { sent } = renderConsoleAt(ADA_AT, subjectRoutes());
  await screen.findByRole('textbox', { name: 'Nickname' });
  expect(sent.filter((s) => s.path.endsWith('/whoami'))).toHaveLength(1);
});
