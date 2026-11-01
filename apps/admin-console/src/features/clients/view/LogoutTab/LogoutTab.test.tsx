import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { ADMIN, BILLING, C, clientRoutes } from '#/testing/clientsFixtures';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

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

const WARNING =
  'When this is on, anyone who holds an ID token this application received, even an expired one, can sign its users out by opening a link while their session lasts, with no confirmation. Turn it on only for an application you run yourself whose ID tokens never reach a browser or a log.';

const SKIP = 'Skip the sign-out confirmation';

it('shows the warning beside the toggle, off by default, in plain words', async () => {
  renderConsoleAt(AT, clientRoutes());
  const toggle = await screen.findByRole('switch', { name: SKIP });
  expect(toggle).not.toBeChecked();
  const section = screen.getByRole('region', { name: 'Sign-out confirmation' });
  expect(within(section).getByText(WARNING)).toBeVisible();
  expect(within(section).getByText(WARNING)).not.toHaveAttribute('data-tone');
  expect(
    within(section).getByText('Off: the person is always asked to confirm sign-out.'),
  ).toBeVisible();
});

it("reads the hint and the warning as the switch's description, off and on", async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientRoutes());
  const toggle = await screen.findByRole('switch', { name: SKIP });
  expect(toggle).toHaveAccessibleDescription(
    expect.stringContaining('Off: the person is always asked to confirm sign-out.'),
  );
  expect(toggle).toHaveAccessibleDescription(expect.stringContaining(WARNING));
  await user.click(toggle);
  expect(toggle).toHaveAccessibleDescription(expect.stringContaining(WARNING));
});

it('changes the hint with the switch and keeps the warning described, off and on', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientRoutes());
  const section = await screen.findByRole('region', { name: 'Sign-out confirmation' });
  const toggle = await within(section).findByRole('switch', { name: SKIP });
  const off = 'Off: the person is always asked to confirm sign-out.';
  const on = "On: signing out with this application's ID token ends the session without asking.";
  expect(within(section).getByText(off)).toBeVisible();
  expect(within(section).queryByText(on)).toBeNull();
  await user.click(toggle);
  expect(within(section).getByText(on)).toBeVisible();
  expect(within(section).queryByText(off)).toBeNull();
  expect(toggle).toHaveAccessibleDescription(expect.stringContaining(on));
  expect(toggle).toHaveAccessibleDescription(expect.stringContaining(WARNING));
  expect(within(section).getByText(WARNING)).toBeVisible();
  await user.click(toggle);
  expect(within(section).getByText(off)).toBeVisible();
});

it('sets the warning apart once the toggle is on, and saves it with the ETag it read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, skip_logout_confirmation: true }, 200, {
        etag: '"b2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Sign-out confirmation' });
  await user.click(await within(section).findByRole('switch', { name: SKIP }));
  expect(within(section).getByText(WARNING)).toHaveAttribute('data-tone', 'warning');
  await user.click(within(section).getByRole('button', { name: 'Save Sign-out confirmation' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { skip_logout_confirmation: true },
    });
  });
  expect(await within(section).findByRole('switch', { name: SKIP })).toBeChecked();
});

it('says the setting changed elsewhere on a 412, keeps the edit on the new version and sends nothing more', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: inTurn(
        json(BILLING, 200, { etag: '"c-bill-1"' }),
        json({ ...BILLING, skip_logout_confirmation: true }, 200, { etag: '"c-bill-2"' }),
      ),
      [`PATCH ${C}/c-bill`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Sign-out confirmation' });
  await user.click(await within(section).findByRole('switch', { name: SKIP }));
  await user.click(within(section).getByRole('button', { name: 'Save Sign-out confirmation' }));
  expect(await within(section).findByText(/changed elsewhere/u)).toBeVisible();
  expect(within(section).getByRole('switch', { name: SKIP })).toBeChecked();
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
});

it("the built-in client's toggle is on and not editable", async () => {
  renderConsoleAt('/console/acme/clients/c-admin?tab=logout', clientRoutes());
  const section = await screen.findByRole('region', { name: 'Sign-out confirmation' });
  expect(await within(section).findByText('On')).toBeVisible();
  expect(within(section).queryByRole('switch')).toBeNull();
  expect(
    within(section).getByText(/odudu-admin always signs out at once and this cannot be changed/u),
  ).toBeVisible();
  expect(ADMIN.skip_logout_confirmation).toBe(true);
  expect(within(section).queryByText(/Off: the person is always asked/u)).toBeNull();
  expect(within(section).getByText(WARNING)).not.toHaveAttribute('data-tone');
});

it('a limited user sees it disabled', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients'], {
      [`GET ${C}/c-bill`]: json(
        { ...BILLING, service_account_admin_reach: ['manage-users'] },
        200,
        { etag: '"c-bill-1"' },
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Sign-out confirmation' });
  expect(within(section).queryByRole('switch')).toBeNull();
  expect(within(section).getByText('Off')).toBeVisible();
  expect(within(section).getByText(WARNING)).toBeVisible();
});

it('the toggle passes axe in both themes', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      async () => {
        const toggle = await screen.findByRole('switch', { name: SKIP });
        if (!(toggle as HTMLInputElement).checked) await user.click(toggle);
        expect(toggle).toBeChecked();
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
});
