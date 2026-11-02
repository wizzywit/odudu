import { focusManager } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, pending, SESSION_ENDED } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, GRACE, renderConsoleAt, whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const HOPPER = { tenant: 'acme', subject_id: 's2', username: 'hopper' };
const WHOAMI = `GET ${ACME_ADMIN}/whoami`;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  resetConsole();
});

it('shows the sign-in card to nobody signed in, and the way to the tenant sign-in', async () => {
  const user = userEvent.setup();
  const { leavePage } = renderConsoleAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
  expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Which tenant do you administer?' }), 'acme');
  await user.click(screen.getByRole('button', { name: 'Continue to sign-in' }));
  expect(leavePage).toHaveBeenCalledOnce();
  const login = new URL(leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(login.pathname).toBe('/console/auth/login');
  expect(login.searchParams.get('tenant')).toBe('acme');
});

it('says the session is being read while the answer is awaited', async () => {
  renderConsoleAt('/console/', { 'GET /console/api/session': pending() });
  expect(await screen.findByRole('status')).toHaveTextContent('Reading your session');
});

it('asks who to continue as when another tab signed in as somebody else', async () => {
  const user = userEvent.setup();
  const tab = renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    [WHOAMI]: whoami([]),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  tab.routes['GET /console/api/session'] = json(HOPPER);
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Signed in as somebody else' }),
  ).toBeVisible();
  expect(screen.getByText(/now signed in as/u)).toHaveTextContent(
    'This browser is now signed in as hopper in acme.',
  );
  expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Continue as hopper' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  act(() => {
    focusManager.setFocused(undefined);
  });
});

it('renders the page behind it for a signed-in principal', async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    [WHOAMI]: whoami([]),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  expect(screen.getByText(/Signed in as/u)).toHaveTextContent('Signed in as grace');
});

it('passes axe in both themes, signed out', async () => {
  const signedOut = () => consoleAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
  expect(
    await axeInBothThemes(
      () => signedOut().element,
      () => screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
