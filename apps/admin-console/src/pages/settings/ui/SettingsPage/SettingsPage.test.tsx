import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { SETTINGS_WORDS } from '#/pages/settings/services/settingsPageWords';
import { settingsAnswer, settingsRoutes, ST } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/settings';

function section(name: string) {
  return screen.findByRole('region', { name });
}

it('has a section for each concern, each with its own save', async () => {
  renderConsoleAt(AT, settingsRoutes());
  await section('General');
  const names = screen
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label') ?? '');
  expect(names.length).toBeGreaterThanOrEqual(10);
  for (const title of [
    'General',
    'Sessions',
    'Remember me',
    'Registration and recovery',
    'Usernames',
    'Authenticators',
    'Password policy',
    'Brute force',
    'Token lifetimes',
    'Client registration',
    'Agents',
    'Audit retention',
  ]) {
    expect(screen.getByRole('region', { name: title })).toBeVisible();
  }
});

it('lists the sections as links, each sending the focus to its heading', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  await section('General');
  const nav = screen.getByRole('navigation', { name: 'On this page' });
  expect(within(nav).getAllByRole('link')).toHaveLength(15);
  expect(within(nav).getByRole('link', { name: 'Password policy' })).toHaveAttribute(
    'href',
    '#settings-password',
  );
  await user.click(within(nav).getByRole('link', { name: 'Password policy' }));
  expect(screen.getByRole('heading', { level: 2, name: 'Password policy' })).toHaveFocus();
  expect(globalThis.location.hash).toBe('#settings-password');
  await user.tab();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  await user.click(within(nav).getByRole('link', { name: 'Audit retention' }));
  expect(screen.getByRole('heading', { level: 2, name: 'Audit retention' })).toHaveFocus();
});

it('marks the section in view in the list once the settings have loaded', async () => {
  const observed: Element[] = [];
  let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => undefined;
  class Observer {
    constructor(callback: typeof notify) {
      notify = callback;
    }
    observe = (element: Element): void => {
      observed.push(element);
    };
    disconnect = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  try {
    renderConsoleAt(AT, settingsRoutes());
    await section('General');
    await waitFor(() => {
      expect(observed.length).toBe(15);
    });
    const terms = observed.find(
      (element) => element.getAttribute('aria-labelledby') === 'settings-terms',
    );
    if (terms === undefined) throw new Error('the Terms section was not observed');
    act(() => {
      notify([{ target: terms, isIntersecting: true }]);
    });
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(nav).getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it('marks a section with unsaved edits in the list', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  const clients = await section('Client registration');
  const nav = screen.getByRole('navigation', { name: 'On this page' });
  expect(within(nav).queryByText('(unsaved changes)')).toBeNull();
  await user.click(within(clients).getByRole('switch', { name: SETTINGS_WORDS.cimdLabel }));
  expect(
    within(within(nav).getByRole('link', { name: /Client registration/u })).getByText(
      '(unsaved changes)',
    ),
  ).toBeInTheDocument();
});

it('shows a duration in the unit that fits it, and says the range once', async () => {
  renderConsoleAt(AT, settingsRoutes());
  const sessions = await section('Sessions');
  expect(within(sessions).getByRole('textbox', { name: 'Idle timeout' })).toHaveValue('30');
  expect(within(sessions).getByRole('combobox', { name: 'Idle timeout, unit' })).toHaveValue('min');
  expect(within(sessions).queryByText('1800 s · 30 minutes')).toBeNull();
  expect(within(sessions).getAllByText(/Allowed: 1 minute to/u).length).toBeGreaterThan(0);
  const password = await section('Password policy');
  expect(within(password).getByText('Allowed: 8 to 256 characters.')).toBeVisible();
  expect(within(password).queryByText('15 characters')).toBeNull();
});

it('sends seconds whichever unit a duration is typed in', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer({ sso_session_idle_seconds: 7200 }, '"s2"'),
    }),
  );
  const sessions = await section('Sessions');
  expect(
    within(within(sessions).getByRole('combobox', { name: 'Idle timeout, unit' })).getByRole(
      'option',
      {
        name: 'h',
      },
    ),
  ).toBeDisabled();
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.type(field, '120');
  await user.tab();
  await user.click(within(sessions).getByRole('button', { name: 'Save Sessions' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      sso_session_idle_seconds: 7200,
    });
  });
});

it('shows the agent limits with their ranges and saves one on its own', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer({ agent_max_delegation_depth: 5 }, '"s2"'),
    }),
  );
  const agents = await section('Agents');
  const depth = within(agents).getByRole('textbox', { name: 'Delegation depth' });
  expect(depth).toHaveValue('3');
  expect(within(agents).getByText(/Allowed: 1 to 8 levels/u)).toBeVisible();
  expect(within(agents).getByRole('textbox', { name: 'Writes per day' })).toHaveValue('1000');
  await user.clear(depth);
  await user.type(depth, '5');
  await user.tab();
  await user.click(within(agents).getByRole('button', { name: 'Save Agents' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ agent_max_delegation_depth: 5 });
  });
});

it('flags a duration outside the range before the server is asked', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  const sessions = await section('Sessions');
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.type(field, '0');
  await user.tab();
  expect(field).toHaveAttribute('aria-invalid', 'true');
});

it('saves one section on the ETag it was read with, sending only what changed', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer({ sso_session_idle_seconds: 3600 }, '"s2"'),
    }),
  );
  const sessions = await section('Sessions');
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.type(field, '60');
  await user.tab();
  await user.click(within(sessions).getByRole('button', { name: 'Save Sessions' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { sso_session_idle_seconds: 3600 },
    });
  });
  expect(await within(sessions).findByRole('textbox', { name: 'Idle timeout' })).toHaveValue('60');
});

it('keeps a cleared number as it was rather than sending nothing for it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  const sessions = await section('Sessions');
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.tab();
  expect(field).toHaveValue('30');
  expect(within(sessions).queryByRole('button', { name: 'Save Sessions' })).toBeNull();
});

it('sets a switch and a choice', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer({}, '"s2"') }),
  );
  const registration = await section('Registration and recovery');
  await user.click(within(registration).getByRole('switch', { name: 'Verify email addresses' }));
  await user.click(
    within(registration).getByRole('button', { name: 'Save Registration and recovery' }),
  );
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ verify_email: true });
  });
  const clients = await section('Client registration');
  await user.click(within(clients).getByRole('button', { name: /Policy/u }));
  await user.click(await screen.findByRole('option', { name: /With a registration token/u }));
  await user.click(within(clients).getByRole('button', { name: 'Save Client registration' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH').at(-1)?.body).toEqual({
      client_registration_policy: 'token',
    });
  });
});

it('sets the number an authenticator app shows as a choice, and sends it as text the server reads', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer({}, '"s2"') }),
  );
  const authenticators = await section('Authenticators');
  await user.click(within(authenticators).getByRole('button', { name: /Code length/u }));
  await user.click(await screen.findByRole('option', { name: '8 digits' }));
  await user.click(within(authenticators).getByRole('button', { name: 'Save Authenticators' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ totp_digits: '8' });
  });
});

it('offers the mcp policy and the metadata-document switch in the one section', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer(
        { client_registration_policy: 'mcp', cimd_enabled: true },
        '"s2"',
      ),
    }),
  );
  const clients = await section('Client registration');
  expect(within(clients).getByRole('switch', { name: SETTINGS_WORDS.cimdLabel })).not.toBeChecked();
  await user.click(within(clients).getByRole('button', { name: /Policy/u }));
  await user.click(await screen.findByRole('option', { name: SETTINGS_WORDS.mcpOption }));
  await user.click(within(clients).getByRole('switch', { name: SETTINGS_WORDS.cimdLabel }));
  await user.click(within(clients).getByRole('button', { name: 'Save Client registration' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { client_registration_policy: 'mcp', cimd_enabled: true },
    });
  });
});

it('shows an mcp tenant with the policy named and the switch on', async () => {
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`GET ${ST}`]: settingsAnswer({ client_registration_policy: 'mcp', cimd_enabled: true }),
    }),
  );
  const clients = await section('Client registration');
  expect(within(clients).getByRole('button', { name: /Policy/u })).toHaveTextContent(
    SETTINGS_WORDS.mcpOption,
  );
  expect(within(clients).getByRole('switch', { name: SETTINGS_WORDS.cimdLabel })).toBeChecked();
});

it('counts an edit to the switch as unsaved until it is saved', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  const clients = await section('Client registration');
  expect(within(clients).queryByRole('button', { name: 'Save Client registration' })).toBeNull();
  await user.click(within(clients).getByRole('switch', { name: SETTINGS_WORDS.cimdLabel }));
  expect(
    within(clients).getByRole('button', { name: 'Save Client registration' }),
  ).toBeInTheDocument();
});

it('shows a 412 on the policy as the other administrator’s value beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${ST}`]: inTurn(
        settingsAnswer(),
        settingsAnswer({ client_registration_policy: 'open' }, '"s2"'),
      ),
    }),
  );
  const clients = await section('Client registration');
  await user.click(within(clients).getByRole('button', { name: /Policy/u }));
  await user.click(await screen.findByRole('option', { name: SETTINGS_WORDS.mcpOption }));
  await user.click(within(clients).getByRole('button', { name: 'Save Client registration' }));
  expect(await within(clients).findByRole('button', { name: /Keep mine/u })).toBeVisible();
});

it('sends the events chosen as a list, and cannot leave out the two that are always kept', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer({}, '"s2"') }),
  );
  const audit = await section('Audit retention');
  expect(
    within(audit).getByRole('checkbox', { name: /Changes by administrators/u }),
  ).toBeDisabled();
  expect(within(audit).getByRole('checkbox', { name: /Reads by administrators/u })).toBeDisabled();
  await user.click(within(audit).getByRole('checkbox', { name: /Tokens issued/u }));
  await user.click(within(audit).getByRole('button', { name: 'Save Audit retention' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      audit_event_types: [
        'admin_mutation',
        'admin_access',
        'authentication',
        'session',
        'credential',
      ],
    });
  });
});

it('sends the profile fields chosen as a list, and may send none', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer({}, '"s2"') }),
  );
  const profile = await section('Profile');
  expect(within(profile).getByRole('checkbox', { name: 'Given name' })).toBeChecked();
  expect(within(profile).getByRole('checkbox', { name: 'Birthdate' })).not.toBeChecked();
  await user.click(within(profile).getByRole('checkbox', { name: 'Birthdate' }));
  await user.click(within(profile).getByRole('button', { name: 'Save Profile' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      required_profile_fields: ['given_name', 'family_name', 'birthdate'],
    });
  });
});

it('may send an empty list of profile fields, which makes the page one that is only reviewed', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer({}, '"s2"') }),
  );
  const profile = await section('Profile');
  await user.click(within(profile).getByRole('checkbox', { name: 'Given name' }));
  await user.click(within(profile).getByRole('checkbox', { name: 'Family name' }));
  await user.click(within(profile).getByRole('button', { name: 'Save Profile' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ required_profile_fields: [] });
  });
});

it('puts the server’s refusal of an ordering under the field it names', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: problem(400, 'about:blank', 'Bad Request', {
        detail: '1 tenant setting(s) refused',
        errors: [
          { path: 'sso_session_idle_seconds', message: 'must not exceed sso_session_max_seconds' },
        ],
      }),
    }),
  );
  const sessions = await section('Sessions');
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.type(field, '99999999');
  await user.tab();
  await user.click(within(sessions).getByRole('button', { name: 'Save Sessions' }));
  expect(
    await within(sessions).findByText('must not exceed sso_session_max_seconds'),
  ).toBeVisible();
});

it('shows the server’s refusal of the username mode under its field, not as a range', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: problem(400, 'about:blank', 'Bad Request', {
        detail: '3 tenant setting(s) refused, listed under errors',
        errors: [
          { path: 'registration_username', message: 'needs login_with_email and verify_email on' },
          {
            path: 'login_with_email',
            message: 'must stay on while registration_username is optional or generated',
          },
          {
            path: 'verify_email',
            message: 'must stay on while registration_username is optional or generated',
          },
        ],
      }),
    }),
  );
  const registration = await section('Registration and recovery');
  await user.click(within(registration).getByRole('button', { name: /Username at registration/u }));
  await user.click(await screen.findByRole('option', { name: 'Optional' }));
  await user.click(
    within(registration).getByRole('button', { name: 'Save Registration and recovery' }),
  );
  expect(
    await within(registration).findByText('needs login_with_email and verify_email on'),
  ).toBeVisible();
  expect(within(registration).queryByText(/permitted range/u)).toBeNull();
});

it('rebases another section on the ETag a save answered, keeping its edit', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: inTurn(
        settingsAnswer({ verify_email: true }, '"s2"'),
        settingsAnswer({ verify_email: true, username_editable: true }, '"s3"'),
      ),
    }),
  );
  const usernames = await section('Usernames');
  await user.click(within(usernames).getByRole('switch', { name: /can be renamed/u }));
  const registration = await section('Registration and recovery');
  await user.click(within(registration).getByRole('switch', { name: 'Verify email addresses' }));
  await user.click(
    within(registration).getByRole('button', { name: 'Save Registration and recovery' }),
  );
  await waitFor(() => {
    expect(
      within(registration).queryByRole('button', { name: 'Save Registration and recovery' }),
    ).toBeNull();
  });
  expect(within(usernames).getByRole('switch', { name: /can be renamed/u })).toBeChecked();
  await user.click(within(usernames).getByRole('button', { name: 'Save Usernames' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH').map((s) => s.ifMatch)).toEqual([
      '"s1"',
      '"s2"',
    ]);
  });
});

it('shows a 412 as the other administrator’s value beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${ST}`]: inTurn(
        settingsAnswer(),
        settingsAnswer({ sso_session_idle_seconds: 7200 }, '"s2"'),
      ),
    }),
  );
  const sessions = await section('Sessions');
  const field = within(sessions).getByRole('textbox', { name: 'Idle timeout' });
  await user.clear(field);
  await user.type(field, '3600');
  await user.tab();
  await user.click(within(sessions).getByRole('button', { name: 'Save Sessions' }));
  expect(await within(sessions).findByRole('button', { name: /Keep mine/u })).toBeVisible();
  expect(within(sessions).getByRole('button', { name: /Take theirs/u })).toBeVisible();
});

it('asks before disabling the tenant, and says whom that locks out', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer({ enabled: false }, '"s2"'),
    }),
  );
  const general = await section('General');
  await user.click(within(general).getByRole('switch', { name: 'Enabled' }));
  await user.click(within(general).getByRole('button', { name: 'Save General' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Your own console session in acme ends');
  expect(sent.some((s) => s.method === 'PATCH')).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(sent.some((s) => s.method === 'PATCH')).toBe(false);
  await user.click(within(general).getByRole('button', { name: 'Save General' }));
  await user.type(await screen.findByRole('textbox', { name: /Type acme/u }), 'acme');
  await user.click(screen.getByRole('button', { name: 'Disable acme' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { enabled: false },
    });
  });
});

it('saves a display name without asking', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer({ display_name: 'Acme Inc' }, '"s2"'),
    }),
  );
  const general = await section('General');
  const name = within(general).getByRole('textbox', { name: 'Display name' });
  await user.clear(name);
  await user.type(name, 'Acme Inc');
  await user.click(within(general).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ display_name: 'Acme Inc' });
  });
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('saves the terms address and version, and clears the address with an empty one', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`PATCH ${ST}`]: settingsAnswer(
        { terms_uri: 'https://example.com/terms', terms_version: '2026-01' },
        '"s2"',
      ),
    }),
  );
  const terms = await section('Terms');
  expect(within(terms).getByRole('textbox', { name: 'Terms address' })).toHaveValue('');
  expect(within(terms).getByRole('textbox', { name: 'Terms version' })).toHaveValue('1');
  await user.type(
    within(terms).getByRole('textbox', { name: 'Terms address' }),
    'https://example.com/terms',
  );
  const version = within(terms).getByRole('textbox', { name: 'Terms version' });
  await user.clear(version);
  await user.type(version, '2026-01');
  await user.click(within(terms).getByRole('button', { name: 'Save Terms' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      terms_uri: 'https://example.com/terms',
      terms_version: '2026-01',
    });
  });
});

it('names the manage-tenant capability for a caller without it, and reads nothing', async () => {
  const { calls } = renderConsoleAt(AT, settingsRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-tenant');
  expect(calls.some((call) => call.path === ST)).toBe(false);
});

it('says the settings could not be loaded and offers to try again', async () => {
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`GET ${ST}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
    }),
  );
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
});

it('passes axe in both themes, loaded, refused and with a field wrong', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, settingsRoutes()).element,
      () => section('General'),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, settingsRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          settingsRoutes(undefined, {
            [`PATCH ${ST}`]: problem(400, 'about:blank', 'Bad Request', {
              errors: [{ path: 'password_min_length', message: 'must be between 8 and 256' }],
            }),
          }),
        ).element,
      async () => {
        const password = await section('Password policy');
        const field = within(password).getByRole('textbox', { name: 'Minimum length' });
        await user.clear(field);
        await user.type(field, '4');
        await user.tab();
        await user.click(within(password).getByRole('button', { name: 'Save Password policy' }));
        return within(password).findByText('must be between 8 and 256');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('says a short minimum is only safe with a second factor, as a note and not an error', async () => {
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [`GET ${ST}`]: settingsAnswer({ password_min_length: 8 }) }),
  );
  const password = await section('Password policy');
  const note = within(password).getByRole('note');
  expect(note).toHaveTextContent(
    'A minimum under 15 is only safe when every sign-in needs a second factor.',
  );
  expect(within(password).queryByRole('alert')).toBeNull();
});

it('says nothing about a minimum of fifteen', async () => {
  renderConsoleAt(AT, settingsRoutes());
  const password = await section('Password policy');
  expect(within(password).queryByRole('note')).toBeNull();
});

it('says a short minimum is enough when every sign-in needs a second factor', async () => {
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [`GET ${ST}`]: settingsAnswer({ password_min_length: 8, otp_required: true }),
    }),
  );
  const password = await section('Password policy');
  expect(within(password).getByRole('note')).toHaveTextContent(
    'Every sign-in needs a second factor, so this minimum is enough.',
  );
});

it('follows the minimum as it is edited, without blocking the save', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, settingsRoutes());
  const password = await section('Password policy');
  const field = within(password).getByRole('textbox', { name: 'Minimum length' });
  await user.clear(field);
  await user.type(field, '10');
  await user.tab();
  expect(within(password).getByRole('note')).toHaveTextContent('A minimum under 15');
  await user.clear(field);
  await user.type(field, '16');
  await user.tab();
  expect(within(password).queryByRole('note')).toBeNull();
});
