import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ADA_AT, ADA_ID, S, subject, subjectRoutes } from '#/testing/subjectsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=required-actions`;
const RA = `${S}/${ADA_ID}/required-actions`;

it('asks for actions at the next sign-in, on the ETag it read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${RA}`]: json({ actions: ['configure-totp'] }, 200, { etag: '"a1"' }),
      [`PUT ${RA}`]: json({ actions: ['update-password', 'configure-totp'] }, 200, {
        etag: '"a2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Required actions' });
  expect(
    within(section).getByRole('checkbox', { name: 'Set up an authenticator app' }),
  ).toBeChecked();
  await user.click(within(section).getByRole('checkbox', { name: 'Choose a new password' }));
  await user.click(within(section).getByRole('button', { name: 'Save Required actions' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"a1"',
      body: { actions: ['update-password', 'configure-totp'] },
    });
  });
});

it('offers the address check, the profile and the terms, in the order a sign-in asks', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${RA}`]: json({ actions: [] }, 200, { etag: '"a1"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Required actions' });
  expect(
    within(section)
      .getAllByRole('checkbox')
      .map((box) => box.getAttribute('name') ?? ''),
  ).toHaveLength(7);
  const labels = within(section)
    .getAllByRole('checkbox')
    .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent ?? '');
  expect(labels[0]).toContain('Verify the email address');
  expect(labels[5]).toContain('Complete the profile');
  expect(labels[6]).toContain('Accept the terms');
});

it('says why the server refused an action, in its own words', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${RA}`]: json({ actions: [] }, 200, { etag: '"a1"' }),
      [`PUT ${RA}`]: json(
        {
          type: 'about:blank#terms-not-configured',
          title: 'Conflict',
          status: 409,
          detail:
            'the tenant has no terms_uri, so accept-terms cannot be owed; set it with PATCH /settings first',
        },
        409,
        { 'content-type': 'application/problem+json' },
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Required actions' });
  await user.click(within(section).getByRole('checkbox', { name: 'Accept the terms' }));
  await user.click(within(section).getByRole('button', { name: 'Save Required actions' }));
  expect(await within(section).findByText(/the tenant has no terms_uri/u)).toBeVisible();
});

it('shows a limited operator what is asked, as text', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(['view-users'], {
      [`GET ${RA}`]: json({ actions: ['configure-passkey'] }, 200, { etag: '"a1"' }),
    }),
  );
  expect(await screen.findByText('Register a passkey')).toBeVisible();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('says a service subject is asked nothing', async () => {
  const bot = subject(ADA_ID, null, { type: 'service' });
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, { [`GET ${S}/${ADA_ID}`]: json(bot, 200, { etag: '"b1"' }) }),
  );
  expect(await screen.findByText(/is asked for nothing at sign-in/u)).toBeVisible();
  expect(sent.some((s) => s.path === RA)).toBe(false);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, subjectRoutes()).element,
      () => screen.findByRole('checkbox', { name: 'Choose a new password' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
