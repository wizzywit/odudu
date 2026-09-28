import { focusManager } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { NavigationGuard } from '#/app/NavigationGuard.tsx';
import { Providers } from '#/app/Providers.tsx';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer.tsx';
import { SessionGate } from '#/features/session/index.ts';
import { TenantShell } from '#/features/shell/index.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useDrafts, type DraftFields } from '#/shared/repository/useDrafts.ts';
import { useSectionDraft } from '#/shared/repository/useSectionDraft.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';
import { TextField } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport.ts';

const GRACE = { tenant: 'acme', subject_id: 's1', username: 'grace' };
const HOPPER = { tenant: 'acme', subject_id: 's2', username: 'hopper' };
const WHOAMI = 'GET /console/api/admin/tenants/acme/whoami';
const SAVE = 'PATCH /console/api/admin/tenants/acme/clients/c1';
const CHANGED = problem(409, 'about:blank#console-principal-changed', 'Conflict');

function General() {
  const [name, setName] = useState<string | null>(null);
  const fields: DraftFields = name === null ? {} : { name: { kind: 'plain', value: name } };
  const { restored } = useSectionDraft({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    dirty: name !== null,
    fields,
    etag: '"e1"',
  });
  const [applied, setApplied] = useState(false);
  if (restored !== null && !applied) {
    setApplied(true);
    setName(typeof restored.values.name === 'string' ? restored.values.name : null);
  }
  return (
    <Section
      title="General"
      dirty={name !== null}
      saving={false}
      restored={restored !== null}
      onSave={() => undefined}
      onDiscard={() => {
        setName(null);
      }}
    >
      <TextField label="Name" value={name ?? 'Billing portal'} onChange={setName} />
    </Section>
  );
}

function mount(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const root = createRootRoute({
    component: () => (
      <>
        <NavigationGuard />
        <SessionGate>
          <Outlet />
        </SessionGate>
      </>
    ),
  });
  const tenant = createRoute({
    getParentRoute: () => root,
    path: '$tenant',
    component: function Tenant() {
      return (
        <TenantShell tenant={tenant.useParams().tenant}>
          <Outlet />
        </TenantShell>
      );
    },
  });
  const client = createRoute({
    getParentRoute: () => tenant,
    path: 'clients/c1',
    component: General,
  });
  const router = createRouter({
    routeTree: root.addChildren([tenant.addChildren([client])]),
    history: createMemoryHistory({ initialEntries: ['/console/acme/clients/c1'] }),
    basepath: '/console',
    parseSearch,
    stringifySearch,
  });
  const view = render(
    <Providers transport={fake.transport} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
      <UnsavedGuardLayer />
    </Providers>,
  );
  return { ...fake, unmount: view.unmount };
}

function whoami(subjectId: string): Answer {
  return json({
    subjectId,
    issuerTenantId: 't1',
    capabilities: ['manage-clients'],
    crossTenant: false,
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  useUnsavedGuard.getState().reset();
  useDrafts.getState().forgetAll();
});

async function editThenReplace() {
  const user = userEvent.setup();
  const tab = mount({
    'GET /console/api/session': json(GRACE),
    [WHOAMI]: whoami('s1'),
    [SAVE]: CHANGED,
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  tab.routes['GET /console/api/session'] = json(HOPPER);
  tab.routes[WHOAMI] = whoami('s2');
  return { user, tab };
}

it('names the subject this tab shows on every admin request', async () => {
  const tab = mount({ 'GET /console/api/session': json(GRACE), [WHOAMI]: whoami('s1') });
  await screen.findByRole('textbox', { name: 'Name' });
  const admin = tab.calls.filter((call) => call.path.startsWith('/console/api/admin/'));
  expect(admin.length).toBeGreaterThan(0);
  expect(admin.every((call) => call.subject === 's1')).toBe(true);
});

it('treats a refusal for another principal as the end of this tab, keeping its edits', async () => {
  const { user, tab } = await editThenReplace();

  await act(() =>
    tab.transport.gateway.request('PATCH', 'admin/tenants/acme/clients/c1', {
      schema: z.unknown(),
      body: { name: 'Billing portal EU' },
    }),
  );

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Signed in as somebody else' }),
  ).toBeVisible();
  expect(screen.getByText(/now signed in as/u)).toHaveTextContent(
    'This browser is now signed in as hopper in acme.',
  );
  expect(screen.queryByRole('region', { name: 'General' })).toBeNull();
  const kept = sessionStorage.getItem('odudu.console.drafts') ?? '';
  expect(kept).toContain('"owner":"acme/s1"');
  expect(kept).toContain('Billing portal EU');
  expect(tab.leavePage).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Sign in as grace again' }));
  const login = new URL(tab.leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(login.pathname).toBe('/console/auth/login');
  expect(login.searchParams.get('tenant')).toBe('acme');
  expect(login.searchParams.get('return_to')).toBe('/console/acme/clients/c1');
  tab.unmount();

  mount({ 'GET /console/api/session': json(GRACE), [WHOAMI]: whoami('s1') });
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
});

it('asks the same when a session read on focus names somebody else', async () => {
  await editThenReplace();

  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Signed in as somebody else' }),
  ).toBeVisible();
  expect(sessionStorage.getItem('odudu.console.drafts') ?? '').toContain('Billing portal EU');
  act(() => {
    focusManager.setFocused(undefined);
  });
});

it('continues as the new administrator only when asked, and then drops the old edits', async () => {
  const { user, tab } = await editThenReplace();
  await act(() =>
    tab.transport.gateway.request('PATCH', 'admin/tenants/acme/clients/c1', {
      schema: z.unknown(),
    }),
  );
  await screen.findByRole('heading', { level: 1, name: 'Signed in as somebody else' });
  expect(screen.getByText(/discards them/u)).toHaveTextContent(
    'Continuing as hopper discards them.',
  );

  await user.click(screen.getByRole('button', { name: 'Continue as hopper' }));

  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal');
  expect(screen.getByText(/Signed in as/u)).toHaveTextContent('Signed in as hopper');
  expect(sessionStorage.getItem('odudu.console.drafts')).toBeNull();
  await waitFor(() => {
    expect(
      tab.calls.filter((call) => `${call.method} ${call.path}` === WHOAMI).at(-1)?.subject,
    ).toBe('s2');
  });
});
