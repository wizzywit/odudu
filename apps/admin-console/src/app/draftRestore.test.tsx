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
import { fakeTransport, json, SESSION_ENDED, type Answer } from '#/testing/fakeTransport.ts';

const BASE = { name: 'Billing portal', secret: '' };

// A client section as a feature will build one, on a route of its own.
function General() {
  const [edits, setEdits] = useState<Partial<typeof BASE>>({});
  const fields: DraftFields = Object.fromEntries(
    Object.entries(edits).map(([name, value]) => [
      name,
      { kind: name === 'secret' ? 'secret' : 'plain', value } as const,
    ]),
  );
  const dirty = Object.keys(edits).length > 0;
  const { restored, settle } = useSectionDraft({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    dirty,
    fields,
    etag: '"e1"',
  });
  const [applied, setApplied] = useState(false);
  if (restored !== null && !applied) {
    setApplied(true);
    setEdits(typeof restored.values.name === 'string' ? { name: restored.values.name } : {});
  }
  const values = { ...BASE, ...edits };
  return (
    <Section
      title="General"
      dirty={dirty}
      saving={false}
      restored={restored !== null}
      onSave={() => undefined}
      onDiscard={() => {
        setEdits({});
        settle();
      }}
    >
      <TextField
        label="Name"
        value={values.name}
        onChange={(name) => {
          setEdits((was) => ({ ...was, name }));
        }}
      />
      <TextField
        label="Client secret"
        value={values.secret}
        onChange={(secret) => {
          setEdits((was) => ({ ...was, secret }));
        }}
      />
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

const SIGNED_IN = {
  'GET /console/api/session': json({ tenant: 'acme', subject_id: 's1', username: 'grace' }),
  'GET /console/api/admin/tenants/acme/whoami': json({
    subjectId: 's1',
    issuerTenantId: 't1',
    capabilities: ['manage-clients'],
    crossTenant: false,
  }),
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  useUnsavedGuard.getState().reset();
  useDrafts.getState().forgetAll();
});

it('keeps the edit through a session that ends mid-edit, and puts it back marked, sending nothing', async () => {
  const user = userEvent.setup();
  const first = mount({
    ...SIGNED_IN,
    'GET /console/api/admin/tenants/acme/clients': SESSION_ENDED,
  });
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, ' EU');
  await user.type(screen.getByRole('textbox', { name: 'Client secret' }), 'hunter2');

  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );

  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalledOnce();
  });
  const login = new URL(first.leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(login.pathname).toBe('/console/auth/login');
  expect(login.searchParams.get('return_to')).toBe('/console/acme/clients/c1');
  expect(screen.getByRole('heading', { level: 1, name: 'Your session ended' })).toBeVisible();
  const kept = sessionStorage.getItem('odudu.console.drafts') ?? '';
  expect(kept).toContain('Billing portal EU');
  expect(kept).not.toContain('hunter2');
  expect(first.calls.every((call) => call.method === 'GET')).toBe(true);
  first.unmount();

  const second = mount(SIGNED_IN);
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
  expect(within(section).getByRole('textbox', { name: 'Client secret' })).toHaveValue('');
  expect(second.calls.every((call) => call.method === 'GET')).toBe(true);
});

it('restores nothing for a different administrator signing in to the same tab', async () => {
  const user = userEvent.setup();
  const first = mount({
    ...SIGNED_IN,
    'GET /console/api/admin/tenants/acme/clients': SESSION_ENDED,
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );
  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalled();
  });
  first.unmount();

  mount({
    ...SIGNED_IN,
    'GET /console/api/session': json({ tenant: 'acme', subject_id: 's2', username: 'hopper' }),
  });
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).queryByText('Restored — review before saving')).toBeNull();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal');
});
