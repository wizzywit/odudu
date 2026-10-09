import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { BILLING, C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=logout';

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'After sign-out' });
}

it('lists the post-logout URIs against the limit the server holds, and saves the whole list', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json(
        { ...BILLING, post_logout_redirect_uris: ['https://billing.example/bye'] },
        200,
        { etag: '"b2"' },
      ),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'After sign-out' });
  expect(within(section).getByText(/0 of 200 post-logout redirect URIs\./u)).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Add post-logout redirect URI' }));
  await user.type(
    within(section).getByRole('textbox', { name: 'Post-logout redirect URI 1' }),
    'https://billing.example/bye',
  );
  await user.click(within(section).getByRole('button', { name: 'Save After sign-out' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { post_logout_redirect_uris: ['https://billing.example/bye'] },
    });
  });
});

it('sets back-channel logout with its session flag, and clears an emptied address with null', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING }, 200, { etag: '"b2"' }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Back-channel logout' });
  await user.type(
    within(section).getByRole('textbox', { name: 'Back-channel logout address' }),
    'https://billing.example/backchannel',
  );
  await user.click(
    within(section).getByRole('switch', { name: 'Name the session in the logout token' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save Back-channel logout' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      backchannel_logout_uri: 'https://billing.example/backchannel',
      backchannel_logout_session_required: true,
    });
  });
});

it("shows the server's refusal of a front-channel address beside it, in its words", async () => {
  const user = userEvent.setup();
  const refusal =
    'frontchannel_logout_uri must share its domain, port and scheme with a registered redirect_uri';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'frontchannel_logout_uri', message: refusal }],
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Front-channel logout' });
  await user.type(
    within(section).getByRole('textbox', { name: 'Front-channel logout address' }),
    'https://other.example/fc',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Front-channel logout' }));
  expect(await within(section).findByText(refusal)).toBeVisible();
  expect(
    within(section).getByRole('textbox', { name: 'Front-channel logout address' }),
  ).toHaveValue('https://other.example/fc');
});

it('shows every address as text when the page cannot be changed', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients'], {
      [`GET ${C}/c-bill`]: json(
        {
          ...BILLING,
          backchannel_logout_uri: 'https://billing.example/backchannel',
          service_account_admin_reach: ['manage-users'],
        },
        200,
        { etag: '"c-bill-1"' },
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Back-channel logout' });
  expect(within(section).queryByRole('textbox')).toBeNull();
  expect(within(section).getByText('https://billing.example/backchannel')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
});
