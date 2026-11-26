import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, problem, type Answer } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { AS, assistantAnswer, settingsRoutes } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/settings';

function section() {
  return screen.findByRole('region', { name: 'Console assistant' });
}

function withAssistant(capabilities?: readonly string[], extra: Record<string, Answer> = {}) {
  return settingsRoutes(capabilities, { [`GET ${AS}`]: assistantAnswer(), ...extra });
}

it('adds a section for the assistant, with its settings in three groups and each default said', async () => {
  renderConsoleAt(AT, withAssistant());
  const assistant = await section();
  for (const group of ['Availability', 'Privacy and records', 'Limits']) {
    expect(within(assistant).getByText(group)).toBeVisible();
  }
  expect(within(assistant).getByRole('switch', { name: 'Offer the assistant' })).toBeChecked();
  expect(within(assistant).getByRole('switch', { name: 'Mask email addresses' })).not.toBeChecked();
  expect(within(assistant).getByRole('textbox', { name: 'Keep traces for' })).toHaveValue('30');
  expect(within(assistant).getByText(/Default: 30 days/u)).toBeVisible();
  expect(within(assistant).getByText(/Default: 5,000,000 tokens/u)).toBeVisible();
  expect(within(assistant).getByText(/Allowed: 1 to 365 days/u)).toBeVisible();
  const nav = screen.getByRole('navigation', { name: 'On this page' });
  expect(within(nav).getByRole('link', { name: 'Console assistant' })).toHaveAttribute(
    'href',
    '#settings-assistant',
  );
});

it('saves the whole document on the ETag it was read with, after one change', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    withAssistant(undefined, {
      [`PUT ${AS}`]: assistantAnswer({ assistant_enabled: false }, '"a2"'),
    }),
  );
  const assistant = await section();
  await user.click(within(assistant).getByRole('switch', { name: 'Offer the assistant' }));
  await user.click(within(assistant).getByRole('button', { name: 'Save Console assistant' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"a1"',
      body: { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
    });
  });
  expect(
    await within(await section()).findByRole('switch', { name: 'Offer the assistant' }),
  ).not.toBeChecked();
});

it('sets the mode a person starts in', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    withAssistant(undefined, {
      [`PUT ${AS}`]: assistantAnswer({ assistant_default_mode: 'act' }, '"a2"'),
    }),
  );
  const assistant = await section();
  await user.click(within(assistant).getByRole('button', { name: /Starts in/u }));
  await user.click(await screen.findByRole('option', { name: /Act: it may propose changes/u }));
  await user.click(within(assistant).getByRole('button', { name: 'Save Console assistant' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toMatchObject({
      assistant_default_mode: 'act',
    });
  });
});

it('shows a 412 as the other administrator’s value beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    withAssistant(undefined, {
      [`PUT ${AS}`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${AS}`]: inTurn(
        assistantAnswer(),
        assistantAnswer({ assistant_max_concurrent: 9 }, '"a2"'),
      ),
    }),
  );
  const assistant = await section();
  const field = within(assistant).getByRole('textbox', { name: 'Answers at once' });
  await user.clear(field);
  await user.type(field, '7');
  await user.tab();
  await user.click(within(assistant).getByRole('button', { name: 'Save Console assistant' }));
  expect(await within(assistant).findByRole('button', { name: /Keep mine/u })).toBeVisible();
});

it('draws no section and keeps the page whole when the read is refused with 403', async () => {
  renderConsoleAt(
    AT,
    withAssistant(undefined, { [`GET ${AS}`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  await screen.findByRole('region', { name: 'General' });
  await waitFor(() => {
    expect(screen.queryByRole('region', { name: 'Console assistant' })).toBeNull();
  });
  expect(screen.queryByText('The assistant settings could not be loaded')).toBeNull();
});

it('puts the server’s refusal of a value under its field', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    withAssistant(undefined, {
      [`PUT ${AS}`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [{ path: 'assistant_max_concurrent', message: 'must be <= 50' }],
      }),
    }),
  );
  const assistant = await section();
  const field = within(assistant).getByRole('textbox', { name: 'Answers at once' });
  await user.clear(field);
  await user.type(field, '9');
  await user.tab();
  await user.click(within(assistant).getByRole('button', { name: 'Save Console assistant' }));
  expect(await within(assistant).findByText('must be <= 50')).toBeVisible();
});

it('shows a reader who may not change it the settings as text, with the capability it needs', async () => {
  renderConsoleAt(AT, withAssistant(['manage-tenant', 'read-assistant-activity']));
  const assistant = await section();
  expect(
    within(assistant).getByText(/You can view the assistant settings but not change them/u),
  ).toBeVisible();
  expect(within(assistant).getByText('manage-assistant')).toBeVisible();
  expect(within(assistant).queryByRole('switch')).toBeNull();
  expect(within(assistant).queryByRole('button', { name: /Save/u })).toBeNull();
});

it('reads nothing of the assistant for a caller with no business there', async () => {
  const { calls } = renderConsoleAt(AT, withAssistant(['manage-tenant']));
  await screen.findByRole('region', { name: 'General' });
  expect(screen.queryByRole('region', { name: 'Console assistant' })).toBeNull();
  expect(calls.some((call) => call.path === AS)).toBe(false);
});

it('draws no section where the deployment has no assistant, and lists none', async () => {
  renderConsoleAt(
    AT,
    withAssistant(undefined, { [`GET ${AS}`]: problem(404, 'about:blank', 'Not Found') }),
  );
  await screen.findByRole('region', { name: 'General' });
  await waitFor(() => {
    expect(screen.queryByRole('region', { name: 'Console assistant' })).toBeNull();
  });
  const nav = screen.getByRole('navigation', { name: 'On this page' });
  expect(within(nav).queryByRole('link', { name: 'Console assistant' })).toBeNull();
  expect(within(nav).getAllByRole('link')).toHaveLength(15);
});

it('says the settings could not be loaded and offers to try again', async () => {
  renderConsoleAt(
    AT,
    withAssistant(undefined, {
      [`GET ${AS}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
    }),
  );
  expect(await screen.findByText('The assistant settings could not be loaded')).toBeVisible();
});

it('passes axe in both themes, editable and read-only', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, withAssistant()).element,
      () => section(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, withAssistant(['manage-tenant', 'read-assistant-activity'])).element,
      () => section(),
    ),
  ).toEqual({ light: [], dark: [] });
});
