import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { cachedSettingsEtag } from '#/testing/consoleState';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import {
  flowAnswer,
  flowRoutes,
  FL,
  FLOW_ITEMS,
  settingsAnswer,
  ST,
  step,
} from '#/testing/flowFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/flow';

async function steps() {
  return screen.findByRole('region', { name: 'Steps' });
}

function names(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('code')?.textContent ?? '');
}

it('lists the steps in their order, each with its requirement', async () => {
  renderConsoleAt(AT, flowRoutes());
  const section = await steps();
  const list = within(section).getByRole('list', { name: 'Sign-in steps' });
  expect(names(list)).toEqual(['passkey', 'password', 'otp']);
  expect(within(list).getByRole('button', { name: /Requirement for password/u })).toHaveTextContent(
    'Alternative',
  );
});

it('sets the one-time password requirement beside its step, and says what it is now', async () => {
  renderConsoleAt(AT, flowRoutes());
  const section = await steps();
  const row = within(section).getAllByRole('listitem')[2];
  expect(row).toHaveTextContent('Asked only of subjects who set up an authenticator app.');
  const otp = await screen.findByRole('region', { name: 'One-time password' });
  expect(within(otp).getByRole('switch', { name: /Ask every subject/u })).not.toBeChecked();
});

it('moves a step, then saves the whole order on the ETag it was read with', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`PUT ${FL}`]: flowAnswer(
        [
          step(0, 'password', 'alternative'),
          step(1, 'passkey', 'alternative'),
          step(2, 'otp', 'conditional'),
        ],
        '"f2"',
      ),
    }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  expect(names(within(section).getByRole('list', { name: 'Sign-in steps' }))).toEqual([
    'password',
    'passkey',
    'otp',
  ]);
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"f1"',
      body: [
        { authenticator: 'password', requirement: 'alternative' },
        { authenticator: 'passkey', requirement: 'alternative' },
        { authenticator: 'otp', requirement: 'conditional' },
      ],
    });
  });
});

it('keeps the focus on the step moved, and on the way back once it can go no further', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, flowRoutes());
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  await waitFor(() => {
    expect(within(section).getByRole('button', { name: 'Move password down' })).toHaveFocus();
  });
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(within(section).getByRole('button', { name: 'Move password down' })).toHaveFocus();
  });
  expect(names(within(section).getByRole('list', { name: 'Sign-in steps' }))).toEqual([
    'passkey',
    'password',
    'otp',
  ]);
});

it('offers no move past either end', async () => {
  renderConsoleAt(AT, flowRoutes());
  const section = await steps();
  expect(within(section).getByRole('button', { name: 'Move passkey up' })).toBeDisabled();
  expect(within(section).getByRole('button', { name: 'Move otp down' })).toBeDisabled();
});

it('disables a step by its requirement, and saves it as disabled', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`PUT ${FL}`]: flowAnswer(FLOW_ITEMS, '"f2"') }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: /Requirement for otp/u }));
  await user.click(await screen.findByRole('option', { name: 'Disabled' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual([
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
      { authenticator: 'otp', requirement: 'disabled' },
    ]);
  });
});

it('adds a step from what the server offers, at the end', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`PUT ${FL}`]: flowAnswer(FLOW_ITEMS, '"f2"') }),
  );
  const section = await steps();
  expect(within(section).getByRole('button', { name: /Add a step/u })).toHaveTextContent(
    'recovery-code',
  );
  await user.click(within(section).getByRole('button', { name: 'Add step' }));
  expect(names(within(section).getByRole('list', { name: 'Sign-in steps' }))).toEqual([
    'passkey',
    'password',
    'otp',
    'recovery-code',
  ]);
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toContainEqual({
      authenticator: 'recovery-code',
      requirement: 'conditional',
    });
  });
});

it('says every authenticator is in the flow when there is none left to add', async () => {
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FL}`]: flowAnswer([...FLOW_ITEMS, step(3, 'recovery-code', 'conditional')]),
    }),
  );
  const section = await steps();
  expect(within(section).getByText(/already a step/u)).toBeVisible();
  expect(within(section).queryByRole('button', { name: 'Add step' })).toBeNull();
});

it('saves a second time on the ETag the first save answered', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`PUT ${FL}`]: inTurn(flowAnswer(FLOW_ITEMS, '"f2"'), flowAnswer(FLOW_ITEMS, '"f3"')),
    }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(within(section).queryByRole('button', { name: 'Save Steps' })).toBeNull();
  });
  await user.click(within(section).getByRole('button', { name: 'Move otp up' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PUT').map((s) => s.ifMatch)).toEqual(['"f1"', '"f2"']);
  });
});

it('says beside Save that no step is enabled, in the console’s words', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`PUT ${FL}`]: problem(400, 'about:blank#flow-no-enabled-step', 'Bad Request'),
    }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent(
    'Every step is disabled, so nobody could sign in.',
  );
});

it('says beside Save that nothing can start a sign-in', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`PUT ${FL}`]: problem(400, 'about:blank#flow-no-first-challenge', 'Bad Request'),
    }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent(
    'only the password step can run',
  );
});

it('shows a 412 as a change elsewhere, keeping the edit', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`PUT ${FL}`]: problem(412, 'about:blank', 'Precondition Failed') }),
  );
  const section = await steps();
  await user.click(within(section).getByRole('button', { name: 'Move password up' }));
  await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
  expect(await within(section).findByText(/Sign-in flow changed elsewhere/u)).toBeVisible();
  expect(names(within(section).getByRole('list', { name: 'Sign-in steps' }))[0]).toBe('password');
});

it('saves the one-time password setting on the settings ETag, and nothing else', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer(true, '"s2"') }),
  );
  const otp = await screen.findByRole('region', { name: 'One-time password' });
  await user.click(within(otp).getByRole('switch', { name: /Ask every subject/u }));
  await user.click(within(otp).getByRole('button', { name: 'Save One-time password' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { otp_required: true },
    });
  });
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
});

it('saves the one-time password under the record the Settings page reads, so a save rebases it', async () => {
  const user = userEvent.setup();
  const { queryClient } = renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`PATCH ${ST}`]: settingsAnswer(true, '"s2"') }),
  );
  const otp = await screen.findByRole('region', { name: 'One-time password' });
  await user.click(within(otp).getByRole('switch', { name: /Ask every subject/u }));
  await user.click(within(otp).getByRole('button', { name: 'Save One-time password' }));
  await waitFor(() => {
    expect(cachedSettingsEtag(queryClient, 'acme')).toBe('"s2"');
  });
});

it('says the flow has no one-time password step when it has none', async () => {
  renderConsoleAt(
    AT,
    flowRoutes(undefined, { [`GET ${FL}`]: flowAnswer([step(0, 'password', 'required')]) }),
  );
  const otp = await screen.findByRole('region', { name: 'One-time password' });
  expect(within(otp).getByText(/no effect until one is added/u)).toBeVisible();
});

it('names manage-tenant for a caller without it', async () => {
  renderConsoleAt(AT, flowRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-tenant');
});

it('says the flow could not be loaded and offers to try again', async () => {
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FL}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
    }),
  );
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
});

it('says the one-time password setting could not be read, leaving the steps to edit', async () => {
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${ST}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
    }),
  );
  const section = await steps();
  expect(within(section).getByRole('button', { name: 'Move password up' })).toBeVisible();
  expect(await screen.findByText(/one-time password setting could not be loaded/u)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'One-time password' })).toBeNull();
});

it('passes axe in both themes, edited, refused and conflicted', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, flowRoutes()).element,
      () => steps(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, flowRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          flowRoutes(undefined, {
            [`PUT ${FL}`]: problem(400, 'about:blank#flow-no-enabled-step', 'Bad Request'),
          }),
        ).element,
      async () => {
        const section = await steps();
        await user.click(within(section).getByRole('button', { name: 'Move password up' }));
        await user.click(within(section).getByRole('button', { name: 'Save Steps' }));
        return within(section).findByRole('alert');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
