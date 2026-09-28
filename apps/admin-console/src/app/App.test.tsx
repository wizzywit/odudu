import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '#/app/App.tsx';
import { createConsoleRouter } from '#/app/router.tsx';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import {
  fakeTransport,
  json,
  offline,
  problem,
  SESSION_ENDED,
  type Answer,
} from '#/testing/fakeTransport.ts';

const GRACE = { tenant: 'acme', subject_id: 's1', username: 'grace' };
const ROOT = { tenant: 'system', subject_id: 's0', username: 'root' };
const ALL = [
  'view-users',
  'manage-users',
  'manage-clients',
  'manage-tenant',
  'manage-keys',
  'manage-sessions',
  'view-audit',
];

function whoami(capabilities: readonly string[], crossTenant = false): Answer {
  return json({ subjectId: 's', issuerTenantId: 't', capabilities, crossTenant });
}

function renderAt(path: string, routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: [path] }));
  const view = render(
    <App router={router} transport={fake.transport} queryClient={createQueryClient()} />,
  );
  return { ...fake, router, unmount: view.unmount };
}

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body);
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}

function loginParams(url: string | undefined): URLSearchParams {
  const parsed = new URL(url ?? '', location.origin);
  expect(parsed.pathname).toBe('/console/auth/login');
  return parsed.searchParams;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  useToasts.setState({ toasts: [] });
  useUnsavedGuard.getState().reset();
  useDrafts.getState().forgetAll();
});

describe('booting from the session', () => {
  it('shows the tenant console to its signed-in administrator', async () => {
    renderAt('/console/acme', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Areas of acme' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'System authority' })).toBeNull();
    expect(screen.queryByText('Tenants')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('goes on from the bare console to the tenant signed in to', async () => {
    const { router } = renderAt('/console/', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(router.state.location.publicHref).toBe('/console/acme');
  });

  it('sends a tenant in the URL straight to its sign-in, returning to the same page', async () => {
    const { leavePage } = renderAt('/console/acme/clients?tab=tokens', {
      'GET /console/api/session': SESSION_ENDED,
    });
    await waitFor(() => {
      expect(leavePage).toHaveBeenCalled();
    });
    const params = loginParams(leavePage.mock.calls[0]?.[0]);
    expect(params.get('tenant')).toBe('acme');
    expect(params.get('return_to')).toBe('/console/acme/clients?tab=tokens');
    expect(screen.getByRole('status')).toHaveTextContent("Taking you to acme's sign-in");
  });

  it('sends ?tenant= straight to that tenant sign-in', async () => {
    const { leavePage } = renderAt('/console/?tenant=beta', {
      'GET /console/api/session': SESSION_ENDED,
    });
    await waitFor(() => {
      expect(leavePage).toHaveBeenCalled();
    });
    const params = loginParams(leavePage.mock.calls[0]?.[0]);
    expect(params.get('tenant')).toBe('beta');
    expect(params.get('return_to')).toBe('/console/beta');
  });

  it('asks the question instead when ?tenant= names no possible tenant', async () => {
    const { leavePage } = renderAt('/console/?tenant=Not_A_Tenant', {
      'GET /console/api/session': SESSION_ENDED,
    });
    expect(
      await screen.findByRole('textbox', { name: 'Which tenant do you administer?' }),
    ).toBeVisible();
    expect(leavePage).not.toHaveBeenCalled();
  });

  it('asks a fresh browser which tenant, refusing a name that cannot be one', async () => {
    const user = userEvent.setup();
    const { leavePage } = renderAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
    const field = await screen.findByRole('textbox', { name: 'Which tenant do you administer?' });
    expect(await violations()).toEqual([]);

    await user.type(field, 'Acme');
    await user.click(screen.getByRole('button', { name: 'Continue to sign-in' }));
    expect(field).toHaveAccessibleDescription(/A tenant name must be 1-63 lowercase letters/u);
    expect(leavePage).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, 'acme');
    await user.click(screen.getByRole('button', { name: 'Continue to sign-in' }));
    const params = loginParams(leavePage.mock.calls[0]?.[0]);
    expect(params.get('tenant')).toBe('acme');
    expect(params.get('return_to')).toBe('/console/acme');
  });

  it('offers the tenant last signed in to, with a different tenant beside it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('odudu.console.tenant', 'acme');
    const { leavePage } = renderAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
    expect(await screen.findByRole('button', { name: 'Sign in to acme' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'A different tenant' }));
    expect(screen.getByRole('textbox', { name: 'Which tenant do you administer?' })).toBeVisible();
    expect(leavePage).not.toHaveBeenCalled();
  });

  it('remembers the tenant once a session proves it', async () => {
    renderAt('/console/acme', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(localStorage.getItem('odudu.console.tenant')).toBe('acme');
  });

  it('says so when the server cannot be reached, and tries again when asked', async () => {
    const user = userEvent.setup();
    const { routes } = renderAt('/console/acme', { 'GET /console/api/session': offline() });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The console could not reach the server',
    );
    routes['GET /console/api/session'] = json(GRACE);
    routes['GET /console/api/admin/tenants/acme/whoami'] = whoami(ALL);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });

  it('shows the not-found page for a path that is no tenant', async () => {
    renderAt('/console/Not_A_Tenant', { 'GET /console/api/session': json(GRACE) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });
});

describe('another tenant while signed in', () => {
  it.each(['/console/globex/clients', '/console/?tenant=globex'])(
    'asks a tenant administrator at %s before signing in elsewhere',
    async (path) => {
      const user = userEvent.setup();
      const { leavePage, router } = renderAt(path, {
        'GET /console/api/session': json(GRACE),
        'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
      });
      const status = await screen.findByRole('heading', { level: 1, name: 'Signed in to acme' });
      expect(status).toBeVisible();
      expect(screen.getByText(/signed in to/u)).toHaveTextContent(
        "You're signed in to acme as grace.",
      );
      expect(leavePage).not.toHaveBeenCalled();
      expect(await violations()).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Sign in to globex' }));
      const params = loginParams(leavePage.mock.calls[0]?.[0]);
      expect(params.get('tenant')).toBe('globex');
      expect(router.state.location.publicHref).toBe(
        path === '/console/?tenant=globex' ? '/console/?tenant=globex' : path,
      );
    },
  );

  it('goes back to the tenant signed in to, sending nothing', async () => {
    const user = userEvent.setup();
    const { leavePage, router, calls } = renderAt('/console/globex', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    await user.click(await screen.findByRole('link', { name: 'Back to acme' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(router.state.location.publicHref).toBe('/console/acme');
    expect(leavePage).not.toHaveBeenCalled();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

describe('system authority', () => {
  it('shows the amber bar to a system administrator inside another tenant', async () => {
    renderAt('/console/acme/clients', {
      'GET /console/api/session': json(ROOT),
      'GET /console/api/admin/tenants/acme/whoami': whoami([...ALL, 'manage-tenants'], true),
    });
    const bar = await screen.findByRole('region', { name: 'System authority' });
    expect(bar).toHaveTextContent('Acting in acme with system authority');
    expect(screen.queryByRole('link', { name: 'Tenants' })).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('shows the System area in system, and no bar', async () => {
    renderAt('/console/system/tenants', {
      'GET /console/api/session': json(ROOT),
      'GET /console/api/admin/tenants/system/whoami': whoami([...ALL, 'manage-tenants']),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    const rail = screen.getByRole('navigation', { name: 'Areas of system' });
    const system = await within(rail).findByRole('list', { name: 'System' });
    expect(within(system).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(system).getByRole('link', { name: 'System administrators' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'System authority' })).toBeNull();
  });

  it('keeps the System area from a tenant administrator and from another tenant', async () => {
    renderAt('/console/acme/tenants', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Tenants' })).toBeNull();
  });
});

describe('capabilities', () => {
  it('says which capability an area needs when whoami says it is missing', async () => {
    renderAt('/console/acme/subjects', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(['manage-clients']),
    });
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Subjects needs the view-users capability.',
    );
  });
});

describe('leaving', () => {
  const signedIn = {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
  };

  it('signs out through the gateway and follows the redirect it names', async () => {
    const user = userEvent.setup();
    const redirect = `${location.origin}/tenants/acme/protocol/openid-connect/logout?client_id=odudu-admin`;
    const { leavePage, calls } = renderAt('/console/acme', {
      ...signedIn,
      'POST /console/auth/logout': json({ redirect }),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(leavePage).toHaveBeenCalledWith(redirect);
    });
    expect(calls).toContainEqual({ method: 'POST', path: '/console/auth/logout' });
  });

  it.each([
    ['the session had already ended', SESSION_ENDED],
    ['the redirect is off this origin', json({ redirect: 'https://elsewhere.example/logout' })],
  ])('leaves for the console root when %s', async (_, answer) => {
    const user = userEvent.setup();
    const { leavePage } = renderAt('/console/acme', {
      ...signedIn,
      'POST /console/auth/logout': answer,
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(leavePage).toHaveBeenCalledWith('/console/');
    });
  });

  it('forgets the drafts kept in this tab once signed out', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(
      'odudu.console.drafts',
      JSON.stringify({
        owner: 'acme/s1',
        drafts: { 'acme/roles/r1': { general: { etag: null, values: { name: 'x' } } } },
      }),
    );
    const { leavePage } = renderAt('/console/acme', {
      ...signedIn,
      'POST /console/auth/logout': json({ redirect: `${location.origin}/x` }),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(leavePage).toHaveBeenCalled();
    });
    expect(sessionStorage.getItem('odudu.console.drafts')).toBeNull();
  });

  it('stays signed in and says so when the sign-out cannot be confirmed', async () => {
    const user = userEvent.setup();
    const { leavePage } = renderAt('/console/acme', {
      ...signedIn,
      'POST /console/auth/logout': offline(),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out. Try again.');
    expect(leavePage).not.toHaveBeenCalled();
  });

  it('asks before a sign-out throws away unsaved work', async () => {
    const user = userEvent.setup();
    const { calls } = renderAt('/console/acme', {
      ...signedIn,
      'POST /console/auth/logout': json({ redirect: `${location.origin}/x` }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    act(() => {
      useUnsavedGuard.getState().setDirty('acme/settings#sessions', 'Sessions');
    });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Leave without saving?' }),
    ).toHaveAccessibleDescription('Your unsaved changes to Sessions will be lost.');
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('asks before a tenant switch throws away unsaved work', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/console/acme', signedIn);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    act(() => {
      useUnsavedGuard.getState().setDirty('acme/settings#sessions', 'Sessions');
    });
    await user.click(screen.getByRole('link', { name: 'Switch tenant' }));
    await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await user.click(screen.getByRole('button', { name: 'Discard changes and leave' }));
    expect(
      await screen.findByRole('textbox', { name: 'Which tenant do you administer?' }),
    ).toBeVisible();
    expect(router.state.location.publicHref).toBe('/console/?choose=');
  });

  it('lets a system administrator enter another tenant without signing in again', async () => {
    const user = userEvent.setup();
    const { leavePage, router } = renderAt('/console/?choose', {
      'GET /console/api/session': json(ROOT),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL, true),
    });
    await user.type(
      await screen.findByRole('textbox', { name: 'Which tenant do you administer?' }),
      'acme',
    );
    await user.click(screen.getByRole('button', { name: 'Enter acme' }));
    expect(await screen.findByRole('region', { name: 'System authority' })).toBeVisible();
    expect(router.state.location.publicHref).toBe('/console/acme');
    expect(leavePage).not.toHaveBeenCalled();
  });
});

describe('the theme', () => {
  it('is chosen from the shell and remembered', async () => {
    const user = userEvent.setup();
    renderAt('/console/acme', {
      'GET /console/api/session': json(GRACE),
      'GET /console/api/admin/tenants/acme/whoami': whoami(ALL),
    });
    const theme = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(theme).getByRole('radio', { name: 'System' })).toBeChecked();
    await user.click(within(theme).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('odudu.console.theme')).toBe('dark');
    await user.click(within(theme).getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

it('keeps the toasts announced and dismissible', async () => {
  renderAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': problem(403),
  });
  await screen.findByRole('heading', { level: 1, name: 'Overview' });
  act(() => {
    useToasts.getState().push({ tone: 'error', message: 'The server could not be reached' });
  });
  const region = screen.getByRole('region', { name: 'Notifications' });
  expect(within(region).getByText('The server could not be reached')).toBeVisible();
  await userEvent.setup().click(within(region).getByRole('button', { name: /^Dismiss/u }));
  expect(useToasts.getState().toasts).toEqual([]);
});
